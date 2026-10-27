"""Compare an exported browser experiment ZIP with an independent Python oracle.

Real-data reports and ZIPs must stay outside the public repository.
"""
import argparse,csv,json,zipfile
from pathlib import Path

def compare(oracle_path, archive_path, contrast=None):
    oracle=json.loads(Path(oracle_path).read_text())
    with zipfile.ZipFile(archive_path) as z:
        rows=list(csv.DictReader(z.read('gel_experiment_links.tsv').decode().splitlines(),delimiter='\t'))
        summaries=list(csv.DictReader(z.read('gel_gene_summary.tsv').decode().splitlines(),delimiter='\t'))
        if contrast:
            rows=[r for r in rows if r['contrast_id']==contrast]
            summaries=[r for r in summaries if r['contrast_id']==contrast]
        expected={r['link_id']:r for r in oracle['links']}
        assert len(expected)==len(rows),(len(expected),len(rows))
        assert set(expected)=={r['link_id'] for r in rows},'Candidate membership differs'
        error=0.0
        for r in rows:
            e=expected[r['link_id']]
            for key in ['enhancer_start','enhancer_end','gene_start','gene_end','tss','distance_bp']:
                assert int(r[key])==e[key],key
            for key in ['morphology','evidence_tier']:
                assert r[key]==e[key],key
            for key in ['gene_log2fc','enhancer_log2fc']:
                delta=abs(float(r[key])-e[key]);error=max(error,delta);assert delta<1e-9,(key,delta)
            for key in ['overlaps_promoter','overlaps_gene_body']:
                assert (r[key]=='true')==e[key],key
        stats={r['featureId']:r for r in oracle['geneStats']}
        assert len(stats)==len(summaries),'Gene coverage differs'
        for row in summaries:
            delta=abs(float(row['gene_log2fc'])-stats[row['gene_id']]['log2fc']);error=max(error,delta);assert delta<1e-9
        if contrast:
            bed=z.read('contrasts/'+contrast+'/gel_enhancers.bed').decode().splitlines()
            actual={(f[0],int(f[1]),int(f[2]),f[3]) for line in bed if (f:=line.split('\t'))}
            expected_peaks={(r['chrom'],r['start'],r['end'],r['featureId']) for r in oracle['enhancers']}
            assert actual==expected_peaks,'Peak coordinates differ'
    return {'genes':len(stats),'peaks':len(oracle['enhancers']),'pairs':len(rows),'maxLog2Error':error,'candidateMembershipAndCoordinatesExact':True,'allGeneEffectsChecked':True}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--oracle',required=True);p.add_argument('--archive',required=True);p.add_argument('--contrast');p.add_argument('--output',required=True);a=p.parse_args()
    result=compare(a.oracle,a.archive,a.contrast);Path(a.output).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
