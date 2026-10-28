import type { ResultSink } from "./result-store";
import { importGenes, buildLinks, iterateLinks, type Differential, type Gene, type Link } from "./analysis";
import { open, classifyGeometry, type BigWigRequest } from "./bigwig";
import { readLocalText } from "./read-local-text";
import { appendActive, iterateChunks, chunkCount, resolveScope, validateExecution, DEFAULT_EXECUTION, SIGNAL_BUDGET, COMPRESSED_BUDGET, MAX_FEATURES, type Region } from "./genomic-scope";

type Signal = { starts: Int32Array; ends: Int32Array; scores: Float32Array };
const trackFiles=(r:BigWigRequest)=>[r.files.controlPlus,r.files.controlMinus,r.files.treatmentPlus,r.files.treatmentMinus];
type Reader = Awaited<ReturnType<typeof open>>;
const bytes = (s: Signal) => new Set([s.starts.buffer,s.ends.buffer,s.scores.buffer]);
export function sumSignal(s: Signal, start: number, end: number) {
  let low=0,high=s.ends.length,total=0;
  while(low<high){const mid=(low+high)>>>1;if(s.ends[mid]<=start)low=mid+1;else high=mid;}
  for(let i=low;i<s.starts.length&&s.starts[i]<end;i++) if(Number.isFinite(s.scores[i]))total+=Math.max(0,Math.min(end,s.ends[i])-Math.max(start,s.starts[i]))*Math.abs(s.scores[i]);
  return total;
}
/** Capped exact-File, exact-query cache. No whole-chromosome coverage retention. */
export class ChunkCache {
  private entries: {file:File;key:string;value:Signal;bytes:number}[]=[];
  bytes=0;hits=0;
  get(file:File,key:string){const entry=this.entries.find(e=>e.file===file&&e.key===key);if(entry){this.hits++;return entry.value;}}
  set(file:File,key:string,value:Signal){const size=[...bytes(value)].reduce((n,b)=>n+b.byteLength,0);if(size>8*1024*1024)return;while(this.bytes+size>8*1024*1024&&this.entries.length)this.bytes-=this.entries.shift()!.bytes;this.entries.push({file,key,value,bytes:size});this.bytes+=size;}
}
async function loadInputs(request:BigWigRequest,signal?:AbortSignal) {
  if(!request.genomeAssembly.trim()||!request.normalization.trim()||!request.contrast.trim())throw new Error("Assembly, normalization and contrast are required.");
  if(request.annotationFile.size>150*1024*1024)throw new Error("Annotation exceeds 150 MiB. Supply a compact, explicit representative gene TSV.");
  const genes=importGenes(await readLocalText(request.annotationFile),request.annotationFormat,request.annotationCoordinates);
  if(genes.length>MAX_FEATURES)throw new Error("More than 200,000 annotation features; supply explicit representative gene features.");
  const entries:Reader[]=[];for(const file of trackFiles(request))entries.push(await open(file,signal));
  const dictionaries=entries.map(e=>Object.fromEntries(Object.entries(e.header.refsByName).map(([name,id])=>[name,e.header.refsByNumber[id].length])));
  return {genes,entries,dictionaries};
}
function resolveInputPlan(request:BigWigRequest,input:Awaited<ReturnType<typeof loadInputs>>){
  const {genes,dictionaries}=input;
  const scope=request.genomicScope??{version:1,mode:"interval",chromosomes:[],excludedContigs:[]};
  const plan=resolveScope(scope,request.region,dictionaries,[...new Set(genes.map(g=>g.chrom))]);
  if(scope.mode==="interval"&&plan.totalBases>request.parameters.maxGenomeBases)throw new Error("Interval scope exceeds the configured regional base limit; select a chromosome scope instead.");
  // Missing annotation contigs are reported; requested contigs must be compatible across all tracks.
  for(const gene of genes)if(plan.regions.some(r=>r.chrom===gene.chrom)&&gene.end>dictionaries[0][gene.chrom])throw new Error(`Annotation exceeds chromosome bounds: ${gene.geneId}.`);
  return plan;
}
export async function inspectBigWigScope(request:BigWigRequest){
  const input=await loadInputs(request);const {genes,dictionaries}=input;const limits=validateExecution(request.execution??DEFAULT_EXECUTION);const bin=Math.max(10,Math.floor(request.parameters.peakBinBp));
  const metadata={availableContigs:dictionaries[0],annotationGenes:genes.length,passes:2,limits,signalArraysEstimateAtOneRecordPerBase:limits.chunkBases*4*12*limits.queryConcurrency,signalBudgetBytes:SIGNAL_BUDGET,wholeGenomeCapacityCertified:false};
  try{const plan=resolveInputPlan(request,input);const chunksPerPass=plan.regions.reduce((n,r)=>n+chunkCount(r,limits.chunkBases,bin),0);return {...metadata,...plan,chunksPerPass,scopeExecutable:chunksPerPass*2<=100_000,scopeError:chunksPerPass*2>100_000?"Plan exceeds 100,000 chunk passes; increase chunk size or narrow scope.":null};}
  catch(error){return {...metadata,scopeExecutable:false,scopeError:error instanceof Error?error.message:String(error)};}

}
/** Active interval sweep: each feature is measured exactly once in each disjoint core it intersects. */
function overlapSweep(intervals:{start:number;end:number}[]) {
  const ordered=intervals.map((v,i)=>({...v,i})).sort((a,b)=>a.start-b.start||a.end-b.end);let cursor=0,active:typeof ordered=[];
  return (core:Region)=>{active=active.filter(g=>g.end>core.start);while(cursor<ordered.length&&ordered[cursor].start<core.end){const g=ordered[cursor++];if(g.end>core.start)active.push(g);}return active;};
}
function response(id:string,chrom:string,start:number,end:number,sums:Float64Array,pseudocount:number):Differential{
  const c=sums[0]+sums[1],t=sums[2]+sums[3];return {featureId:id,chrom,start,end,log2fc:Math.log2((t+pseudocount)/(c+pseudocount)),se:null,pvalue:null,padj:null,baseMean:(c+t)/2,source:"local BigWig signal discovery",sourceId:id,sourceCoordinates:"BigWig query returns 0-based half-open intervals"};
}
export async function runChunkedBigWigAnalysis(request:BigWigRequest,progress:(message:string)=>void,signal?:AbortSignal,cache=new ChunkCache(),sink?:ResultSink) {
  const initialCacheHits=cache.hits;
  const started=performance.now(),limits=validateExecution(request.execution??DEFAULT_EXECUTION),bin=Math.max(10,Math.floor(request.parameters.peakBinBp));
  const abort=()=>{if(signal?.aborted)throw new DOMException("Analysis cancelled; current contrast is incomplete.","AbortError");};abort();
  const input=await loadInputs(request,signal);const {genes,entries,dictionaries}=input;const plan=resolveInputPlan(request,input);abort();
  const totalChunks=plan.regions.reduce((n,r)=>n+chunkCount(r,limits.chunkBases,bin)*2,0);
  if(totalChunks>100_000)throw new Error("Plan exceeds 100,000 chunk passes; increase chunk size or narrow scope before execution.");
  const metrics={completedChunks:0,totalChunks,indexedBytesEstimated:0,peakInFlightSignalBytes:0,chunkBases:limits.chunkBases,queryConcurrency:limits.queryConcurrency,workerCount:1,cacheHits:0};
  const files=trackFiles(request);
  async function query(core:Region) {
    abort();const key=`${core.chrom}:${core.start}-${core.end}`;const estimates=[];
    for(const e of entries)estimates.push(await e.bw.getRegionByteSize(core.chrom,core.start,core.end,{signal}));
    const compressed=estimates.reduce((a,b)=>a+b,0);if(compressed>COMPRESSED_BUDGET/limits.queryConcurrency)throw new Error(`Compressed query budget exceeded at ${key}. Reduce chunk size. No result is marked complete.`);
    metrics.indexedBytesEstimated+=compressed;
    const data:Signal[]=[];
    for(let i=0;i<entries.length;i++){
      abort();const cached=cache.get(files[i],key);if(cached){data.push(cached);continue;}
      const result=await entries[i].bw.getFeaturesAsArrays(core.chrom,core.start,core.end,{signal});
      if(result.isSummary)throw new Error("Unexpected zoomed BigWig data; exact unzoomed signal is required.");
      for(let j=0;j<result.starts.length;j++)if(result.starts[j]<0||result.ends[j]<=result.starts[j]||(j>0&&result.starts[j]<result.ends[j-1]))throw new Error(`Unsorted, overlapping or invalid BigWig records at ${key}; exact nonoverlapping coverage is required.`);
      const size=[...bytes(result)].reduce((n,b)=>n+b.byteLength,0);
      if(size>SIGNAL_BUDGET/(4*limits.queryConcurrency))throw new Error(`Decoded track budget exceeded at ${key}. Reduce chunk size.`);
      data.push(result);cache.set(files[i],key,result);
    }
    const size=data.reduce((n,s)=>n+[...bytes(s)].reduce((x,b)=>x+b.byteLength,0),0);
    metrics.peakInFlightSignalBytes=Math.max(metrics.peakInFlightSignalBytes,size*limits.queryConcurrency);
    return data;
  }
  // Bounded batch concurrency. Consume in genomic order regardless of I/O completion order.
  async function pass(chunks:Iterable<Region>,label:string,consume:(core:Region,data:Signal[])=>void){
    let cores:Region[]=[];
    const batch=async()=>{
      abort();const results=await Promise.all(cores.map(query));
      for(let j=0;j<cores.length;j++){abort();consume(cores[j],results[j]);metrics.completedChunks++;progress(`${cores[j].chrom} · ${label} · chunk ${metrics.completedChunks}/${totalChunks} · ${cores[j].start.toLocaleString()}–${cores[j].end.toLocaleString()}`);}
      await new Promise<void>(resolve=>setTimeout(resolve,0));cores=[];
    };
    for(const core of chunks){cores.push(core);if(cores.length===limits.queryConcurrency)await batch();}
    if(cores.length)await batch();
  }
  const chromosomeSummaries:{chrom:string;bases:number;genes:number;rawPeaks:number;retainedPeaks:number;pairs:number}[]=[];
  const allGenes:Gene[]=[],allStats:Differential[]=[],allEnhancers:Differential[]=[],links:Link[]=[];
  for(const region of plan.regions){
    abort();const p=request.parameters;
    const selected=genes.filter(g=>g.chrom===region.chrom&&g.end>region.start-p.maxDistanceBp&&g.start<region.end+p.maxDistanceBp);
    const geneSums=selected.map(()=>new Float64Array(4)),geneSweep=overlapSweep(selected);
    const peaks:{start:number;end:number}[]=[];
    await pass(iterateChunks(region,limits.chunkBases,bin),"discover",(core,data)=>{
      for(let start=core.start;start<core.end;start+=bin){const end=Math.min(start+bin,core.end);let sum=0;for(const s of data)sum+=sumSignal(s,start,end);const mean=sum/(4*(end-start));
        // Same division/multiplication as the frozen regional implementation.
        if((mean*(end-start))/(end-start)>=p.minMeanSignal)appendActive(peaks,start,end,p.mergeGapBp);
      }
      if(peaks.length+(sink?0:allEnhancers.length)>MAX_FEATURES)throw new Error("Peak summary budget exceeded (200,000). Raise the signal floor or narrow the scope; no truncation is returned.");
      for(const g of geneSweep(core))for(let i=0;i<4;i++)geneSums[g.i][i]+=sumSignal(data[i],Math.max(g.start,core.start===region.start?g.start:core.start),Math.min(g.end,core.end===region.end?g.end:core.end));
    });
    const sums=peaks.map(()=>new Float64Array(4)),geometry=peaks.map(()=>new Float64Array(4)),peakSweep=overlapSweep(peaks);
    await pass(iterateChunks(region,limits.chunkBases,bin),"measure",(core,data)=>{
      for(const peak of peakSweep(core)){
        const start=Math.max(peak.start,core.start),end=Math.min(peak.end,core.end);for(let i=0;i<4;i++)sums[peak.i][i]+=sumSignal(data[i],start,end);
        const center=Math.floor((peak.start+peak.end)/2),left=Math.max(peak.start,center-250),right=Math.min(peak.end,center+250),v=geometry[peak.i];
        v[0]+=sumSignal(data[1],Math.max(left,core.start),Math.min(center,core.end));v[1]+=sumSignal(data[0],Math.max(left,core.start),Math.min(center,core.end));
        v[2]+=sumSignal(data[1],Math.max(center,core.start),Math.min(right,core.end));v[3]+=sumSignal(data[0],Math.max(center,core.start),Math.min(right,core.end));
      }
    });
    const enhancers:Differential[]=[];
    for(let i=0;i<peaks.length;i++){
      const [ml,pl,mr,pr]=geometry[i],morphology=classifyGeometry(ml,pl,mr,pr);if(p.morphologyClasses.length&&!p.morphologyClasses.includes(morphology))continue;
      const peak=peaks[i],index=enhancers.length+1,id=`${region.chrom}:${peak.start}-${peak.end}:bw${index}`;
      enhancers.push({...response(id,region.chrom,peak.start,peak.end,sums[i],p.pseudocount),sourceId:`bw${index}`,morphology});
    }
    const stats=selected.map((g,i)=>({...response(g.geneId,g.chrom,g.start,g.end,geneSums[i],p.pseudocount),strand:g.strand,source:"local BigWig gene-body integral",sourceId:g.geneId,sourceCoordinates:"Gene annotation interval; descriptive integrated normalized signal"}));
    // Reuse the regional pairing index and enforce the output cap as rows are generated.
    const morphologyById=new Map(enhancers.map(e=>[e.featureId,e.morphology!]));
    // Shared interval index is constructed once inside buildLinks, with an explicit cap.
    const metadata={contrast:request.contrast,compatibility:{status:"Compatibility unverified" as const,checks:[]},morphologyById,source:"bigwig" as const,maxLinks:sink?Number.MAX_SAFE_INTEGER:limits.maxPairs-links.length};
    let pairs=0;
    if(sink){
      pairs=await sink.partition(region.chrom,{genes:selected,geneStats:stats,enhancers,chromosomeSizes:{[region.chrom]:dictionaries[0][region.chrom]}},iterateLinks(selected,stats,enhancers,p,metadata));
      progress(`${region.chrom} · persisted ${pairs.toLocaleString()} candidate rows; next chromosome`);
    }else{
      const batch=buildLinks(selected,stats,enhancers,p,metadata);pairs=batch.length;
      for(const row of batch)links.push(row);for(const g of selected)allGenes.push(g);for(const s of stats)allStats.push(s);for(const e of enhancers)allEnhancers.push(e);
      if(JSON.stringify({genes:allGenes,geneStats:allStats,enhancers:allEnhancers,links}).length*2>96*1024*1024)throw new Error("Result summary budget exceeds 96 MiB. Narrow the scope or distance. The current contrast is incomplete; no truncated success is returned.");
    }
    chromosomeSummaries.push({chrom:region.chrom,bases:region.end-region.start,genes:selected.length,rawPeaks:peaks.length,retainedPeaks:enhancers.length,pairs});
  }
  metrics.cacheHits=cache.hits-initialCacheHits;
  links.sort((a,b)=>a.gene_symbol.localeCompare(b.gene_symbol)||a.distance_bp-b.distance_bp||a.enhancer_id.localeCompare(b.enhancer_id));
  return {genes:allGenes,enhancers:allEnhancers,geneStats:allStats,links,validation:{mode:"Chunked BigWig-only descriptive",persisted:!!sink,genomeAssembly:request.genomeAssembly,scope:request.genomicScope,scopePlan:plan,inputFileBytes:files.reduce((n,f)=>n+f.size,request.annotationFile.size),chromosomeSummaries,execution:metrics,complete:true,truncated:false,normalization:request.normalization,pValuesProduced:false,chromosomeDictionaryAgreement:true,chromosomeSizes:Object.fromEntries(plan.regions.map(r=>[r.chrom,dictionaries[0][r.chrom]])),elapsedMs:Math.round(performance.now()-started),warnings:["Descriptive track ratios, not differential p-values or causal links.","Regional parity retains full boundary-crossing BigWig records when integrating gene envelopes; include full genes in interval scopes. Chromosome scopes have no external boundary records.","Whole-genome capacity depends on explicit output and device budgets; no silent contig exclusions."]}};
}
