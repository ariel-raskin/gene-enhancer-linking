"""Generate a small public cross-runtime oracle without BigWig dependencies."""
import csv,json,struct
from pathlib import Path
from gel_core.browser_reference import IntervalSignal,reference_region
root=Path(__file__).resolve().parents[1]
genes=list(csv.DictReader((root/'examples/synthetic_chunks/genes.tsv').open(),delimiter='\t'))
for g in genes:g['start'],g['end']=int(g['start']),int(g['end'])
segments=[(0,160,3,1),(900,1200,0,8),(1200,1600,8,0),(1900,2000,0,5),(2000,2050,3,0),(2700,3500,1,3),(3500,4300,3,1),(10000,10103,2,2)]
tracks=[]
for treat,strand in [(False,0),(False,1),(True,0),(True,1)]:
 rows=[]
 for start,end,plus,minus in segments:
  value=plus if strand==0 else -minus
  if value:rows.append((start,end,struct.unpack('f',struct.pack('f',value*(1 if not treat else .3 if start in [1900,2000] else 2)))[0]))
 tracks.append(IntervalSignal(rows))
result=reference_region(genes,tracks,'chrA',0,10103,distance=1500)
(root/'examples/regression/v05-python-contract.json').write_text(json.dumps(result,indent=2)+'\n')
