import type { Link } from "./analysis";
import { promoterAnchor } from "./analysis";
export const evidenceColors:Record<string,string>={high:"#1f704f",moderate:"#81b56d",weak:"#dd9d38",discordant:"#be4c3a",insufficient:"#828c89"};
export function locusForLink(row:Link,chromLength?:number){const s=Math.min(row.enhancer_start,row.tss),e=Math.max(row.enhancer_end,row.tss+1),pad=Math.max(1000,Math.ceil((e-s)*0.15));return {chrom:row.chrom,start:Math.max(0,s-pad),end:Math.min(chromLength??Number.MAX_SAFE_INTEGER,e+pad)};}
export function anchorForLink(row:Link,chromLength?:number){return promoterAnchor(row,chromLength?{[row.gene_chrom]:chromLength}:{});}
export function clipLocus(start:number,end:number,length?:number){const width=Math.max(40,Math.min(2000000,Math.round(end-start)));const s=Math.max(0,Math.min(Math.round(start),Math.max(0,(length??Number.MAX_SAFE_INTEGER)-width)));return {start:s,end:Math.min(length??Number.MAX_SAFE_INTEGER,s+width)};}

export function binSignal(blocks:{start:number;end:number;score:number}[],start:number,end:number,minus:boolean,n=800){
 const values=new Float64Array(n),width=(end-start)/n;let positive=0,negative=0;
 for(const b of blocks){const v=Number(b.score);if(!Number.isFinite(v))continue;if(v>0)positive++;if(v<0)negative++;
  const from=Math.max(0,Math.floor((b.start-start)/width)),to=Math.min(n-1,Math.ceil((b.end-start)/width)-1);
  for(let j=from;j<=to;j++){const overlap=Math.max(0,Math.min(b.end,start+(j+1)*width)-Math.max(b.start,start+j*width));values[j]+=overlap*(minus?-Math.abs(v):v)/width;}
 }return {values:Array.from(values),positive,negative};
}
