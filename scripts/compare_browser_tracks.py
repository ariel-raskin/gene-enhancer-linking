"""Read-only independent regional oracle. Run real chromosomes in a compute allocation.

Outputs contain study coordinates; keep real-data outputs outside the public repo.
"""
import argparse,csv,json,time,resource
from gel_core.browser_reference import IntervalSignal,reference_region

def main():
    p=argparse.ArgumentParser();p.add_argument('--tracks',nargs=4,required=True);p.add_argument('--genes',required=True);p.add_argument('--chrom',required=True);p.add_argument('--start',type=int,default=0);p.add_argument('--end',type=int);p.add_argument('--output',required=True);p.add_argument('--signal-floor',type=float,default=.08);p.add_argument('--distance',type=int,default=100000);a=p.parse_args()
    import pyBigWig
    started=time.monotonic();handles=[pyBigWig.open(f) for f in a.tracks]
    with open(a.genes) as f:genes=list(csv.DictReader(f,delimiter='\t'))
    for g in genes:g['start'],g['end']=int(g.get('start',g.get('gene_start'))),int(g.get('end',g.get('gene_end')))
    chromosomes=sorted({g['chrom'] for g in genes}) if a.chrom=='all' else [a.chrom]
    result={'enhancers':[],'geneStats':[],'links':[]}
    for chrom in chromosomes:
        length=handles[0].chroms()[chrom];end=a.end or length
        tracks=[IntervalSignal(h.intervals(chrom,a.start,end)) for h in handles]
        current=reference_region(genes,tracks,chrom,a.start,end,distance=a.distance,signal_floor=a.signal_floor,morphology_classes=['divergent_outward','asymmetric_divergent','unidirectional_outward_candidate','unidirectional_or_readthrough','bidirectional_mixed_geometry','low_signal_ambiguous','asymmetric_uncertain'])
        for key in result:result[key].extend(current[key])
        del tracks,current
    result['validation']={'elapsedSeconds':time.monotonic()-started,'maxRssKb':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'chrom':a.chrom,'start':a.start,'end':end,'trackFiles':a.tracks,'method':'independent Web contract oracle; legacy demo CLI definitions preserved'}
    with open(a.output,'w') as f:json.dump(result,f)
    for h in handles:h.close()
    print(json.dumps({'elapsedSeconds':result['validation']['elapsedSeconds'],'maxRssKb':result['validation']['maxRssKb'],'genes':len(result['geneStats']),'peaks':len(result['enhancers']),'links':len(result['links'])}))
if __name__=='__main__':main()
