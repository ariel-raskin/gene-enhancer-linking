import { linksToBedpe,linksToInteract,type Gene,type Differential } from "./analysis";
import {decorateExperimentLink} from "./experiment";
import {makeExperimentArtifacts,experimentBedpe,exportChromosomeSizes} from "./experiment-exports";
import {ResultStore,type SavedRun,type Layer,type StoredFeature} from "./result-store";
import type {Artifact} from "./streaming-zip";
const encoder=new TextEncoder();
async function* text(s:string){let at=0;while(at<s.length){let end=Math.min(at+16384,s.length);if(end<s.length&&/[\uD800-\uDBFF]/.test(s[end-1]))end--;yield encoder.encode(s.slice(at,end));at=end;}}
/** Encoding buffers never exceed 64 KiB, regardless of row or table size. */
async function* encode(lines:AsyncIterable<string>){let buffer="",first=true;for await(const line of lines){buffer+=(first?"":"\n")+line;first=false;while(buffer.length>=16384){const end=/[\uD800-\uDBFF]/.test(buffer[16383])?16383:16384;yield encoder.encode(buffer.slice(0,end));buffer=buffer.slice(end);}}if(buffer)yield encoder.encode(buffer);}
const quote=(v:unknown,d:string)=>{const s=String(v??"");return s.includes(d)||/["\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;};
async function* table(rows:AsyncIterable<Record<string,unknown>>,csv=false){const d=csv?",":"\t";let keys:string[]|undefined;for await(const r of rows){if(!keys){keys=Object.keys(r);yield keys.join(d);}yield keys.map(k=>quote(r[k],d)).join(d);}}
async function* summary(store:ResultStore,run:SavedRun){for await(const f of store.features(run.id,"primary","gene",undefined,true)){const g=f.value as Gene,c=run.experiment.contrasts.find(c=>c.id===f.contrast)!;yield {contrast_id:c.id,treatment:c.treatment,control:c.control,time_point:c.timePoint,gene_id:g.geneId,gene_symbol:g.symbol,chrom:g.chrom,start:g.start,end:g.end,strand:g.strand,gene_log2fc:f.stat?.log2fc??null,gene_se:f.stat?.se??null,gene_padj:f.stat?.padj??null,candidate_count:f.counts.total??0,...Object.fromEntries(["high","moderate","weak","discordant","insufficient"].map(t=>[t,f.counts[t]??0]))};}}
export async function* persistentArtifacts(store:ResultStore,run:SavedRun):AsyncGenerator<Artifact>{
 const savedSizes=(run.resources.savedChromosomeSizes??{}) as Record<string,Record<string,number>>;
 const sizesFor=(layer:Layer,contrast?:string)=>{const sizes:Record<string,number>={};for(const c of run.experiment.contrasts){if(contrast&&c.id!==contrast)continue;for(const [chrom,length] of Object.entries(savedSizes[JSON.stringify([layer,c.id])]??{})){if(sizes[chrom]!==undefined&&sizes[chrom]!==length)throw new Error("Conflicting chromosome sizes in saved contrasts. Export individual tables; combined arcs cannot safely mix these references.");sizes[chrom]=length;}}return sizes;};
 const exp=run.experiment,metadata=makeExperimentArtifacts(exp,run.outcomes.map(o=>({...o,result:undefined})),run.parameters,run.resources);
 metadata["validation_report.json"]=JSON.stringify({schema_version:3,gel_version:"0.6.0",state:run.state,complete:run.state==="complete",truncated:false,resources:{...run.resources,retainedRows:run.rows,retainedResultBytesEstimate:run.bytes},outcomes:run.outcomes.map(({result,...o})=>({...o,validation:result?.validation??null})),persistence:{schema:run.schema,batches:run.batches,estimatedBytes:run.bytes,budgetBytes:run.budget,batchRows:run.batchRows??500,writeMs:run.writeMs??0,note:run.note??null},exportStrategy:"ZIP64 STORE, bounded persisted batches (up to 1000 rows), <=64 KiB encoding buffers; direct file writes when selected",privacy:{selected_file_contents_uploaded:false},dependence:"Shared controls are not independent replicates. No pooled p-values."},null,2);
 metadata["execution_state.json"]=JSON.stringify({state:run.state,rows:run.rows,created:run.created,updated:run.updated,complete:run.state==="complete",note:run.note??null},null,2);
 metadata["README.txt"]+="\nPersisted run state: "+run.state+". Incomplete/failed contrast rows, when present, are retained and explicitly annotated by execution_status. Never interpret a partial scan as complete.\n";
 for(const [name,s] of Object.entries(metadata))if(!name.startsWith("gel_"))yield {name,data:text(s)};
 for(const layer of ["primary","track"] as const){
  const sizes={...exportChromosomeSizes(run.outcomes,layer),...sizesFor(layer)};
  const records=async function*(contrast?:string){for await(const v of store.rows(run.id,layer,contrast)){const c=exp.contrasts.find(c=>c.id===v.contrast)!;yield {...decorateExperimentLink(exp,v.row,c,layer),execution_status:run.outcomes.find(o=>o.contrastId===c.id)?.status??run.state,run_state:run.state};}};
  const stem=layer==="primary"?"gel_experiment_links":"track_only_experiment_links";
  yield {name:stem+".tsv",data:encode(table(records()))};
  if(layer==="primary")yield {name:stem+".csv",data:encode(table(records(),true))};
  yield {name:stem+".bedpe",data:encode((async function*(){for await(const r of records())yield experimentBedpe([r],sizes);})())};
  if(layer==="primary")yield {name:stem+".interact",data:encode((async function*(){yield linksToInteract([]);for await(const r of records())yield linksToInteract([{...r,link_id:r.candidate_id}],sizes).split("\n").slice(1).join("\n");})())};
 }
 yield {name:"gel_gene_summary.tsv",data:encode(table(summary(store,run)))};
 for(const c of exp.contrasts){
  const outcome=run.outcomes.find(o=>o.contrastId===c.id);const base=`contrasts/${encodeURIComponent(c.id)}/`;const sizes={...((outcome?.result?.validation.chromosomeSizes??{}) as Record<string,number>),...sizesFor("primary",c.id)};
  const rows=async function*(){for await(const v of store.rows(run.id,"primary",c.id))yield v.row;};
  yield {name:base+"gel_links.tsv",data:encode(table(rows()))};yield {name:base+"gel_links.csv",data:encode(table(rows(),true))};
  yield {name:base+"gel_links.bedpe",data:encode((async function*(){for await(const r of rows())yield linksToBedpe([r],sizes);})())};
  for(const tier of ["","high","moderate","weak","discordant","insufficient"])yield {name:base+`gel_links${tier?"_"+tier:""}.interact`,data:encode((async function*(){yield linksToInteract([]);for await(const r of rows())if(!tier||r.evidence_tier===tier)yield linksToInteract([r],sizes).split("\n").slice(1).join("\n");})())};
  const bed=(kind:"gene"|"enhancer",layer:Layer="primary")=>encode((async function*(){for await(const f of store.features(run.id,layer,kind,c.id,true)){if(kind==="gene"){const g=f.value as Gene;yield `${g.chrom}\t${g.start}\t${g.end}\t${g.symbol||g.geneId}\t0\t${g.strand}`;}else{const e=f.value as Differential;yield `${e.chrom}\t${e.start}\t${e.end}\t${e.featureId}\t0\t.`;}}})());
  yield {name:base+"gel_genes.bed",data:bed("gene")};yield {name:base+"gel_enhancers.bed",data:bed("enhancer")};yield {name:base+"track_only_enhancers.bed",data:bed("enhancer","track")};
  yield {name:base+"track_only_links.tsv",data:encode(table((async function*(){for await(const v of store.rows(run.id,"track",c.id))yield v.row;})()))};
  yield {name:base+"promoter_proximal_effects.tsv",data:encode(table((async function*(){for await(const f of store.features(run.id,"primary","promoter",c.id,true))yield f.value as unknown as Record<string,unknown>;})()))};
  for(const [name,value] of Object.entries({"analysis_parameters.json":run.parameters,"validation_report.json":{...outcome?.result?.validation,status:outcome?.status??run.state},"input_provenance.json":{experimentId:exp.experimentId,contrast:c,assembly:exp.assembly,files:exp.files.filter(f=>Object.values(c.bindings).includes(f.id)),annotationProvenance:exp.annotationProvenance}}))yield {name:base+name,data:text(JSON.stringify(value,null,2))};
 }
}
export function featureSummary(f:StoredFeature){const g=f.value as Gene;return {gene_id:g.geneId,gene_symbol:g.symbol,contrast_id:f.contrast,gene_log2fc:f.stat?.log2fc??null,gene_padj:f.stat?.padj??null,candidate_count:f.counts.total??0,counts:f.counts};}
