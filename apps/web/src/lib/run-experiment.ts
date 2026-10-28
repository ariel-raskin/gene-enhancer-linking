import type { ResultSink } from "./result-store";
import { type Parameters } from "./analysis";
import { type ExportInput } from "./exports";
import { executeAnalysis, type AnalysisRequest } from "./execute-analysis";
import { ChunkCache } from "./chunked-bigwig";
import { AnalysisCache } from "./analysis-cache";
import { assessContrast, requestsForContrast, MAX_CONTRASTS, MAX_EXPERIMENT_ROWS, MAX_RESULT_BYTES, type Experiment, type Outcome } from "./experiment";

export type ExperimentEvent = { type: "state"; outcome: Outcome; completed: number; total: number } | { type: "progress"; contrastId: string; message: string };
export async function runExperiment(exp: Experiment, files: Record<string, File>, parameters: Parameters,
  emit: (event: ExperimentEvent) => void, execute?: (request: AnalysisRequest, report: (message: string) => void) => Promise<ExportInput>, signal?: AbortSignal, persistence?:{sink:(contrast:string,layer:"primary"|"track")=>ResultSink;snapshot:()=>Promise<{rows:number;bytes:number;writeMs?:number}>;record?:(outcomes:Outcome[])=>Promise<void>}) {
  if (exp.contrasts.length > MAX_CONTRASTS) throw new Error(`At most ${MAX_CONTRASTS} contrasts per experiment.`);
  if (Object.values(parameters).some(v=>typeof v==="number"&&(!Number.isFinite(v)||v<0)) || parameters.maxPadj>1 || parameters.peakBinBp<1 || parameters.maxDistanceBp<1 || parameters.pseudocount<=0) throw new Error("Analysis thresholds must be finite and valid; distance, bin size and pseudocount must be positive, and adjusted p-value must be between 0 and 1.");
  const cache = new AnalysisCache(); const chunkCache = new ChunkCache(); const perform = execute ?? ((req, report) => executeAnalysis(req, report, cache, signal, chunkCache));
  const referenceLengths=new Map<string,number>();
  const outcomes: Outcome[] = []; let rows = 0, bytes = 0;
  for (const c of exp.contrasts) {
    const assessment = assessContrast(c, exp); const initial = { contrastId: c.id, status: assessment.status, findings: assessment.findings };
    if (assessment.status !== "pending") { outcomes.push(initial); await persistence?.record?.(outcomes); emit({type:"state",outcome:initial,completed:outcomes.length,total:exp.contrasts.length}); continue; }
    if (signal?.aborted) { const o: Outcome = { ...initial, status: "cancelled", findings: ["Experiment cancelled; not executed."] }; outcomes.push(o); await persistence?.record?.(outcomes); emit({ type:"state", outcome:o, completed:outcomes.length, total:exp.contrasts.length }); continue; }
    emit({ type:"state", outcome:{...initial,status:"running"},completed:outcomes.length,total:exp.contrasts.length });
    const started = performance.now(); let outcome: Outcome;
    try {
      const requests = requestsForContrast(c,exp,files,parameters); const results: ExportInput[] = [];
      for (const req of requests) {
        if (signal?.aborted) throw new Error("Cancelled before next evidence layer.");
        const report=(message:string)=>emit({type:"progress" as const,contrastId:c.id,message});
        let count=0;
        const sink=persistence?.sink(c.id,results.length===0?"primary":"track");
        const counted=sink?{partition:async(...args: [string, import("./result-store").ResultPartition, Iterable<import("./analysis").Link>])=>{const n=await sink.partition(...args);count+=n;return n;}}:undefined;
        const result:ExportInput= sink&&!execute ? await executeAnalysis(req,report,cache,signal,chunkCache,counted) : await perform(req,report);
        if(sink){result.validation.persistedRows=count;result.validation.pairCount=count;}
        results.push(result);
      }
      for(const layer of results){const ids=new Set<string>();for(const row of layer.links){if(ids.has(row.link_id))throw new Error(`Duplicate candidate identifier within one evidence layer: ${row.link_id}. Review duplicated source feature annotations.`);ids.add(row.link_id);}}
      const result = results[0];
      if(assessment.statisticalEvidence){
        const optional=result.validation.optionalInputProvenance as {measurementSamples?:string[];geneBodySampleColumns?:string[];designSamples?:string[]}|undefined;
        const declared=[...new Set([...c.controlSampleIds,...c.treatmentSampleIds])];
        const measured=optional?.geneBodySampleColumns?.length?[...new Set(optional.geneBodySampleColumns.map(s=>s.replace(/^gb[cd]_/,"")))]:optional?.measurementSamples;
        if(declared.length&&measured?.length){const missing=declared.filter(id=>!measured.includes(id));if(missing.length)throw new Error(`Declared statistical sample IDs are absent from normalized gene-body measurements: ${missing.join(", ")}.`);}
        if(declared.length&&optional?.designSamples?.length&&(declared.length!==new Set(optional.designSamples).size||declared.some(id=>!optional.designSamples!.includes(id))))throw new Error("Declared statistical sample IDs conflict with the supplied contrast-specific design table.");
        result.validation.statisticalSampleProvenance={declaredSampleIds:declared,measurementSamples:measured??null,designSamples:optional?.designSamples??null,status:declared.length&&measured?.length?"gene-body sample ID consistency checked; model identity remains unverified":"source sample identities unverified"};
      }
      result.validation={...result.validation,experimentProvenanceWarnings:assessment.warnings};
      if (results.length > 1) { result.trackEvidence = results[1]; result.validation = { ...result.validation, compatibility:{status:"Compatibility unverified",checks:[{name:"Separate evidence",status:"unverified",detail:"Track and model effects retained separately. No statistics propagated by overlap."}]}, warnings:[...(result.validation.warnings as string[] ?? []),"Combined sources remain separate; matching user declarations do not independently verify compatibility."] }; }
      const observedLengths=new Map<string,number>();
      for(const layer of results)for(const [chrom,length] of Object.entries((layer.validation.chromosomeSizes??{}) as Record<string,number>)){
        if(referenceLengths.has(chrom)&&referenceLengths.get(chrom)!==length)throw new Error(`Incompatible chromosome length across contrasts: ${chrom}. Earlier valid results are preserved.`);
        observedLengths.set(chrom,length);
      }
      const addedRows = persistence ? Number(result.validation.persistedRows??0)+Number(result.trackEvidence?.validation.persistedRows??0) : result.links.length + (result.trackEvidence?.links.length ?? 0);
      const addedBytes = JSON.stringify(result).length * 2;
      if (!persistence && (rows + addedRows > MAX_EXPERIMENT_ROWS || bytes + addedBytes > MAX_RESULT_BYTES)) throw new Error("Experiment retained-output budget exceeded (200,000 links or 128 MiB serialized-size estimate). Narrow the region or select fewer contrasts. Earlier successes are retained.");
      for(const [chrom,length] of observedLengths)referenceLengths.set(chrom,length);
      rows += addedRows; bytes += addedBytes;
      outcome={contrastId:c.id,status:"successful",findings:assessment.warnings,result,elapsedMs:Math.round(performance.now()-started),resultBytes:addedBytes};
    } catch (error) { outcome={contrastId:c.id,status:signal?.aborted?"cancelled":"failed",findings:[error instanceof Error?error.message:String(error)],elapsedMs:Math.round(performance.now()-started)}; }
    outcomes.push(outcome); await persistence?.record?.(outcomes); emit({type:"state",outcome,completed:outcomes.length,total:exp.contrasts.length});
  }
  const saved=persistence?await persistence.snapshot():null;
  return { outcomes, resources:{retainedRows:saved?.rows??rows,retainedResultBytesEstimate:saved?.bytes??bytes,persistent:!!persistence,storageWriteMs:saved?.writeMs??0,cacheTextBytes:cache.textBytes,cacheSignalBytesEstimate:cache.blockBytes,cacheHits:cache.hits,chunkCacheBytes:chunkCache.bytes,chunkCacheHits:chunkCache.hits,concurrentAnalyses:1} };
}
