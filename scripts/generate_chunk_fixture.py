"""Redistributable synthetic chunk-boundary fixture; requires optional pyBigWig."""
import csv
import json
from pathlib import Path
import sys
import pyBigWig

out = Path(sys.argv[1]) if len(sys.argv)>1 else Path('examples/synthetic_chunks')
out.mkdir(parents=True, exist_ok=True)
chroms = {'chrA': 10103, 'chrB': 3071, 'chrEmpty':5003, 'alt_test':251}
# disjoint signal segments (not every locus is an enhancer): boundary, long, asymmetric, divergent, weak.
segments = [(0,160,3,1),(900,1200,0,8),(1200,1600,8,0),(1900,2000,0,5),(2000,2050,3,0),(2700,3500,1,3),(3500,4300,3,1),(10000,10103,2,2)]
genes=[['START','START','chrA',0,160,'+'],['NEG','NEG','chrA',1500,1900,'-'],['OVER','OVER','chrA',2900,3200,'+'],['NEAR','NEAR','chrA',4200,4700,'-'],['END','END','chrA',10060,10103,'-'],['B','B','chrB',1000,1800,'+'],['EMPTY','EMPTY','chrEmpty',1,501,'+']]
with (out/'genes.tsv').open('w',newline='') as f:
 w=csv.writer(f,delimiter='\t',lineterminator='\n');w.writerow(['gene_id','symbol','chrom','start','end','strand']);w.writerows(genes)
for condition in ['control','treatment']:
 for strand in ['plus','minus']:
  bw=pyBigWig.open(str(out/f'{condition}.{strand}.bw'),'w');bw.addHeader(list(chroms.items()),maxZooms=0)
  for chrom,length in chroms.items():
   rows=segments if chrom=='chrA' else [(800,900,0,4),(900,1000,4,0),(1000,1800,2,2)] if chrom=='chrB' else []
   for start,end,plus,minus in rows:
    value=plus if strand=='plus' else -minus
    if value:
     factor=1 if condition=='control' else .3 if start==1900 or start==2000 else 2
     bw.addEntries([chrom],[start],ends=[end],values=[float(value*factor)])
  bw.close()
roles=['controlPlus','controlMinus','treatmentPlus','treatmentMinus','annotation']
paths=['control.plus.bw','control.minus.bw','treatment.plus.bw','treatment.minus.bw','genes.tsv']
files=[{'id':p,'path':f'synthetic_chunks/{p}','role':r,'size':(out/p).stat().st_size,'lastModified':0,'recognition':'synthetic','evidence':[]} for r,p in zip(roles,paths)]
c={'id':'synthetic_chunks','label':'Boundary synthetic 1h','control':'control','treatment':'treatment','perturbation':'synthetic','timePoint':'1h','confirmed':False,'excluded':False,'assembly':'synthetic-chunks-v1','trackAssembly':'synthetic-chunks-v1','model':'','normalization':'synthetic identical scale; negative minus','controlSampleIds':[],'treatmentSampleIds':[],'controlTrackSampleIds':[],'treatmentTrackSampleIds':[],'controlTrackSource':'averaged','treatmentTrackSource':'averaged','mode':'bigwig','statisticalSource':'auto','bindings':dict(zip(roles,paths)),'geneFormat':'tsv','geneCoordinates':'zero_based_half_open','enhancerCoordinates':'','proposedFrom':'synthetic manifest','fileIds':paths}
manifest={'schema_version':2,'product':'GEL Web','experimentId':'synthetic-chunks','assembly':'synthetic-chunks-v1','annotationProvenance':'artificial genes','model':'','normalization':'synthetic shared scale','scope':{'chrom':'chrA','start':0,'end':10103},'genomicScope':{'version':1,'mode':'genome','chromosomes':['chrA'],'excludedContigs':[]},'execution':{'chunkBases':1000,'queryConcurrency':1,'maxPairs':100000},'regionalStatistics':False,'samples':[],'conditions':[{'id':'control','label':'control'},{'id':'treatment','label':'treatment'}],'contrasts':[c],'files':files}
(out/'experiment_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
