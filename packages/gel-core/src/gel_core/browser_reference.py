"""Independent reference for the frozen Web v0.3 coverage contract.

The older demo CLI discovers from control-only signal and excludes central bases
in morphology. It is preserved. This oracle explicitly uses the Web contract:
mean of four tracks per base; complete merged peak; control morphology including
both half-open center flanks. It is for cross-runtime validation, not a new score.
"""
from bisect import bisect_right
import math
from .morphology import classify_strand_geometry


class IntervalSignal:
    def __init__(self, records):
        self.records = list(records or [])
        self.ends = [r[1] for r in self.records]

    def total(self, start, end):
        total = 0.0
        for i in range(bisect_right(self.ends, start), len(self.records)):
            left, right, score = self.records[i]
            if left >= end:
                break
            if math.isfinite(score):
                total += max(0, min(end, right) - max(start, left)) * abs(score)
        return total


def reference_region(genes, tracks, chrom, start, end, *, bin_bp=100, signal_floor=.08,
                     merge_gap=100, distance=100000, pseudocount=1, min_gene=.5,
                     min_enhancer=.5, magnitude_gap=2, morphology_classes=(),
                     exclude_promoters=False, exclude_body=False, promoter_up=1000,
                     promoter_down=100, require_direction=True, compare_magnitude=True):
    """Four ordered IntervalSignals: control+/−, treatment+/−; BED gene dictionaries."""
    tracks = [IntervalSignal(r for r in track.records if r[0]<end and r[1]>start) for track in tracks]
    width = max(10, int(bin_bp))
    peaks = []
    for left in range(start, end, width):
        right = min(end, left + width)
        mean = sum(t.total(left, right) for t in tracks) / (4 * (right-left))
        if mean * (right-left) / (right-left) >= signal_floor:
            if peaks and left <= peaks[-1][1] + merge_gap:
                peaks[-1][1] = right
            else:
                peaks.append([left, right])
    selected = [g for g in genes if g['chrom'] == chrom and g['end'] > start-distance and g['start'] < end+distance]
    def effect(left, right):
        c = tracks[0].total(left,right) + tracks[1].total(left,right)
        t = tracks[2].total(left,right) + tracks[3].total(left,right)
        return math.log2((t+pseudocount)/(c+pseudocount)), (c+t)/2
    enhancers = []
    for left, right in peaks:
        center = (left+right)//2
        lo, hi = max(left,center-250),min(right,center+250)
        morphology = classify_strand_geometry(tracks[1].total(lo,center),tracks[0].total(lo,center),tracks[1].total(center,hi),tracks[0].total(center,hi))
        if morphology_classes and morphology not in morphology_classes:
            continue
        lfc, baseline = effect(left,right)
        enhancers.append(dict(featureId=f'{chrom}:{left}-{right}:bw{len(enhancers)+1}',chrom=chrom,start=left,end=right,log2fc=lfc,baseMean=baseline,morphology=morphology))
    stats = {g['gene_id']:effect(g['start'],g['end']) for g in selected}
    # Coordinate index, independent implementation. Preserve long overlapping peaks.
    ordered = sorted(enhancers,key=lambda e:e['start'])
    starts = [e['start'] for e in ordered]
    max_length = max((e['end']-e['start'] for e in ordered),default=0)
    links=[]
    for g in selected:
        point = g['start'] if g['strand']=='+' else g['end']-1
        lower = bisect_right(starts,point-distance-max_length-1)
        upper = bisect_right(starts,point+distance)
        for e in ordered[lower:upper]:
            dist = e['start']-point if point<e['start'] else point-e['end']+1 if point>=e['end'] else 0
            if dist>distance:
                continue
            pleft = point - (promoter_up if g['strand']=='+' else promoter_down)
            pright = point + (promoter_down if g['strand']=='+' else promoter_up)+1
            promoter = e['start']<pright and pleft<e['end']
            body = e['start']<g['end'] and g['start']<e['end']
            if exclude_promoters and promoter or exclude_body and body:
                continue
            glfc=stats[g['gene_id']][0];elfc=e['log2fc']
            informative=abs(glfc)>=min_gene and abs(elfc)>=min_enhancer
            same=((0 if glfc==0 else 1 if glfc>0 else -1)==(0 if elfc==0 else 1 if elfc>0 else -1)) if informative else None
            gap=abs(abs(glfc)-abs(elfc))
            if informative:
                tier = 'discordant' if not same and require_direction else 'weak' if not same else 'weak' if compare_magnitude and gap>magnitude_gap else 'moderate'
            else:
                tier = 'weak' if glfc*elfc>0 and abs(glfc)>=min_gene*.5 and abs(elfc)>=min_enhancer*.5 else 'insufficient'
            links.append(dict(link_id=e['featureId']+'__'+g['gene_id'],gene_id=g['gene_id'],enhancer_id=e['featureId'],chrom=chrom,enhancer_start=e['start'],enhancer_end=e['end'],gene_start=g['start'],gene_end=g['end'],tss=point,distance_bp=dist,gene_log2fc=glfc,enhancer_log2fc=elfc,morphology=e['morphology'],evidence_tier=tier,direction_agreement=same,overlaps_promoter=promoter,overlaps_gene_body=body))
    return dict(enhancers=enhancers,geneStats=[dict(featureId=g['gene_id'],log2fc=stats[g['gene_id']][0],baseMean=stats[g['gene_id']][1]) for g in selected],links=links)
