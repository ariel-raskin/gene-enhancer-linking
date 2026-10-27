import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DEFAULT_PARAMETERS } from "./analysis";
import { inspectFiles } from "./smart-importer";
import { assessContrast, experimentLinks, fileKey, geneSummaries, parseSamples, proposeContrasts, readExperimentMetadata, requestsForContrast, sampleFindings, type Experiment } from "./experiment";
import { runExperiment } from "./run-experiment";
import { executeAnalysis } from "./execute-analysis";
import { makeExperimentArtifacts } from "./experiment-exports";
import { AnalysisCache } from "./analysis-cache";
const root=fileURLToPath(new URL("../../../../examples/",import.meta.url));
const parameters={...DEFAULT_PARAMETERS,maxDistanceBp:5000,mergeGapBp:0};
async function diskFile(path:string,relativePath?:string){const file=new File([await readFile(root+path)],path.split("/").at(-1)!,{lastModified:0});if(relativePath)Object.defineProperty(file,"webkitRelativePath",{value:relativePath});return file;}
async function fixture(reverse=false){
  const paths=await readdir(root+"synthetic_experiment",{recursive:true,withFileTypes:true});
  const files=await Promise.all(paths.filter(p=>p.isFile()).map(p=>{const path=`${p.parentPath}/${p.name}`.replaceAll("\\","/");const rel=path.slice(root.replaceAll("\\","/").length);return diskFile(rel,rel);}));
  const imported=await inspectFiles(reverse?files.reverse():files);const manifestFile=imported.find(f=>f.role==="experimentMetadata")!;
  const data=readExperimentMetadata(await manifestFile.file.text(),imported);
  const exp:Experiment={...data,conditions:[...new Set(data.contrasts.flatMap(c=>[c.control,c.treatment]))].sort().map(id=>({id,label:id})),contrasts:data.contrasts.map(c=>({...c,confirmed:true})),files:imported.map(f=>({id:fileKey(f),path:f.path,role:f.role,size:f.file.size,lastModified:f.file.lastModified,recognition:f.recognition,evidence:f.evidence}))};
  return {imported,exp,registry:Object.fromEntries(imported.map(f=>[fileKey(f),f.file]))};
}
describe("contrast-aware experiment model and execution",()=>{
 it("groups eight contrast folders deterministically without discarding identical tables in different comparisons",async()=>{
   const {imported}=await fixture();const a=proposeContrasts(imported);const b=proposeContrasts([...imported].reverse());
   expect(a.map(c=>[c.id,c.bindings])).toEqual(b.map(c=>[c.id,c.bindings]));expect(a).toHaveLength(8);expect(a.every(c=>!c.confirmed)).toBe(true);
   expect(a.filter(c=>c.bindings.normalizedPpGb)).toHaveLength(8);expect(a.every(c=>!c.bindings.designTable)).toBe(true);
 });
 it("represents shared control samples once and distinguishes biological identity from batch and matched block",async()=>{
   const {exp}=await fixture();expect(exp.samples.filter(s=>s.condition==="control").map(s=>s.id)).toEqual(["control_A","control_B"]);
   expect(exp.samples).toHaveLength(18);expect(exp.samples.every(s=>!s.batch&&!s.matchedBlock)).toBe(true);
   expect(exp.contrasts.filter(c=>c.controlSampleIds.includes("control_A"))).toHaveLength(8);
   expect(sampleFindings(exp.samples)).toEqual([]);expect(exp.conditions.filter(c=>c.id==="control")).toHaveLength(1);
   const replicate=exp.contrasts.find(c=>c.id.includes("DrugB_1h"))!;expect(replicate.controlSampleIds).toEqual(["control_A","control_B"]);expect(replicate.controlTrackSampleIds).toEqual(["control_A"]);
 });
 it("runs six valid comparisons; preserves missing and incompatible contrasts and separate descriptive layers",async()=>{
   const {exp,registry}=await fixture();const events:string[]=[];
   const run=await runExperiment(exp,registry,parameters,e=>{if(e.type==="state")events.push(e.outcome.status);});
   expect(run.outcomes.filter(o=>o.status==="successful")).toHaveLength(6);expect(run.outcomes.filter(o=>o.status==="incomplete")).toHaveLength(2);
   expect(run.outcomes.find(o=>o.contrastId.includes("DrugA_8h"))?.findings.join(" ")).toContain("enhancerChange");
   expect(run.outcomes.find(o=>o.contrastId.includes("DrugB_8h"))?.findings.join(" ")).toContain("Incompatible assembly");
   expect(experimentLinks(exp,run.outcomes)).toHaveLength(18);expect(experimentLinks(exp,run.outcomes,"track")).toHaveLength(18);
   expect(run.resources.concurrentAnalyses).toBe(1);expect(run.resources.cacheHits).toBeGreaterThan(0);expect(run.resources.cacheTextBytes).toBeLessThanOrEqual(8*1024*1024);expect(run.resources.cacheSignalBytesEstimate).toBeLessThanOrEqual(16*1024*1024);
   expect(run.resources.retainedRows).toBe(36);expect(events.filter(s=>s==="running")).toHaveLength(6);
   for(const o of run.outcomes.filter(o=>o.result?.trackEvidence))expect(o.result!.trackEvidence!.links.every(r=>r.gene_padj===null&&r.enhancer_padj===null)).toBe(true);
 });
 it("matches each independent execution and does not change earlier outputs when contrasts are added",async()=>{
   const {exp,registry}=await fixture();const all=await runExperiment(exp,registry,parameters,()=>{});
   for(const o of all.outcomes.filter(o=>o.status==="successful")){
     const c=exp.contrasts.find(c=>c.id===o.contrastId)!;const req=requestsForContrast(c,exp,registry,parameters);
     expect(o.result!.links).toEqual((await executeAnalysis(req[0])).links);
     if(req[1])expect(o.result!.trackEvidence!.links).toEqual((await executeAnalysis(req[1])).links);
   }
   const only={...exp,contrasts:exp.contrasts.slice(0,1)};const single=await runExperiment(only,registry,parameters,()=>{});
   expect(single.outcomes[0].result!.links).toEqual(all.outcomes[0].result!.links);
 });
 it("is invariant to selected-file order and exports deterministic candidate IDs and zero-based arcs",async()=>{
   const a=await fixture();const b=await fixture(true);const r1=await runExperiment(a.exp,a.registry,parameters,()=>{});const r2=await runExperiment(b.exp,b.registry,parameters,()=>{});
   const out1=makeExperimentArtifacts(a.exp,r1.outcomes,parameters);const out2=makeExperimentArtifacts(b.exp,r2.outcomes,parameters);
   for(const key of ["gel_experiment_links.tsv","gel_experiment_links.csv","gel_gene_summary.tsv","gel_experiment_links.bedpe","gel_experiment_links.interact"])expect(out1[key]).toBe(out2[key]);
   const rows=experimentLinks(a.exp,r1.outcomes);expect(new Set(rows.map(r=>r.candidate_id)).size).toBe(rows.length);
   expect(rows.some(r=>r.evidence_tier==="discordant")).toBe(true);expect(rows.some(r=>r.evidence_tier==="insufficient")).toBe(true);
   for(const line of out1["gel_experiment_links.bedpe"].split("\n")){const f=line.split("\t");expect(f).toHaveLength(12);expect(+f[1]).toBeGreaterThanOrEqual(0);expect(+f[2]).toBeGreaterThan(+f[1]);expect(decodeURIComponent(f[10])).toContain("_vs_control");}
   expect(out1["gel_experiment_links.interact"].split("\n").slice(1).every(l=>l.split("\t").length===18)).toBe(true);
   expect(Object.keys(out1).filter(k=>k.endsWith("/gel_links.bedpe"))).toHaveLength(6);
   expect(geneSummaries(a.exp,r1.outcomes)).toHaveLength(6);
 });
 it("retains successful contrasts after one runtime failure, and records excluded comparisons",async()=>{
   const {exp,registry}=await fixture();exp.contrasts[7].excluded=true;
   const run=await runExperiment(exp,registry,parameters,()=>{},async(req,report)=>{if(req.id.includes("DrugA_2h"))throw new Error("Synthetic corrupt source");return executeAnalysis(req,report);});
   expect(run.outcomes.filter(o=>o.status==="successful")).toHaveLength(5);expect(run.outcomes.filter(o=>o.status==="failed")).toHaveLength(1);expect(run.outcomes.filter(o=>o.status==="excluded")).toHaveLength(1);
   expect(run.outcomes.find(o=>o.status==="failed")?.findings).toEqual(["Synthetic corrupt source"]);
 });
 it("does not invent replicate aggregation, accept contradictory sample assignments, or run unconfirmed metadata",async()=>{
   const {exp}=await fixture();const c=structuredClone(exp.contrasts[0]);c.confirmed=false;expect(assessContrast(c,exp).findings.join(" ")).toContain("confirm inferred");
   c.confirmed=true;c.controlTrackSource="replicate";expect(assessContrast(c,exp).findings.join(" ")).toContain("exactly one sample");
   c.controlSampleIds=["DrugA_1h_A"];expect(assessContrast(c,exp).findings.join(" ")).toContain("conflicts with control");
   c.controlSampleIds=["no_such_sample"];expect(assessContrast(c,exp).findings.join(" ")).toContain("not in the sample registry");
 });
 it("detects conflicting sample metadata and preserves explicitly stated blocks separately from technical batch",()=>{
   const xs=parseSamples("sample_id\tcondition\treplicate\tbatch\tmatched_block\nS\tcontrol\tA\tlane1\tseries1\nS\tdrug\tA\tlane1\tseries1","fixture");
   expect(xs[0]).toMatchObject({biologicalReplicate:"A",batch:"lane1",matchedBlock:"series1"});expect(sampleFindings(xs)).toEqual(["Conflicting metadata for sample S."]);
   expect(()=>parseSamples("sample_id,condition\n,drug","x")).toThrow("missing sample");
 });
 it("stops scheduling after cancellation without changing already completed results",async()=>{
   const {exp,registry}=await fixture();const controller=new AbortController();
   const run=await runExperiment(exp,registry,parameters,e=>{if(e.type==="state"&&e.outcome.status==="successful")controller.abort();},undefined,controller.signal);
   expect(run.outcomes[0].status).toBe("successful");expect(run.outcomes.slice(1).every(o=>o.status==="cancelled")).toBe(true);
 });
 it("rejects unsupported resource scopes, invalid thresholds, malformed manifests and too many contrasts",async()=>{
   const {exp,registry,imported}=await fixture();exp.scope.end=50_000_001;expect(assessContrast(exp.contrasts[0],exp).findings.join(" ")).toContain("up to 50 Mb");
   await expect(runExperiment(exp,registry,{...parameters,pseudocount:0},()=>{})).rejects.toThrow("thresholds");
   await expect(runExperiment({...exp,contrasts:Array(25).fill(exp.contrasts[0])},registry,parameters,()=>{})).rejects.toThrow("24 contrasts");
   expect(()=>readExperimentMetadata('{"schema_version":1}',imported)).toThrow("schema_version 2");
 });
 it("caches by exact File identity, never by a colliding filename",async()=>{
   const cache=new AnalysisCache();const a=new File(["A"],"same.txt"),b=new File(["B"],"same.txt");expect(await cache.readText(a)).toBe("A");expect(await cache.readText(b)).toBe("B");expect(await cache.readText(a)).toBe("A");expect(cache.hits).toBe(1);
 });
 it("requires a choice between complete statistical catalogs and can execute the R-DESeq2 branch inside an experiment",async()=>{
   const {exp,registry,imported}=await fixture();const c=exp.contrasts[0];
   const files=await inspectFiles([
    new File(["Chr,Start,End,Region_ID,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj\nchrDemo,4501,4550,E1,20,1.1,.2,5,.01,.02"],"r_results.csv",{lastModified:0}),
    new File(["Gene,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj\nGENE_CONC,100,1,.2,5,.01,.02"],"gene_effects.csv",{lastModified:0})]);
   for(const f of files){registry[fileKey(f)]=f.file;exp.files.push({id:fileKey(f),path:f.path,role:f.role,size:f.file.size,lastModified:0,recognition:f.recognition,evidence:f.evidence});c.bindings[f.role]=fileKey(f);}
   expect(assessContrast(c,exp).findings.join(" ")).toContain("Both statistical catalogs");c.statisticalSource="erna-r";c.enhancerCoordinates="one_based_inclusive";expect(assessContrast(c,exp).status).toBe("pending");
   const run=await runExperiment({...exp,contrasts:[c]},registry,parameters,()=>{});expect(run.outcomes[0].result!.links).toHaveLength(2);expect(run.outcomes[0].result!.links[0].enhancer_start).toBe(4500);expect(run.outcomes[0].result!.trackEvidence!.links).toHaveLength(6);
   const manifest={...exp,files:exp.files.map((f,i)=>i?f:{...f,size:f.size+1})};expect(()=>readExperimentMetadata(JSON.stringify(manifest),[...imported,...files])).toThrow("fingerprint differs");
 });
 it("groups eNRSA directories without a vs token and preserves flat combined input as one comparison",async()=>{
   const f=(path:string)=>{const file=new File(["Transcript\tGene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\nT\tG\t1\t1\t.1\t2\t.1\t.2"],"gb_change.txt");Object.defineProperty(file,"webkitRelativePath",{value:path});return file;};
   expect(proposeContrasts(await inspectFiles([f("experiment/1hr/known_gene/gb_change.txt"),f("experiment/2hr/known_gene/gb_change.txt")]))).toHaveLength(2);
   const items=await inspectFiles([await diskFile("demo/data/ctrl_A_plus.bw"),await diskFile("demo/data/ctrl_A_minus.bw"),await diskFile("demo/data/treat_A_plus.bw"),await diskFile("demo/data/treat_A_minus.bw"),await diskFile("demo/genes.tsv"),await diskFile("demo/enrsa/gb_change.txt"),await diskFile("demo/enrsa/normalized_pp_gb.txt"),await diskFile("demo/enrsa/Enhancer_change.txt")]);
   expect(proposeContrasts(items)).toHaveLength(1);
 });
 it("rejects statistical library declarations that contradict normalized measurement columns",async()=>{
   const {exp,registry}=await fixture();const c=exp.contrasts[0];const id=c.bindings.normalizedPpGb!;registry[id]=new File([(await registry[id].text()).replace("gbc_control_B","gbc_unknown_B")],"normalized_pp_gb.txt");
   const run=await runExperiment({...exp,contrasts:[c]},registry,parameters,()=>{});expect(run.outcomes[0].status).toBe("failed");expect(run.outcomes[0].findings.join(" ")).toContain("control_B");
 });
 it("limits conflicting sample metadata to comparisons that reference that sample",async()=>{
   const {exp}=await fixture();const s=exp.samples.find(s=>s.id==="DrugB_4h_A")!;exp.samples.push({...s,condition:"another condition"});
   expect(assessContrast(exp.contrasts[0],exp).status).toBe("pending");expect(assessContrast(exp.contrasts.find(c=>c.id.includes("DrugB_4h"))!,exp).status).toBe("incomplete");
 });
});

