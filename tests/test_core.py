import csv
import json
from pathlib import Path

import pytest

from gel_core.analysis import Gene, Sample, _contrast_rows, _fold_change, _merge_bins, discover_candidates, run_config, validate_interact
from gel_core.coordinates import Interval, signed_relative_position, tss
from gel_core.morphology import classify_strand_geometry


def test_interval_conventions_and_strand_tss():
    interval = Interval("chr1", 10, 20)
    assert interval.midpoint == 15
    assert interval.distance_to_point(19) == 0
    assert interval.distance_to_point(20) == 1
    assert interval.overlaps(Interval("chr1", 19, 30))
    assert not interval.overlaps(Interval("chr1", 20, 30))
    assert tss(100, 200, "+") == 100
    assert tss(100, 200, "-") == 199
    assert signed_relative_position(80, 100, "+") == -20
    assert signed_relative_position(220, 199, "-") == -21


def test_strand_geometry_for_divergent_asymmetric_and_low_signal():
    assert classify_strand_geometry(10, 0, 0, 10) == "divergent_outward"
    assert classify_strand_geometry(10, 0, 0, 1) == "unidirectional_outward_candidate"
    assert classify_strand_geometry(0, 10, 0, 10) == "unidirectional_or_readthrough"
    assert classify_strand_geometry(0, 0, 0, 1) == "low_signal_ambiguous"


def test_peak_merge_is_deterministic_and_respects_gaps():
    assert _merge_bins([(10, 20, 2), (20, 30, 3), (50, 60, 4)], 0) == [(10, 30, 5), (50, 60, 4)]


def test_log_fold_change_retains_missing_uncertainty_with_one_replicate():
    lfc, se = _fold_change([4], [8], 1)
    assert lfc > 0
    assert se is None


def test_fold_change_delta_method_se_is_in_log2_units():
    lfc, se = _fold_change([9, 11], [19, 21], 1)
    assert lfc > 0
    assert se is not None and 0 < se < 1


class FakeTrack:
    chrom_sizes = {"chrDemo": 1000}

    def __init__(self, factor):
        self.factor = factor

    def sum_abs(self, chrom, start, end):
        return max(0, end - start) * self.factor


def test_candidate_discovery_scans_declared_region_and_marks_overlaps():
    samples = [Sample("c", "control", "1h", "A", "", "", True)]
    tracks = {"c": (FakeTrack(0.1), FakeTrack(0.1))}
    config = {"region": {"chrom": "chrDemo", "start": 0, "end": 1000},
              "parameters": {"peak_bin_bp": 100, "min_peak_signal": 15,
                             "merge_gap_bp": 0, "morphology_flank_bp": 100}}
    genes = [Gene("g1", "A", "chrDemo", 400, 700, "+")]
    candidates = discover_candidates(config, samples, tracks, genes)
    assert candidates
    assert all(candidate["chrom"] == "chrDemo" for candidate in candidates)
    assert any(candidate["overlaps_promoter"] or candidate["overlapping_gene_bodies"] for candidate in candidates)


def test_all_in_range_candidate_genes_are_retained_and_ties_are_not_forced():
    samples = [
        Sample("cA", "control", "1h", "A", "", "", True),
        Sample("cB", "control", "1h", "B", "", "", True),
        Sample("tA", "drug", "1h", "A", "", "", False),
        Sample("tB", "drug", "1h", "B", "", "", False),
    ]
    tracks = {s.sample_id: (FakeTrack(0.01 if s.is_control else 0.02), FakeTrack(0)) for s in samples}
    genes = [Gene("g1", "A", "chrDemo", 600, 700, "+"), Gene("g2", "B", "chrDemo", 800, 900, "-")]
    candidates = [{"enhancer_id": "e1", "chrom": "chrDemo", "start": 200, "end": 250,
                   "midpoint": 225, "morphology": "divergent_outward", "overlaps_promoter": False,
                   "overlapping_gene_bodies": "", "candidate_source": "test"}]
    config = {"parameters": {"max_distance_bp": 1000, "pseudocount": 1, "min_abs_log2fc": 0.1}}
    rows = _contrast_rows(candidates, genes, samples, tracks, config)
    assert {row["gene_id"] for row in rows} == {"g1", "g2"}
    assert len(rows) == 2
    assert all(row["gene_q_value"] is None for row in rows)
    assert all(row["link_id"].startswith("e1__") for row in rows)


def test_interact_export_structure_and_anchor_validation(tmp_path):
    good = tmp_path / "links.interact"
    good.write_text('track type=interact name="GEL"\nchr1\t10\t50\te1_g1\t700\t1\tresp\t31,112,79\tchr1\t10\t20\te1\t.\tchr1\t40\t50\tg1\t+\n')
    assert validate_interact(good)["valid"] is True
    good.write_text('track type=interact name="GEL"\nchr1\t10\t50\te1_g1\t700\n')
    with pytest.raises(ValueError, match="expected 18"):
        validate_interact(good)


def test_small_bigwig_integration_uses_real_tracks_and_exports_pairs(tmp_path):
    pytest.importorskip("pyBigWig")
    config_path = Path(__file__).resolve().parents[1] / "examples" / "demo" / "experiment.json"
    summary = run_config(config_path, tmp_path / "out")
    assert summary["enhancer_count"] >= 2
    assert summary["candidate_pair_count"] >= 2
    assert validate_interact(tmp_path / "out" / "gel_links.interact")["valid"]
    sample_metadata = (tmp_path / "out" / "sample_metadata.tsv").read_text(encoding="utf-8")
    assert str(tmp_path) not in sample_metadata
    provenance = json.loads((tmp_path / "out" / "provenance.json").read_text(encoding="utf-8"))
    assert provenance["sample_tracks"][0]["plus"]["sha256"]
