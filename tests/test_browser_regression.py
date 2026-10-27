"""Independent Python checks against frozen browser v0.3 output.

Analytical synthetic coverage avoids pyBigWig availability on Windows. Values
follow the published fixture generator, with its A offset and >=0.2 storage
threshold; browser float32 BigWig values are compared within 1e-6 log2 units.
"""
import json
from pathlib import Path

import pytest

from gel_core.analysis import Gene, Sample, _contrast_rows, discover_candidates

ROOT = Path(__file__).resolve().parents[1]
GOLDEN = json.loads((ROOT / "examples/regression/v03-single-contrast.json").read_text())


class AnalyticalTrack:
    chrom_sizes = {"chrDemo": 10000}

    def __init__(self, strand, treatment):
        self.strand, self.treatment = strand, treatment

    def sum_abs(self, chrom, start, end):
        if chrom != "chrDemo":
            return 0
        total = 0.0
        for pos in range(max(0, start), min(10000, end)):
            value = .01
            if 1950 <= pos < 2050:
                if (self.strand == "minus" and pos < 2000) or (self.strand == "plus" and pos >= 2000):
                    value += 8 * (2.2 if self.treatment else 1)
            if 3950 <= pos < 4050 and self.strand == "plus":
                value += 7 * (.25 if self.treatment else 1)
            if 6800 <= pos < 7200:
                value += 2
            if 6000 <= pos < 7500:
                value += 8 if self.treatment else 4
            value -= .03
            total += value if value >= .2 else 0
        return total


@pytest.mark.parametrize("time", ["1h", "2h", "4h"])
@pytest.mark.parametrize("perturbation", ["DrugA", "DrugB"])
def test_python_response_pairing_matches_frozen_browser_signal_results(time, perturbation):
    genes = [Gene(g["geneId"], g["symbol"], g["chrom"], g["start"], g["end"], g["strand"]) for g in GOLDEN["bigwig"]["genes"]]
    samples = [Sample("control_A", "control", time, "A", "", "", True), Sample(f"{perturbation}_{time}_A", perturbation, time, "A", "", "", False)]
    tracks = {s.sample_id: (AnalyticalTrack("plus", not s.is_control), AnalyticalTrack("minus", not s.is_control)) for s in samples}
    config = {"region": {"chrom": "chrDemo", "start": 0, "end": 10000}, "parameters": {"peak_bin_bp": 100, "min_peak_signal": 8, "merge_gap_bp": 0, "morphology_flank_bp": 250, "max_distance_bp": 5000, "min_abs_log2fc": .5, "pseudocount": 1}}
    candidates = discover_candidates(config, samples, tracks, genes)
    assert [(c["start"], c["end"], c["morphology"]) for c in candidates] == [(e["start"], e["end"], e["morphology"]) for e in GOLDEN["bigwig"]["enhancers"]]
    rows = _contrast_rows(candidates, genes, samples, tracks, config)
    expected = {(r["gene_id"], r["enhancer_start"], r["enhancer_end"]): r for r in GOLDEN["bigwig"]["links"]}
    assert len(rows) == len(expected) == 6
    for row in rows:
        target = expected[row["gene_id"], row["enhancer_start"], row["enhancer_end"]]
        assert row["gene_body_log2fc"] == pytest.approx(target["gene_log2fc"], abs=1e-6)
        assert row["enhancer_log2fc"] == pytest.approx(target["enhancer_log2fc"], abs=1e-6)
        for field in ["tss", "distance_bp", "transcription_oriented_offset_bp", "direction_agreement", "evidence_tier", "overlaps_promoter"]:
            assert row[field] == target[field]
        assert row["gene_q_value"] is None and row["enhancer_q_value"] is None


def test_synthetic_experiment_has_one_shared_control_registry_and_independent_replicate_labels():
    manifest = json.loads((ROOT / "examples/synthetic_experiment/experiment_manifest.json").read_text())
    control = [s for s in manifest["samples"] if s["condition"] == "control"]
    assert {s["id"] for s in control} == {"control_A", "control_B"}
    assert {s["biologicalReplicate"] for s in control} == {"A", "B"}
    assert all(s["batch"] == s["matchedBlock"] == "" for s in manifest["samples"])
    assert len({s["id"] for s in manifest["samples"]}) == 18
    assert len(manifest["contrasts"]) == 8
