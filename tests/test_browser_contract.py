from gel_core.browser_reference import IntervalSignal, reference_region
from pathlib import Path
import csv,json,math

ROOT=Path(__file__).resolve().parents[1]

def test_reference_zero_adjacent_negative_and_boundary_sums():
    s=IntervalSignal([(0,10,-2),(10,20,3)])
    assert s.total(5,15)==25
    assert s.total(10,10)==0
    assert s.total(20,30)==0

def test_public_boundary_oracle_records():
    golden=json.loads((ROOT/'examples/regression/v05-python-contract.json').read_text())
    assert [(e['start'],e['end']) for e in golden['enhancers']]==[(0,200),(900,1600),(1900,2100),(2700,4300),(10000,10103)]
    assert any(e['morphology']=='asymmetric_divergent' for e in golden['enhancers'])
    assert any(l['overlaps_gene_body'] for l in golden['links'])
    assert all(math.isfinite(l['gene_log2fc']) for l in golden['links'])
