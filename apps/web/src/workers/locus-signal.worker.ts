import { open } from "@/lib/bigwig";
import {binSignal} from "@/lib/locus-viewer";
const scope=self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage=async(e:MessageEvent<{files:File[];chrom:string;start:number;end:number}>)=>{
 try {
  const {files,chrom,start,end}=e.data;
  if(files.length!==4||start<0||end<=start||end-start>2000000)throw new Error("Select four tracks and a locus up to 2 Mb.");
  const entries=await Promise.all(files.map(f=>open(f)));
  const lengths=entries.map(({header})=>{const id=header.refsByName[chrom];if(id===undefined)throw new Error(`Contig ${chrom} is missing from a track.`);return header.refsByNumber[id].length;});
  if(lengths.some(n=>n!==lengths[0])||end>lengths[0])throw new Error("Track chromosome lengths differ or the locus exceeds the chromosome.");
  const sizes=await Promise.all(entries.map(({bw})=>bw.getRegionByteSize(chrom,start,end)));
  if(sizes.reduce((a,b)=>a+b,0)>64*1024*1024)throw new Error("Signal query exceeds 64 MiB compressed; zoom in.");
  const tracks=await Promise.all(entries.map(async({bw},i)=>{
   const blocks=await bw.getFeatures(chrom,start,end);if(blocks.length>250000)throw new Error("Too many signal intervals in this view; zoom in.");
   return binSignal(blocks.map(b=>({start:b.start,end:b.end,score:Number(b.score)})),start,end,i%2===1);
  }));
  scope.postMessage({tracks,chromLength:lengths[0]});
 }catch(error){scope.postMessage({error:error instanceof Error?error.message:String(error)});}
};
export {};
