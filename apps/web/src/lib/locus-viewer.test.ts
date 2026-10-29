import {describe,it,expect} from "vitest";
import {binSignal,anchorForLink,locusForLink,clipLocus} from "./locus-viewer";
import {linksToBedpe,type Link} from "./analysis";
describe("locus viewer coordinates and signal",()=>{
 it("uses the identical strand-aware, clipped BEDPE anchor",()=>{const row={chrom:"chr1",gene_chrom:"chr1",enhancer_start:10,enhancer_end:20,tss:995,gene_strand:"-",link_id:"L",evidence_tier:"high"} as Link;const a=anchorForLink(row,1000);expect(a).toEqual({start:895,end:1000});const fields=linksToBedpe([row],{chr1:1000}).split("\t");expect(fields.slice(1,6)).toEqual(["10","20","chr1","895","1000"]);expect(locusForLink(row,1000)).toEqual({chrom:"chr1",start:0,end:1000});expect(clipLocus(-10,100,1000)).toEqual({start:0,end:110});});
 it("bins exact overlaps and preserves the negative minus display",()=>{const b=[{start:0,end:1,score:-2}];const v=binSignal(b,0,40,true);for(const x of v.values.slice(0,20))expect(x).toBeCloseTo(-2,12);expect(v.values.slice(20).every(x=>x===0)).toBe(true);const positive=binSignal([{start:0,end:1,score:2}],0,40,true);for(const x of positive.values.slice(0,20))expect(x).toBeCloseTo(-2,12);});
});
