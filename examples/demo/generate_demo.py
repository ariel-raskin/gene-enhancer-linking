"""Generate tiny synthetic strand-specific BigWigs and run the GEL core."""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path

import pyBigWig

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
DATA.mkdir(parents=True, exist_ok=True)
CHROM, SIZE = "chrDemo", 10_000

# Baseline peaks at 2.0 kb (divergent, concordant), 4.0 kb (discordant),
# plus a gene-body transcription unit. Every signal is synthetic.
PEAKS = [(1950, 2050, 8.0), (3950, 4050, 7.0), (6800, 7200, 2.0)]


def value_at(pos: int, strand: str, sample_group: str) -> float:
    value = 0.01
    for start, end, height in PEAKS:
        if start <= pos < end:
            scale = 1.0
            if start == 1950 and sample_group == "perturbation":
                scale = 2.2
            if start == 3950 and sample_group == "perturbation":
                scale = 0.25
            # The first candidate's divergent initiation geometry.
            if start == 1950:
                if strand == "minus" and pos < 2000:
                    value += height * scale
                if strand == "plus" and pos >= 2000:
                    value += height * scale
            # The second is unidirectional; gene response is opposite.
            elif start == 3950 and strand == "plus":
                value += height * scale
            elif start == 6800:
                value += height
    # Gene body 6.0-7.5 kb: baseline transcription is substantial and drops.
    if 6000 <= pos < 7500:
        value += 4.0 if sample_group == "control" else 8.0
    return value


def write_track(path: Path, strand: str, group: str, replicate_offset: float) -> None:
    bw = pyBigWig.open(str(path), "w")
    bw.addHeader([(CHROM, SIZE)])
    starts, ends, values = [], [], []
    for start in range(SIZE):
        value = value_at(start, strand, group) + replicate_offset
        if value >= 0.2:
            starts.append(start); ends.append(start + 1); values.append(value)
    bw.addEntries([CHROM] * len(starts), starts, ends=ends, values=values)
    bw.close()


def main() -> None:
    samples = []
    for group, prefix in (("control", "ctrl"), ("perturbation", "treat")):
        for replicate in ("A", "B"):
            sid = f"{prefix}_{replicate}"
            plus, minus = DATA / f"{sid}_plus.bw", DATA / f"{sid}_minus.bw"
            offset = -0.03 if replicate == "A" else 0.03
            write_track(plus, "plus", group, offset)
            write_track(minus, "minus", group, offset)
            samples.append({"sample_id": sid, "group": group, "time": "1h", "replicate": replicate,
                            "is_control": group == "control", "plus": f"data/{plus.name}",
                            "minus": f"data/{minus.name}"})
    genes = [
        {"gene_id": "GENE_CONC", "symbol": "DEMO1", "chrom": CHROM, "start": 6000, "end": 7500, "strand": "+"},
        {"gene_id": "GENE_DIST", "symbol": "DEMO2", "chrom": CHROM, "start": 4500, "end": 5400, "strand": "-"},
    ]
    with (ROOT / "genes.tsv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(genes[0]), delimiter="\t"); writer.writeheader(); writer.writerows(genes)
    config = {
        "synthetic": True, "genome_assembly": "synthetic-demo-v1",
        "normalization": "same synthetic per-base track scale across all samples; no statistical normalization",
        "region": {"chrom": CHROM, "start": 0, "end": SIZE, "label": "chrDemo:1-10000"},
        "genes_tsv": "genes.tsv", "output_dir": "results",
        "parameters": {"peak_bin_bp": 100, "min_peak_signal": 8, "merge_gap_bp": 0,
                       "morphology_flank_bp": 100, "max_distance_bp": 5000,
                       "min_abs_log2fc": 0.5, "pseudocount": 1.0},
        "samples": samples,
    }
    (ROOT / "experiment.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
