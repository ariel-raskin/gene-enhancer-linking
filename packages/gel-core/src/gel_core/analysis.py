"""Small-region BigWig analysis for GEL's bounded demonstration workflow.

This module intentionally operates on a declared genomic region. A genome-wide
peak caller and DESeq2/eNRSA adapter are separate planned components.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import statistics
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

from .coordinates import Interval, signed_relative_position, tss
from .morphology import classify_strand_geometry


@dataclass(frozen=True)
class Gene:
    gene_id: str
    symbol: str
    chrom: str
    start: int
    end: int
    strand: str

    @property
    def interval(self) -> Interval:
        return Interval(self.chrom, self.start, self.end)

    @property
    def tss(self) -> int:
        return tss(self.start, self.end, self.strand)


@dataclass(frozen=True)
class Sample:
    sample_id: str
    group: str
    time: str
    replicate: str
    plus: str
    minus: str
    is_control: bool = False


class BigWigReader:
    """Thin pyBigWig adapter; imported lazily so non-BigWig commands stay usable."""

    def __init__(self, path: str | Path):
        try:
            import pyBigWig  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError("BigWig input needs the optional dependency: pip install 'gel-core[bigwig]'") from exc
        self.path = str(path)
        self.handle = pyBigWig.open(self.path)
        if self.handle is None:
            raise ValueError(f"could not open BigWig: {self.path}")
        self.chrom_sizes = dict(self.handle.chroms())

    def sum_abs(self, chrom: str, start: int, end: int) -> float:
        if chrom not in self.chrom_sizes:
            return 0.0
        size = self.chrom_sizes[chrom]
        left, right = max(0, start), min(size, end)
        if left >= right:
            return 0.0
        values = self.handle.values(chrom, left, right, numpy=False)
        return sum(abs(float(value)) for value in values if value is not None and math.isfinite(float(value)))

    def close(self) -> None:
        self.handle.close()


def load_config(path: str | Path) -> dict[str, Any]:
    config_path = Path(path).resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    base = config_path.parent
    for sample in config.get("samples", []):
        for key in ("plus", "minus"):
            sample[key] = str((base / sample[key]).resolve())
    for key in ("genes_tsv", "output_dir"):
        if key in config:
            raw = Path(config[key])
            config[key] = str((base / raw).resolve())
    return config


def read_genes(path: str | Path) -> list[Gene]:
    with Path(path).open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        required = {"gene_id", "symbol", "chrom", "start", "end", "strand"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError(f"gene table requires columns: {', '.join(sorted(required))}")
        genes = [Gene(row["gene_id"], row["symbol"], row["chrom"], int(row["start"]),
                      int(row["end"]), row["strand"]) for row in reader]
    identifiers = [gene.gene_id for gene in genes]
    if len(identifiers) != len(set(identifiers)):
        raise ValueError("duplicate gene_id values are not allowed")
    return genes


def _open_tracks(sample_rows: list[dict[str, Any]]) -> tuple[list[Sample], dict[str, tuple[BigWigReader, BigWigReader]]]:
    samples = [Sample(str(row["sample_id"]), str(row["group"]), str(row.get("time", "")),
                      str(row.get("replicate", "")), str(row["plus"]), str(row["minus"]),
                      bool(row.get("is_control", False))) for row in sample_rows]
    if not samples:
        raise ValueError("at least one sample is required")
    if len({sample.sample_id for sample in samples}) != len(samples):
        raise ValueError("sample_id values must be unique")
    opened: dict[str, tuple[BigWigReader, BigWigReader]] = {}
    try:
        for sample in samples:
            if not sample.plus or not sample.minus:
                raise ValueError(f"both strand tracks are required for {sample.sample_id}")
            plus_reader, minus_reader = BigWigReader(sample.plus), BigWigReader(sample.minus)
            if plus_reader.chrom_sizes != minus_reader.chrom_sizes:
                plus_reader.close(); minus_reader.close()
                raise ValueError(f"plus/minus BigWig chromosome dictionaries disagree for {sample.sample_id}")
            opened[sample.sample_id] = (plus_reader, minus_reader)
    except Exception:
        for plus, minus in opened.values():
            plus.close(); minus.close()
        raise
    return samples, opened


def _measure_interval(plus: BigWigReader, minus: BigWigReader, chrom: str,
                      start: int, end: int) -> float:
    return plus.sum_abs(chrom, start, end) + minus.sum_abs(chrom, start, end)


def _fold_change(control: list[float], treatment: list[float], pseudocount: float) -> tuple[float, float | None]:
    cmean = statistics.mean(control) if control else math.nan
    tmean = statistics.mean(treatment) if treatment else math.nan
    lfc = math.log2((tmean + pseudocount) / (cmean + pseudocount)) if math.isfinite(cmean + tmean) else math.nan
    if len(control) < 2 or len(treatment) < 2:
        return lfc, None
    # Delta-method SE for log2 ratio of group means, conditional on independent
    # samples and this descriptive signal summary. No p-value is inferred.
    var_c = statistics.variance(control) / len(control)
    var_t = statistics.variance(treatment) / len(treatment)
    se = math.sqrt(var_t / ((tmean + pseudocount) ** 2) + var_c / ((cmean + pseudocount) ** 2)) / math.log(2)
    return lfc, se


def _merge_bins(bins: list[tuple[int, int, float]], gap: int) -> list[tuple[int, int, float]]:
    merged: list[list[float]] = []
    for start, end, signal in bins:
        if merged and start <= int(merged[-1][1]) + gap:
            merged[-1][1] = max(int(merged[-1][1]), end)
            merged[-1][2] += signal
        else:
            merged.append([start, end, signal])
    return [(int(start), int(end), signal) for start, end, signal in merged]


def discover_candidates(config: dict[str, Any], samples: list[Sample],
                        tracks: dict[str, tuple[BigWigReader, BigWigReader]], genes: list[Gene]) -> list[dict[str, Any]]:
    region = config["region"]
    chrom, region_start, region_end = region["chrom"], int(region["start"]), int(region["end"])
    params = config.get("parameters", {})
    width = int(params.get("peak_bin_bp", 100))
    minimum = float(params.get("min_peak_signal", 8.0))
    merge_gap = int(params.get("merge_gap_bp", 50))
    controls = [s for s in samples if s.is_control]
    signal_samples = controls or samples
    if not controls:
        raise ValueError("peak discovery requires explicit control samples")
    chrom_sizes = [tracks[s.sample_id][0].chrom_sizes.get(chrom) for s in samples]
    if any(size is None for size in chrom_sizes):
        raise ValueError(f"declared region chromosome {chrom!r} is absent from one or more BigWigs")
    if region_start < 0 or region_end <= region_start or region_end > min(int(size) for size in chrom_sizes if size):
        raise ValueError("declared region exceeds the available BigWig chromosome bounds")
    active: list[tuple[int, int, float]] = []
    for start in range(region_start, region_end, width):
        end = min(region_end, start + width)
        signal = statistics.mean(_measure_interval(*tracks[s.sample_id], chrom, start, end) for s in signal_samples)
        if signal >= minimum:
            active.append((start, end, signal))
    merged = _merge_bins(active, merge_gap)
    flank = int(params.get("morphology_flank_bp", 100))
    candidates: list[dict[str, Any]] = []
    for index, (start, end, signal) in enumerate(merged, 1):
        center = (start + end) // 2
        left_start, right_end = max(region_start, center - flank), min(region_end, center + flank)
        ml = pl = mr = pr = 0.0
        for sample in signal_samples:
            plus, minus = tracks[sample.sample_id]
            ml += minus.sum_abs(chrom, max(region_start, center - flank), max(region_start, center - 1))
            pl += plus.sum_abs(chrom, max(region_start, center - flank), max(region_start, center - 1))
            mr += minus.sum_abs(chrom, min(region_end, center + 1), min(region_end, center + flank))
            pr += plus.sum_abs(chrom, min(region_end, center + 1), min(region_end, center + flank))
        denom = max(1, len(signal_samples))
        morphology = classify_strand_geometry(ml / denom, pl / denom, mr / denom, pr / denom,
                                              min_total=float(params.get("morphology_min_total", 4.0)))
        interval = Interval(chrom, start, end)
        promoter_hits, body_hits = [], []
        promoter_up = int(params.get("promoter_upstream_bp", 1000))
        promoter_down = int(params.get("promoter_downstream_bp", 100))
        for gene in genes:
            tss_pos = gene.tss
            pstart, pend = ((tss_pos - promoter_up, tss_pos + promoter_down + 1) if gene.strand == "+"
                            else (tss_pos - promoter_down, tss_pos + promoter_up + 1))
            if interval.overlaps(Interval(gene.chrom, max(0, pstart), max(max(0, pstart) + 1, pend))):
                promoter_hits.append(gene.gene_id)
            if interval.overlaps(gene.interval):
                body_hits.append(gene.gene_id)
        candidates.append({
            "enhancer_id": f"{chrom}:{start}-{end}", "chrom": chrom, "start": start, "end": end,
            "midpoint": center, "baseline_signal": signal, "morphology": morphology,
            "strand_left_minus": ml / denom, "strand_left_plus": pl / denom,
            "strand_right_minus": mr / denom, "strand_right_plus": pr / denom,
            "overlaps_promoter": bool(promoter_hits), "overlapping_gene_bodies": ";".join(body_hits),
            "promoter_gene_ids": ";".join(promoter_hits), "candidate_source": "synthetic_signal_discovery",
        })
    return candidates


def _contrast_rows(candidates: list[dict[str, Any]], genes: list[Gene], samples: list[Sample],
                   tracks: dict[str, tuple[BigWigReader, BigWigReader]], config: dict[str, Any]) -> list[dict[str, Any]]:
    params = config.get("parameters", {})
    pseudocount = float(params.get("pseudocount", 1.0))
    min_change = float(params.get("min_abs_log2fc", 0.5))
    q_threshold = params.get("max_q_value")
    by_time: dict[str, dict[str, list[Sample]]] = {}
    for sample in samples:
        by_time.setdefault(sample.time, {}).setdefault("control" if sample.is_control else sample.group, []).append(sample)
    rows: list[dict[str, Any]] = []
    gene_measurements: dict[tuple[str, str], float] = {}
    enhancer_measurements: dict[tuple[str, str], float] = {}
    for candidate in candidates:
        for sample in samples:
            enhancer_measurements[(candidate["enhancer_id"], sample.sample_id)] = _measure_interval(
                *tracks[sample.sample_id], candidate["chrom"], candidate["start"], candidate["end"])
    for gene in genes:
        for sample in samples:
            gene_measurements[(gene.gene_id, sample.sample_id)] = _measure_interval(
                *tracks[sample.sample_id], gene.chrom, gene.start, gene.end)
    for time, groups in by_time.items():
        controls = groups.get("control", [])
        for treatment_name, treated in groups.items():
            if treatment_name == "control" or not treated or not controls:
                continue
            for candidate in candidates:
                for gene in genes:
                    enh_lfc, enh_se = _fold_change(
                        [enhancer_measurements[(candidate["enhancer_id"], s.sample_id)] for s in controls],
                        [enhancer_measurements[(candidate["enhancer_id"], s.sample_id)] for s in treated], pseudocount)
                    gene_lfc, gene_se = _fold_change(
                        [gene_measurements[(gene.gene_id, s.sample_id)] for s in controls],
                        [gene_measurements[(gene.gene_id, s.sample_id)] for s in treated], pseudocount)
                    enh_dir = 1 if enh_lfc >= min_change else (-1 if enh_lfc <= -min_change else 0)
                    gene_dir = 1 if gene_lfc >= min_change else (-1 if gene_lfc <= -min_change else 0)
                    agreement = (enh_dir == gene_dir) if enh_dir and gene_dir else None
                    weak_floor = float(params.get("weak_effect_floor", min_change * 0.5))
                    weak_e_dir = 1 if enh_lfc > weak_floor else (-1 if enh_lfc < -weak_floor else 0)
                    weak_g_dir = 1 if gene_lfc > weak_floor else (-1 if gene_lfc < -weak_floor else 0)
                    distance = candidate["start"] - gene.tss if gene.tss < candidate["start"] else (
                        gene.tss - candidate["end"] + 1 if gene.tss >= candidate["end"] else 0)
                    if abs(distance) > int(params.get("max_distance_bp", 100_000)):
                        continue
                    reason = "both_effect_thresholds_met" if enh_dir and gene_dir else "one_or_both_effects_below_threshold"
                    if q_threshold is not None:
                        reason += ";q_values_unavailable_in_bigwig_demo"
                    # BigWig-only descriptive effects cannot establish statistical
                    # significance; reserve the high tier for a future adapter
                    # that supplies valid differential-test statistics.
                    tier = "insufficient" if agreement is None else ("moderate" if agreement else "discordant")
                    if agreement is None and weak_e_dir and weak_g_dir and weak_e_dir == weak_g_dir:
                        tier = "weak"
                    rows.append({
                        "link_id": f"{candidate['enhancer_id']}__{gene.gene_id}",
                        "enhancer_id": candidate["enhancer_id"], "gene_id": gene.gene_id,
                        "gene_symbol": gene.symbol, "chrom": gene.chrom,
                        "enhancer_start": candidate["start"], "enhancer_end": candidate["end"],
                        "gene_start": gene.start, "gene_end": gene.end, "gene_strand": gene.strand,
                        "tss": gene.tss, "distance_bp": distance,
                        "midpoint_to_tss_bp": candidate["midpoint"] - gene.tss,
                        "transcription_oriented_offset_bp": signed_relative_position(candidate["midpoint"], gene.tss, gene.strand),
                        "treatment": treatment_name, "time": time,
                        "enhancer_log2fc": round(enh_lfc, 6), "enhancer_se": None if enh_se is None else round(enh_se, 6),
                        "enhancer_q_value": None, "gene_body_log2fc": round(gene_lfc, 6),
                        "magnitude_gap_log2fc": round(abs(abs(enh_lfc) - abs(gene_lfc)), 6),
                        "gene_body_se": None if gene_se is None else round(gene_se, 6), "gene_q_value": None,
                        "direction_agreement": agreement, "both_significant": None,
                        "evidence_tier": tier, "classification_reason": reason,
                        "morphology": candidate["morphology"], "overlaps_promoter": candidate["overlaps_promoter"],
                        "overlapping_gene_bodies": candidate["overlapping_gene_bodies"],
                        "candidate_source": candidate["candidate_source"],
                    })
    return rows


def _write_tsv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("\n", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]), delimiter="\t", extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _source_file_details(path: str | Path, hash_limit_bytes: int = 32 * 1024 * 1024) -> dict[str, Any]:
    source = Path(path)
    stat = source.stat()
    details: dict[str, Any] = {"file": source.name, "bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns}
    if stat.st_size <= hash_limit_bytes:
        digest = hashlib.sha256()
        with source.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        details["sha256"] = digest.hexdigest()
    else:
        details["sha256"] = None
        details["hash_skipped_reason"] = f"input exceeds {hash_limit_bytes} byte bounded hashing limit"
    return details


def write_exports(output_dir: str | Path, candidates: list[dict[str, Any]], pairs: list[dict[str, Any]],
                  metadata: dict[str, Any]) -> dict[str, Any]:
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    _write_tsv(out / "enhancer_candidates.tsv", candidates)
    _write_tsv(out / "gel_links.tsv", pairs)
    with (out / "gel_links.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(pairs[0]) if pairs else ["link_id"], extrasaction="ignore")
        writer.writeheader(); writer.writerows(pairs)
    bed_rows = []
    for item in candidates:
        bed_rows.append(f"{item['chrom']}\t{item['start']}\t{item['end']}\t{item['enhancer_id']}\t{round(item['baseline_signal'])}\t.\n")
    (out / "enhancers.bed").write_text("".join(bed_rows), encoding="utf-8")
    by_tier = {tier: [] for tier in ("high", "moderate", "weak", "discordant", "insufficient")}
    for row in pairs:
        tier = row["evidence_tier"]
        by_tier.setdefault(tier, []).append(row)
    for tier, rows in by_tier.items():
        _write_bedpe(out / f"gel_links_{tier}.bedpe", rows)
    _write_bedpe(out / "gel_links.bedpe", pairs)
    _write_interact(out / "gel_links.interact", pairs, "GEL candidate response evidence")
    summary = {
        **metadata, "enhancer_count": len(candidates), "gene_count": metadata.get("gene_count", 0),
        "candidate_pair_count": len(pairs),
        "genes_with_candidates": len({row["gene_id"] for row in pairs}),
        "evidence_tier_counts": {tier: sum(row["evidence_tier"] == tier for row in pairs) for tier in by_tier},
        "coordinate_convention": "0-based half-open",
        "scientific_note": "Transcriptional response concordance nominates candidates; it does not prove causal enhancer-to-gene regulation.",
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    (out / "summary.md").write_text(_summary_markdown(summary), encoding="utf-8")
    return summary


def _write_bedpe(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            enhancer_start, enhancer_end = int(row["enhancer_start"]), int(row["enhancer_end"])
            tss_pos, strand = int(row["tss"]), row["gene_strand"]
            up, down = 500, 100
            pstart, pend = ((tss_pos - up, tss_pos + down + 1) if strand == "+" else
                            (tss_pos - down, tss_pos + up + 1))
            pstart, pend = max(0, pstart), max(max(0, pstart) + 1, pend)
            score = {"high": 1000, "moderate": 700, "weak": 450, "discordant": 250, "insufficient": 100}.get(row["evidence_tier"], 0)
            handle.write("\t".join(map(str, (row["chrom"], enhancer_start, enhancer_end, row["chrom"], pstart,
                                                pend, row["link_id"], score, ".", strand))) + "\n")


def _write_interact(path: Path, rows: Iterable[dict[str, Any]], track_name: str) -> None:
    colors = {"high": "31,112,79", "moderate": "129,181,109", "weak": "221,157,56",
              "discordant": "190,76,58", "insufficient": "130,140,137"}
    with path.open("w", encoding="utf-8") as handle:
        handle.write(f'track type=interact name="{track_name}" description="Response evidence; not causal validation" visibility=full\n')
        for row in rows:
            e_start, e_end = int(row["enhancer_start"]), int(row["enhancer_end"])
            gene_tss, strand = int(row["tss"]), row["gene_strand"]
            g_start, g_end = ((gene_tss - 500, gene_tss + 101) if strand == "+" else
                              (gene_tss - 100, gene_tss + 501))
            g_start, g_end = max(0, g_start), max(max(0, g_start) + 1, g_end)
            span_start, span_end = min(e_start, g_start), max(e_end, g_end)
            score = {"high": 1000, "moderate": 700, "weak": 450, "discordant": 250, "insufficient": 100}.get(row["evidence_tier"], 0)
            tier_label = row["evidence_tier"]
            fields = (row["chrom"], span_start, span_end, row["link_id"], score,
                      min(abs(float(row["enhancer_log2fc"])), abs(float(row["gene_body_log2fc"]))),
                      "perturbation-response", colors.get(tier_label, "130,140,137"),
                      row["chrom"], e_start, e_end, row["enhancer_id"], ".",
                      row["chrom"], g_start, g_end, row["gene_symbol"], strand)
            handle.write("\t".join(map(str, fields)) + "\n")


def validate_interact(path: str | Path) -> dict[str, Any]:
    """Check UCSC interact header, 18-column rows, anchors and score/color fields."""
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    if not lines or not lines[0].startswith("track type=interact "):
        raise ValueError("interact file must begin with a UCSC track type=interact line")
    rows = [line.split("\t") for line in lines[1:] if line.strip()]
    for number, row in enumerate(rows, start=2):
        if len(row) != 18:
            raise ValueError(f"interact row {number} has {len(row)} fields; expected 18")
        chrom, span_start, span_end, _name, score = row[:5]
        if int(span_start) < 0 or int(span_end) <= int(span_start) or not 0 <= int(score) <= 1000:
            raise ValueError(f"invalid span or score in interact row {number}")
        if row[8] != row[13] or row[8] != chrom:
            raise ValueError(f"interaction anchors are not on the declared chromosome in row {number}")
    return {"row_count": len(rows), "field_count": 18, "valid": True}


def _summary_markdown(summary: dict[str, Any]) -> str:
    tiers = "\n".join(f"- {tier}: {n}" for tier, n in summary["evidence_tier_counts"].items())
    return ("# GEL synthetic demonstration summary\n\n"
            f"- Analysis scope: {summary.get('region_label', 'declared small region')}\n"
            f"- Genome build: {summary.get('genome_assembly', 'unspecified demo reference')}\n"
            f"- Genes: {summary['gene_count']}\n- Signal-derived enhancer-like intervals: {summary['enhancer_count']}\n"
            f"- Candidate pair rows: {summary['candidate_pair_count']}\n"
            f"- Genes with candidate evidence: {summary['genes_with_candidates']}\n\n"
            "## Evidence-tier row counts\n\n" + tiers + "\n\n"
            + summary["scientific_note"] + "\n\n"
            + "The BigWig demo has no DESeq2 p-values or adjusted p-values; effect thresholds are descriptive and must not be called statistical significance.\n")


def run_config(config_path: str | Path, output_dir: str | Path | None = None) -> dict[str, Any]:
    config = load_config(config_path)
    if not config.get("genome_assembly") or not config.get("normalization"):
        raise ValueError("genome_assembly and normalization provenance must be specified")
    samples, tracks = _open_tracks(config["samples"])
    try:
        genes = read_genes(config["genes_tsv"])
        candidates = discover_candidates(config, samples, tracks, genes)
        pairs = _contrast_rows(candidates, genes, samples, tracks, config)
        out = output_dir or config.get("output_dir") or "results"
        Path(out).mkdir(parents=True, exist_ok=True)
        config_hash = hashlib.sha256(Path(config_path).read_bytes()).hexdigest()
        provenance = {
            "config_file": Path(config_path).name, "config_sha256": config_hash,
            "sample_tracks": [{"sample_id": sample.sample_id,
                               "plus": _source_file_details(sample.plus),
                               "minus": _source_file_details(sample.minus)}
                              for sample in samples],
            "program": "gel-core", "version": "0.1.0",
        }
        (Path(out) / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
        sample_metadata = []
        for sample in samples:
            row = asdict(sample)
            row["plus"] = Path(sample.plus).name
            row["minus"] = Path(sample.minus).name
            sample_metadata.append(row)
        _write_tsv(Path(out) / "sample_metadata.tsv", sample_metadata)
        summary = write_exports(out, candidates, pairs, {
            "genome_assembly": config.get("genome_assembly", "unspecified"),
            "region_label": config.get("region", {}).get("label", config.get("region", {}).get("chrom", "demo")),
            "gene_count": len(genes), "sample_count": len(samples),
            "control_samples": [sample.sample_id for sample in samples if sample.is_control],
            "treatment_samples": [sample.sample_id for sample in samples if not sample.is_control],
            "experimental_scope": "synthetic bounded-region demonstration" if config.get("synthetic") else "user-supplied",
            "normalization": config["normalization"],
            "parameters": config.get("parameters", {}),
        })
        summary["interact_validation"] = validate_interact(Path(out) / "gel_links.interact")
        (Path(out) / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        with zipfile.ZipFile(Path(out) / "gel-results.zip", "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for file in sorted(Path(out).iterdir()):
                if file.is_file() and file.name != "gel-results.zip":
                    archive.write(file, arcname=file.name)
        return summary
    finally:
        for plus, minus in tracks.values():
            plus.close(); minus.close()


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Run bounded GEL analysis from strand-specific BigWigs")
    parser.add_argument("--config", required=True, help="experiment JSON with region, samples and annotations")
    parser.add_argument("--output", help="output directory (overrides config)")
    args = parser.parse_args()
    result = run_config(args.config, args.output)
    print(json.dumps(result, indent=2))


def _entrypoint() -> None:
    main()