describe("frozen v0.3 scientific output regression",()=>{
 it("preserves all BigWig, eNRSA and R-DESeq2 candidate records and effects",async()=>{
   const golden=JSON.parse(await readFile(root+"regression/v03-single-contrast.json","utf8"));const p=golden.parameters;const contrast=golden.contrast;
   const en=await executeAnalysis({id:"one",kind:"enrsa",parameters:p,metadata:{assembly:"synthetic-demo-v1",contrast,source:"enrsa",model:"Synthetic fixture"},files:{gbChange:await diskFile("demo/enrsa/gb_change.txt"),normalizedPpGb:await diskFile("demo/enrsa/normalized_pp_gb.txt"),enhancerChange:await diskFile("demo/enrsa/Enhancer_change.txt")}});
   const bw=await executeAnalysis({id:"one",kind:"bigwig",request:{parameters:p,contrast,genomeAssembly:"synthetic-demo-v1",normalization:"synthetic shared scale",region:{chrom:"chrDemo",start:0,end:10000},annotationFile:await diskFile("demo/genes.tsv"),annotationFormat:"tsv",annotationCoordinates:"zero_based_half_open",files:{controlPlus:await diskFile("demo/data/ctrl_A_plus.bw"),controlMinus:await diskFile("demo/data/ctrl_A_minus.bw"),treatmentPlus:await diskFile("demo/data/treat_A_plus.bw"),treatmentMinus:await diskFile("demo/data/treat_A_minus.bw")}}});
   const r=await executeAnalysis({id:"one",kind:"erna-r",parameters:p,metadata:{assembly:"synthetic-demo-v1",contrast,model:"Synthetic fixture",geneFormat:"tsv",geneCoordinates:"zero_based_half_open",enhancerCoordinates:"one_based_inclusive"},files:{geneAnnotation:await diskFile("demo/genes.tsv"),geneResults:new File(["Gene,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj\nGENE_CONC,100,1,.2,5,.01,.02"],"genes.csv"),enhancerResults:new File(["Chr,Start,End,Region_ID,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj\nchrDemo,4501,4550,E1,20,1.1,.2,5,.01,.02"],"r.csv")}});
   for(const [result,expected] of [[en,golden.enrsa],[bw,golden.bigwig],[r,golden.rDeseq]] as const)expect({genes:result.genes,enhancers:result.enhancers,geneStats:result.geneStats,links:result.links}).toEqual(expected);
 });
});
