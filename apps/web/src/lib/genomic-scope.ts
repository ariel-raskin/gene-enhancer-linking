export type Region = { chrom: string; start: number; end: number };
export type GenomicScope = { version: 1; mode: "interval" | "chromosomes" | "genome"; chromosomes: string[]; excludedContigs: string[] };
export type ExecutionLimits = { chunkBases: number; queryConcurrency: number; maxPairs: number };
export const DEFAULT_EXECUTION: ExecutionLimits = { chunkBases: 250_000, queryConcurrency: 1, maxPairs: 100_000 };
export const SIGNAL_BUDGET = 64 * 1024 * 1024;
export const COMPRESSED_BUDGET = 8 * 1024 * 1024;
export const MAX_FEATURES = 200_000;
export function validateExecution(value: ExecutionLimits = DEFAULT_EXECUTION) {
  if (!Number.isInteger(value.chunkBases) || value.chunkBases < 100 || value.chunkBases > 1_000_000 || ![1,2].includes(value.queryConcurrency) || !Number.isInteger(value.maxPairs) || value.maxPairs < 1 || value.maxPairs > 200_000) throw new Error("Choose chunks of 100–1,000,000 bases, query concurrency 1–2 and an output limit of 1–200,000 pairs.");
  return value;
}
export function validateScope(scope: GenomicScope) {
  if (scope.version !== 1 || !["interval","chromosomes","genome"].includes(scope.mode) || !Array.isArray(scope.chromosomes) || !Array.isArray(scope.excludedContigs) || [...scope.chromosomes,...scope.excludedContigs].some(s=>typeof s!=="string"||!s.trim())) throw new Error("Invalid genomic scope manifest.");
  if(scope.mode==="chromosomes"&&!scope.chromosomes.length)throw new Error("Select at least one chromosome.");
}
export function resolveScope(scope: GenomicScope, interval: Region, dictionaries: Record<string,number>[], annotated: string[]) {
  validateScope(scope);
  const excluded = new Set(scope.excludedContigs);
  const names = [...new Set(scope.mode==="interval"?[interval.chrom]:scope.mode==="genome"?annotated:scope.chromosomes)].filter(c=>!excluded.has(c)).sort();
  if (!names.length) throw new Error("Scope is empty after explicit contig exclusions.");
  const regions = names.map(chrom=>{
    const length=dictionaries[0][chrom];
    if (!Number.isSafeInteger(length)||length<=0||dictionaries.some(d=>d[chrom]!==length))throw new Error(`Missing or incompatible chromosome ${chrom}: every selected track must have the same contig length. Explicitly exclude unwanted contigs; names are not aliased.`);
    if(length>0x7fffffff)throw new Error(`Chromosome ${chrom} exceeds the signed 32-bit coordinate limit of the current typed-array reader.`);
    const r=scope.mode==="interval"?interval:{chrom,start:0,end:length};
    if(!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start<0||r.end<=r.start||r.end>length)throw new Error(`Invalid scope interval for ${chrom}.`);
    return r;
  });
  return {regions,totalBases:regions.reduce((s,r)=>s+r.end-r.start,0),excludedContigs:[...excluded].sort(),unselectedContigs:[...new Set(dictionaries.flatMap(d=>Object.keys(d)))].filter(c=>!names.includes(c)).sort(),annotationContigsWithoutTracks:annotated.filter(c=>!dictionaries[0][c]).sort()};
}
/** Cores tile the scope on its ORIGINAL bin grid. No halo can bound arbitrary merged peaks. */
function chunkWidth(requestedBases:number,bin:number){
  if(!Number.isSafeInteger(bin)||bin<1||bin>requestedBases)throw new Error("Effective peak bin width must not exceed the configured chunk size.");
  return Math.floor(requestedBases/bin)*bin;
}
export function chunkCount(region:Region,requestedBases:number,bin:number){return Math.ceil((region.end-region.start)/chunkWidth(requestedBases,bin));}
export function* iterateChunks(region:Region,requestedBases:number,bin:number){
  const width=chunkWidth(requestedBases,bin);
  for(let start=region.start;start<region.end;start+=width)yield {...region,start,end:Math.min(start+width,region.end)};
}
/** Small-plan helper for inspection/tests; execution uses the lazy iterator. */
export function planChunks(region: Region, requestedBases: number, bin: number) {
  if(chunkCount(region,requestedBases,bin)>100_000)throw new Error("Plan exceeds 100,000 chunks; increase chunk size or narrow scope.");
  return [...iterateChunks(region,requestedBases,bin)];
}
export function appendActive(peaks:{start:number;end:number}[],start:number,end:number,gap:number) {
  const last=peaks.at(-1);
  if(last&&start<=last.end+gap)last.end=end;else peaks.push({start,end});
}
