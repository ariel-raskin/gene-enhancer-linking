"use client";



import SavedResults from "./saved-results";
import {ResultStore} from "@/lib/result-store";
import { useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_EXECUTION, type GenomicScope, type ExecutionLimits } from "@/lib/genomic-scope";

import { requestsForContrast, duplicateProposals } from "@/lib/experiment";

import { DEFAULT_PARAMETERS, type Parameters } from "@/lib/analysis";

import { type ImportedFile, type InputRole, ROLE_LABELS } from "@/lib/smart-importer";

import { readLocalText } from "@/lib/read-local-text";

import { assessContrast, blankContrast, experimentLinkRefs, decorateExperimentLink, fileKey, geneSummaries, parseSamples, proposeContrasts, readExperimentMetadata, sampleFindings, type Contrast, type Experiment, type Outcome, type Sample } from "@/lib/experiment";

import type { ExperimentEvent } from "@/lib/run-experiment";



type Props = { inventory:ImportedFile[]; parameters:Parameters; onParameters:(p:Parameters)=>void; onRole:(id:string,role:InputRole)=>void; onRemove:(id:string)=>void; onReplace:(id:string,file:File)=>void };

const sampleHeader="sample_id\tcondition\ttime_point\treplicate\tbatch\tmatched_block";

const sampleText=(xs:Sample[])=>[sampleHeader,...xs.map(s=>[s.id,s.condition,s.timePoint,s.biologicalReplicate,s.batch,s.matchedBlock].join("\t"))].join("\n");

const tiers=["high","moderate","weak","discordant","insufficient"];

const fmt=(n:number|null)=>n===null?"NA":n.toFixed(3);

function download(name:string,blob:Blob){const u=URL.createObjectURL(blob);const a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}



export default function ExperimentWorkspace({inventory,parameters,onParameters,onRole,onRemove,onReplace}:Props){

  const [savedRun,setSavedRun]=useState<string|null>(null);
  const [diskBudget,setDiskBudget]=useState(4);
  const [writeBatch,setWriteBatch]=useState(500);
  const [legacyRegional,setLegacyRegional]=useState(false);
  const [genomicScope,setGenomicScope]=useState<GenomicScope>({version:1,mode:"chromosomes",chromosomes:["chr1"],excludedContigs:[]});

  const [execution,setExecution]=useState<ExecutionLimits>(DEFAULT_EXECUTION);

  const [scopeReport,setScopeReport]=useState<{signature:string;result:Record<string,unknown>}|null>(null);

  const [settings,setSettings]=useState({experimentId:"experiment-1",assembly:"",annotationProvenance:"",model:"",normalization:"",scope:{chrom:"chr1",start:0,end:1000000},regionalStatistics:false});

  const [overrides,setOverrides]=useState<Record<string,Partial<Contrast>>>({}); const [assignments,setAssignments]=useState<Record<string,string>>({});const [extras,setExtras]=useState<Contrast[]>([]);const [newName,setNewName]=useState("");

  const [sampleOverride,setSampleOverride]=useState<string|null>(null); const [parsedSamples,setParsedSamples]=useState<{signature:string;samples:Sample[];errors:string[]}>({signature:"",samples:[],errors:[]});

  const [metadata,setMetadata]=useState<{signature:string;data?:Experiment;error?:string}>({signature:""});const [error,setError]=useState("");const [busy,setBusy]=useState(false);const [exporting,setExporting]=useState(false);const [progress,setProgress]=useState("");

  const [snapshot,setSnapshot]=useState<{experiment:Experiment;parameters:Parameters}|null>(null);const [outcomes,setOutcomes]=useState<Outcome[]>([]);const [resources,setResources]=useState<Record<string,unknown>>({});

  const [query,setQuery]=useState("");const [contrastFilter,setContrastFilter]=useState("all");const [tierFilter,setTierFilter]=useState("all");const [layer,setLayer]=useState<"primary"|"track">("primary");const [page,setPage]=useState(0);const [sort,setSort]=useState("contrast");

  const worker=useRef<Worker|null>(null);const exportWorker=useRef<Worker|null>(null);const signature=inventory.filter(f=>f.role==="designTable").map(fileKey).sort().join("|");const metaFile=inventory.find(f=>f.role==="experimentMetadata");const metaSignature=metaFile?fileKey(metaFile):"";

  useEffect(()=>()=>{worker.current?.terminate();exportWorker.current?.terminate();},[]);

  useEffect(()=>{let active=true;const tables=inventory.filter(f=>f.role==="designTable");void Promise.all(tables.map(async f=>{try{return {samples:parseSamples(await readLocalText(f.file,10*1024*1024),f.path),errors:[] as string[]};}catch(e){return {samples:[] as Sample[],errors:[`${f.path}: ${e instanceof Error?e.message:String(e)}`]};}})).then(parts=>{if(active){const unique=new Map<string,Sample>();for(const s of parts.flatMap(p=>p.samples)){const key=JSON.stringify({...s,provenance:""});const existing=unique.get(key);unique.set(key,existing?{...existing,provenance:`${existing.provenance}; ${s.provenance}`}:s);}setParsedSamples({signature,samples:[...unique.values()],errors:parts.flatMap(p=>p.errors)});}});return()=>{active=false;};},[inventory,signature]);

  useEffect(()=>{let active=true;if(metaFile)void readLocalText(metaFile.file,2*1024*1024).then(text=>{const data=readExperimentMetadata(text,inventory);if(active)setMetadata({signature:metaSignature,data});}).catch(e=>{if(active)setMetadata({signature:metaSignature,error:e instanceof Error?e.message:String(e)});});return()=>{active=false;};},[metaFile,metaSignature,inventory]);

  const proposals=useMemo(()=>proposeContrasts(inventory,assignments,extras),[inventory,assignments,extras]);

  const contrasts=useMemo(()=>proposals.map(c=>({...c,...overrides[c.id],fileIds:c.fileIds,bindings:{...c.bindings,...overrides[c.id]?.bindings}})),[proposals,overrides]);

  const sampleState=useMemo(()=>{try{return {samples:sampleOverride===null?(parsedSamples.signature===signature?parsedSamples.samples:[]):parseSamples(sampleOverride,"Researcher-edited registry"),errors:sampleOverride===null?(parsedSamples.signature===signature?parsedSamples.errors:[]):[]};}catch(e){return {samples:[],errors:[e instanceof Error?e.message:String(e)]};}},[sampleOverride,parsedSamples,signature]);

  const experiment:Experiment=useMemo(()=>({schema_version:2,product:"GEL Web",...settings,genomicScope:legacyRegional?undefined:genomicScope,execution,samples:sampleState.samples,metadataWarnings:sampleState.errors,

    conditions:[...new Set(contrasts.flatMap(c=>[c.control,c.treatment]).filter(Boolean))].sort().map(id=>({id,label:id})),contrasts,

    files:[...inventory].sort((a,b)=>fileKey(a)<fileKey(b)?-1:1).map(f=>({id:fileKey(f),path:f.path,role:f.role,size:f.file.size,lastModified:f.file.lastModified,recognition:f.recognition,evidence:f.evidence,sha256:f.sha256}))}),[settings,legacyRegional,genomicScope,execution,sampleState.samples,sampleState.errors,contrasts,inventory]);

  const scopeSignature=JSON.stringify({genomicScope,execution,settings,files:inventory.map(fileKey),contrasts:contrasts.map(c=>({id:c.id,bindings:c.bindings}))});
  const checks=contrasts.map(c=>assessContrast(c,experiment));const ready=checks.filter(c=>c.status==="pending").length;

  const edit=(id:string,patch:Partial<Contrast>)=>setOverrides(prev=>({...prev,[id]:{...prev[id],...patch}}));

  const confirmAll=()=>setOverrides(prev=>Object.fromEntries(contrasts.map(c=>[c.id,{...prev[c.id],confirmed:!c.excluded}])));

  const applyMetadata=()=>{const d=metadata.data;if(!d)return;setLegacyRegional(!d.genomicScope);setGenomicScope(d.genomicScope??{version:1,mode:"interval",chromosomes:[],excludedContigs:[]});setExecution(d.execution??DEFAULT_EXECUTION);setSettings(s=>({...s,...Object.fromEntries(["experimentId","assembly","annotationProvenance","model","normalization","scope","regionalStatistics"].filter(k=>d[k as keyof Experiment]!==undefined).map(k=>[k,d[k as keyof Experiment]]))}));setExtras(d.contrasts.filter(c=>!proposals.some(p=>p.id===c.id)).map(c=>blankContrast(c.id,c.label)));setOverrides({...Object.fromEntries(duplicateProposals(proposals,d.contrasts).map(c=>[c.id,{excluded:true}])),...Object.fromEntries(d.contrasts.map(c=>[c.id,c]))});setSampleOverride(sampleText(d.samples));setError("");};

  const inspectScope=()=>{try{const c=contrasts.find((c,i)=>checks[i].bigwigEvidence&&checks[i].status==="pending");if(!c)throw new Error("Confirm one ready BigWig contrast before inspecting its scope.");const req=requestsForContrast(c,experiment,Object.fromEntries(inventory.map(f=>[fileKey(f),f.file])),parameters).find(r=>r.kind==="bigwig");if(!req||req.kind!=="bigwig")return;const w=new Worker(new URL("../workers/scope.worker.ts",import.meta.url),{type:"module"});worker.current=w;setBusy(true);setProgress("Inspecting indexed contig dictionaries and annotation…");w.onmessage=e=>{setBusy(false);setScopeReport(e.data.result?{signature:scopeSignature,result:e.data.result}:null);setError(e.data.error??"");setProgress("Scope inspection finished; review the report before analysis.");w.terminate();worker.current=null;};w.onerror=e=>{setBusy(false);setError(e.message);w.terminate();worker.current=null;};w.postMessage(req.request);}catch(e){setError(e instanceof Error?e.message:String(e));}};

  const cancel=()=>{worker.current?.terminate();if(savedRun)void ResultStore.open().then(async s=>{await s.update(savedRun,{state:"cancelled",outcomes:outcomes.map(o=>["pending","running"].includes(o.status)?{...o,status:"cancelled",findings:["Cancelled; saved batches are incomplete."]}:o),note:"Cancelled; committed batches retained. No resume."});s.close();}).catch(e=>setError(`Cancellation state could not be saved: ${e instanceof Error?e.message:String(e)}`));worker.current=null;setBusy(false);setProgress("Cancelled. Completed contrasts are retained; remaining contrasts were not completed.");setOutcomes(os=>os.map(o=>["pending","running"].includes(o.status)?{...o,status:"cancelled",findings:["Cancelled by researcher; not completed."]}:o));};

  const run=async()=>{

    setError("");if(sampleOverride!==null&&sampleState.errors.length){setError(sampleState.errors.join(" "));return;}if(!ready){setError("No ready contrasts. Inspect the comparison details and confirm required metadata.");return;}

    setBusy(true);let runId:string;
    try{const store=await ResultStore.open();const saved=await store.create(structuredClone(experiment),structuredClone(parameters),Math.floor(diskBudget*1024**3),writeBatch);store.close();runId=saved.id;setSavedRun(runId);}catch(e){setError(`Local result storage could not start: ${e instanceof Error?e.message:String(e)}`);setBusy(false);return;}
    const frozen=structuredClone(experiment);setSnapshot({experiment:frozen,parameters:structuredClone(parameters)});setOutcomes(frozen.contrasts.map(c=>({contrastId:c.id,status:assessContrast(c,frozen).status,findings:assessContrast(c,frozen).findings})));setResources({});setBusy(true);setProgress("Preparing sequential local experiment worker…");

    const w=new Worker(new URL("../workers/experiment.worker.ts",import.meta.url),{type:"module"});worker.current=w;

    w.onmessage=(event:MessageEvent<ExperimentEvent|{type:"complete";summary:{successful:number;failed:number};resources:Record<string,unknown>}|{type:"error";error:string}>)=>{

      const m=event.data;if(m.type==="progress")setProgress(`${m.contrastId}: ${m.message}`);

      if(m.type==="state"){setOutcomes(os=>os.map(o=>o.contrastId===m.outcome.contrastId?m.outcome:o));setProgress(`${m.completed} / ${m.total} contrasts completed · ${m.outcome.contrastId}: ${m.outcome.status}`);}

      if(m.type==="complete"){setResources(m.resources);setBusy(false);setProgress(`Experiment finished · ${m.summary.successful} successful, ${m.summary.failed} failed. No statistical pooling.`);w.terminate();worker.current=null;}

      if(m.type==="error"){setError(m.error);setBusy(false);setOutcomes(os=>os.map(o=>["pending","running"].includes(o.status)?{...o,status:"failed",findings:[m.error]}:o));w.terminate();worker.current=null;}

    };

    w.onerror=(e)=>{void ResultStore.open().then(async s=>{await s.update(runId,{state:"failed",note:"Worker crashed; committed batches may be incomplete."});s.close();});setError(e.message||"Experiment worker failed.");setBusy(false);setOutcomes(os=>os.map(o=>["pending","running"].includes(o.status)?{...o,status:"failed",findings:[e.message||"Worker failed"]}:o));w.terminate();worker.current=null;};

    w.postMessage({experiment:frozen,files:Object.fromEntries(inventory.map(f=>[fileKey(f),f.file])),parameters,runId});

  };

  const exportResults=(fileKey?:string)=>{if(!snapshot)return;setExporting(true);setError("");const w=new Worker(new URL("../workers/export.worker.ts",import.meta.url),{type:"module"});exportWorker.current=w;w.onmessage=(e:MessageEvent<{type:string;blob?:Blob;name?:string;error?:string}>)=>{if(e.data.blob)download(e.data.name??"gel-experiment.zip",e.data.blob);else setError(e.data.error??"Export failed");w.terminate();exportWorker.current=null;setExporting(false);};w.onerror=e=>{setError(e.message);setExporting(false);w.terminate();exportWorker.current=null;};w.postMessage({id:"experiment-export",kind:"experiment",experiment:snapshot.experiment,outcomes,parameters:snapshot.parameters,resources,fileKey});};

  const allRows=useMemo(()=>snapshot?experimentLinkRefs(snapshot.experiment,outcomes,layer):[],[snapshot,outcomes,layer]);

  const summaries=useMemo(()=>snapshot?geneSummaries(snapshot.experiment,outcomes):[],[snapshot,outcomes]);

  const rows=useMemo(()=>allRows.filter(({row:r,contrast:c})=>(!query||`${r.gene_symbol} ${r.gene_id}`.toLowerCase().includes(query.toLowerCase()))&&(contrastFilter==="all"||c.id===contrastFilter)&&(tierFilter==="all"||r.evidence_tier===tierFilter)).sort((a,b)=>(sort==="distance"?a.row.distance_bp-b.row.distance_bp:sort==="magnitude"?(a.row.magnitude_gap_log2fc??Infinity)-(b.row.magnitude_gap_log2fc??Infinity):a.contrast.id.localeCompare(b.contrast.id))||a.row.link_id.localeCompare(b.row.link_id)),[allRows,query,contrastFilter,tierFilter,sort]);

  const filesFor=(c:Contrast)=>inventory.filter(f=>c.fileIds.includes(fileKey(f))||Object.values(c.bindings).includes(fileKey(f)));

  const ungrouped=inventory.filter(f=>!contrasts.some(c=>c.fileIds.includes(fileKey(f))));

  const fileRow=(f:ImportedFile)=><div className="experiment-file" key={fileKey(f)}><code>{f.path}</code><small>{f.recognition.replaceAll("_"," ")} · {f.format}</small><select aria-label={`Experiment role for ${f.path}`} value={f.role} disabled={busy} onChange={e=>onRole(f.id,e.target.value as InputRole)}>{Object.entries(ROLE_LABELS).map(([r,label])=><option key={r} value={r}>{label}</option>)}</select><select aria-label={`Comparison assignment for ${f.path}`} disabled={busy} value={assignments[fileKey(f)]??(contrasts.find(c=>c.fileIds.includes(fileKey(f)))?.id??"shared")} onChange={e=>setAssignments(a=>({...a,[fileKey(f)]:e.target.value}))}><option value="shared">Shared / available to comparisons</option><option value="unassigned">Unused</option>{contrasts.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select><label className="text-button replace-import">Replace<input aria-label={`Experiment replace ${f.path}`} type="file" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)onReplace(f.id,file);}}/></label><button type="button" disabled={busy} className="text-button" onClick={()=>onRemove(f.id)}>Remove</button></div>;

  return <div className="experiment-workspace">

    <div className="experiment-intro"><h2>Review your experiment</h2><p>{inventory.length} local files · {contrasts.length} proposed contrasts · {ready} ready. Each comparison runs independently. Shared controls are common condition/sample references, not extra replicates.</p></div>

    {metadata.signature===metaSignature&&metadata.data&&<div className="warning-box">An experiment manifest was detected. Its metadata are source declarations, not independently verified. <button type="button" className="button button-light" disabled={busy} onClick={applyMetadata}>Apply experiment metadata</button></div>}

    {metadata.signature===metaSignature&&metadata.error&&<p className="error-box">Manifest: {metadata.error}</p>}

    <fieldset disabled={busy}><legend>Experiment metadata</legend><div className="parameter-grid metadata-grid">

      {(["experimentId","assembly","annotationProvenance","model","normalization"] as const).map((key,i)=><label key={key}>{["Experiment ID","Experiment assembly","Annotation provenance","Default statistical model / normalization","Default track normalization / averaging"][i]}<input value={settings[key]} onChange={e=>setSettings(s=>({...s,[key]:e.target.value}))}/></label>)}

    </div><div className="parameter-grid metadata-grid"><label>Genomic scope<select aria-label="Genomic scope" value={genomicScope.mode} onChange={e=>{setLegacyRegional(false);setGenomicScope(s=>({...s,mode:e.target.value as GenomicScope["mode"]}));setScopeReport(null);}}><option value="interval">Defined interval</option><option value="chromosomes">Selected chromosome(s)</option><option value="genome">Whole annotated genome (experimental; capacity-limited)</option></select></label><label>Selected chromosomes (comma separated)<input aria-label="Selected chromosomes" value={genomicScope.chromosomes.join(",")} onChange={e=>setGenomicScope(s=>({...s,chromosomes:e.target.value.split(",").map(v=>v.trim()).filter(Boolean)}))}/></label><label>Explicitly excluded contigs<input aria-label="Excluded contigs" value={genomicScope.excludedContigs.join(",")} onChange={e=>setGenomicScope(s=>({...s,excludedContigs:e.target.value.split(",").map(v=>v.trim()).filter(Boolean)}))}/></label><label>Chunk bases<input aria-label="Chunk bases" type="number" min="100" max="1000000" value={execution.chunkBases} onChange={e=>setExecution(s=>({...s,chunkBases:Number(e.target.value)}))}/></label><label>In-flight chunk queries<select aria-label="Chunk concurrency" value={execution.queryConcurrency} onChange={e=>setExecution(s=>({...s,queryConcurrency:Number(e.target.value)}))}><option value="1">1 (conservative)</option><option value="2">2 (opt-in I/O overlap)</option></select></label><label>Legacy in-memory candidate limit (persistent path uses disk budget)<input aria-label="Candidate output limit" type="number" min="1" max="200000" value={execution.maxPairs} onChange={e=>setExecution(s=>({...s,maxPairs:Number(e.target.value)}))}/></label></div><div className="field-split region-fields"><label>Experiment scan chromosome<input value={settings.scope.chrom} onChange={e=>setSettings(s=>({...s,scope:{...s.scope,chrom:e.target.value}}))}/></label><label>Experiment start (0-based)<input type="number" value={settings.scope.start} onChange={e=>setSettings(s=>({...s,scope:{...s.scope,start:Number(e.target.value)}}))}/></label><label>Experiment end (exclusive)<input type="number" value={settings.scope.end} onChange={e=>setSettings(s=>({...s,scope:{...s.scope,end:Number(e.target.value)}}))}/></label></div>

    <label className="experiment-check"><input type="checkbox" checked={settings.regionalStatistics} onChange={e=>setSettings(s=>({...s,regionalStatistics:e.target.checked}))}/> Restrict statistical candidates to the selected genomic scope</label><p className="field-help">Interval fields apply only to interval scope (up to 50 Mb). Chromosome scopes use exact BigWig contig lengths; whole annotated genome includes every annotated contig unless explicitly excluded. Two bounded passes, one analysis worker, 64 MiB in-flight decoded-signal estimate, persistent experiment results with bounded 500-record writes. Legacy single-contrast output guards remain. Disk limits fail the current contrast explicitly, never truncate a successful result. Statistical tables stay separate. Optional scope restriction filters their intervals/contigs; for annotated-genome mode it retains supplied model features except explicit contig exclusions.</p>

    <details><summary>Samples and biological design{sampleState.errors.length?` · ${sampleState.errors.length} source issue(s)`:""}</summary><p className="field-help">{sampleState.samples.length} sample records. Replicate identity, technical batch, and a confirmed matched block are distinct fields. These metadata do not refit or modify supplied differential models. Leave matched_block blank unless matching is established.</p><textarea aria-label="Experiment sample registry TSV" rows={7} value={sampleOverride??sampleText(sampleState.samples)} onChange={e=>setSampleOverride(e.target.value)}/><button type="button" className="text-button" onClick={()=>setSampleOverride(null)}>Restore supplied sample sheets</button>{[...sampleState.errors,...sampleFindings(sampleState.samples)].map(e=><p key={e} className="error-box">{e}</p>)}</details>

    </fieldset>

    <div className="table-wrap contrast-matrix"><table><caption>Contrast readiness matrix</caption><thead><tr><th>Comparison</th><th>Control reference</th><th>Treatment / time</th><th>Evidence</th><th>Compatibility</th><th>Status</th></tr></thead><tbody>{contrasts.map((c,i)=><tr key={c.id}><td><a href={`#contrast-${encodeURIComponent(c.id)}`}>{c.label}</a></td><td>{c.control||"Needs confirmation"}<small>{c.controlSampleIds.join(", ")||"Sample IDs not supplied"}</small></td><td>{c.treatment||"Needs confirmation"} · {c.timePoint||"time?"}</td><td>{checks[i].statisticsReady?"Statistics complete":"Statistics incomplete / absent"}<small>{checks[i].tracksReady?"Tracks assigned":checks[i].trackFilesPresent?"Tracks detected; select files":"Tracks absent"} · Run: {checks[i].mode}</small></td><td>{checks[i].compatibility}</td><td>{checks[i].status==="pending"?"ready":checks[i].status}</td></tr>)}</tbody></table></div>

    <button type="button" className="button button-light" disabled={busy} onClick={confirmAll}>Confirm reviewed contrast metadata</button>

    {contrasts.map((c,i)=><details className="contrast-details" id={`contrast-${encodeURIComponent(c.id)}`} key={c.id}><summary>{c.label} — {checks[i].status==="pending"?"ready":checks[i].status} · {filesFor(c).length} bound / assigned files</summary><fieldset disabled={busy}><legend>Contrast details</legend><p className="field-help">{c.proposedFrom}. Review source records before confirming. ID: {c.id}</p><label className="experiment-check"><input type="checkbox" aria-label={`Exclude ${c.label}`} checked={c.excluded} onChange={e=>edit(c.id,{excluded:e.target.checked})}/> Exclude this comparison</label><div className="parameter-grid metadata-grid">

      {(["label","control","treatment","perturbation","timePoint","assembly","trackAssembly","model","normalization"] as const).map((key,index)=><label key={key}>{["Display label","Control condition ID","Treatment condition ID","Perturbation","Time point","Statistics assembly override","Track assembly override","Statistical model override","Track normalization override"][index]}<input aria-label={`${key} for ${c.id}`} value={c[key]} placeholder={key==="assembly"||key==="trackAssembly"?settings.assembly:undefined} onChange={e=>edit(c.id,{[key]:e.target.value,confirmed:false})}/></label>)}

      <label>Evidence to run<select aria-label={`Evidence mode for ${c.id}`} value={c.mode} onChange={e=>edit(c.id,{mode:e.target.value as Contrast["mode"]})}>{["auto","enrsa","erna-r","bigwig","combined"].map(x=><option key={x}>{x}</option>)}</select></label>

      {checks[i].mode==="combined"&&<label>Statistical catalog<select aria-label={`Statistical source for ${c.id}`} value={c.statisticalSource} onChange={e=>edit(c.id,{statisticalSource:e.target.value as Contrast["statisticalSource"],confirmed:false})}><option value="auto">Auto when only one catalog is present</option><option value="enrsa">eNRSA</option><option value="erna-r">eRNA_diff R-DESeq2</option></select></label>}

      {(["control","treatment"] as const).map(side=><label key={side}>{side} contrast / model sample IDs (comma separated)<input aria-label={`${side} sample IDs for ${c.id}`} value={c[`${side}SampleIds`].join(",")} onChange={e=>edit(c.id,{[`${side}SampleIds`]:e.target.value.split(",").map(s=>s.trim()).filter(Boolean),confirmed:false})}/></label>)}

      {checks[i].bigwigEvidence&&(["control","treatment"] as const).map(side=><label key={`${side}-samples`}>{side} track sample IDs (comma separated)<input aria-label={`${side} track sample IDs for ${c.id}`} value={c[`${side}TrackSampleIds`].join(",")} onChange={e=>edit(c.id,{[`${side}TrackSampleIds`]:e.target.value.split(",").map(s=>s.trim()).filter(Boolean),confirmed:false})}/></label>)}

      {checks[i].bigwigEvidence&&(["control","treatment"] as const).map(side=><label key={side}>{side} track source<select aria-label={`${side} track source for ${c.id}`} value={c[`${side}TrackSource`]} onChange={e=>edit(c.id,{[`${side}TrackSource`]:e.target.value,confirmed:false})}><option value="unknown">Confirm source type…</option><option value="averaged">Condition average (descriptive)</option><option value="replicate">One individual replicate (descriptive)</option></select></label>)}

      <label>Gene annotation format<select aria-label={`Gene format for ${c.id}`} value={c.geneFormat} onChange={e=>edit(c.id,{geneFormat:e.target.value as Contrast["geneFormat"]})}>{["gtf","gff","bed","tsv","saf"].map(x=><option key={x}>{x}</option>)}</select></label><label>Gene coordinate convention<select value={c.geneCoordinates} onChange={e=>edit(c.id,{geneCoordinates:e.target.value as Contrast["geneCoordinates"]})}><option value="zero_based_half_open">0-based half-open</option><option value="one_based_inclusive">1-based inclusive</option></select></label>

      {checks[i].source==="erna-r"&&<label>Enhancer coordinate convention<select aria-label={`Enhancer coordinates for ${c.id}`} value={c.enhancerCoordinates} onChange={e=>edit(c.id,{enhancerCoordinates:e.target.value as Contrast["enhancerCoordinates"]})}><option value="">Confirm…</option><option value="zero_based_half_open">BED 0-based</option><option value="one_based_inclusive">SAF 1-based inclusive</option></select></label>}

    </div><label className="experiment-check"><input type="checkbox" aria-label={`Confirm ${c.label}`} checked={c.confirmed} onChange={e=>edit(c.id,{confirmed:e.target.checked})}/> I reviewed this contrast&apos;s condition, time, strand assignments and source provenance.</label>

    {checks[i].warnings.map(w=><p key={w} className="warning-box">{w}</p>)}

    {!!checks[i].findings.length&&<ul className="contrast-findings">{checks[i].findings.map(x=><li key={x}>{x}</li>)}</ul>}

    <details><summary>Files and analysis bindings</summary><p className="field-help">Choose one file per analysis role. Replicate files stay distinct; GEL does not average them implicitly. Any selected file can be assigned explicitly below.</p><div className="parameter-grid metadata-grid">{Object.entries(ROLE_LABELS).filter(([r])=>!["unknown","experimentMetadata"].includes(r)).map(([role,label])=><label key={role}>{label}<select aria-label={`${role} file for ${c.id}`} value={c.bindings[role as InputRole]??""} onChange={e=>edit(c.id,{bindings:{...c.bindings,[role]:e.target.value},confirmed:false})}><option value="">Not assigned / ambiguous</option>{inventory.filter(f=>f.role===role||fileKey(f)===c.bindings[role as InputRole]).map(f=><option key={fileKey(f)} value={fileKey(f)}>{f.path}</option>)}</select></label>)}</div>{filesFor(c).map(fileRow)}</details></fieldset></details>)}

    <details><summary>Shared and ungrouped files ({ungrouped.length}) · add or correct comparisons</summary><div>{ungrouped.map(fileRow)}</div><div className="smart-actions"><input aria-label="New contrast name" value={newName} onChange={e=>setNewName(e.target.value)}/><button className="button button-light" type="button" disabled={busy||!newName.trim()||contrasts.some(c=>c.id===newName.trim())} onClick={()=>{setExtras(xs=>[...xs,blankContrast(newName.trim())]);setNewName("");}}>Add comparison</button></div></details>

    <fieldset disabled={busy}><legend>Analysis criteria applied independently to every contrast</legend><div className="parameter-grid metadata-grid">{(["maxDistanceBp","minGeneAbsLfc","minEnhancerAbsLfc","maxPadj","maxMagnitudeGapLfc","minMeanSignal","peakBinBp","mergeGapBp","pseudocount","promoterUpstreamBp","promoterDownstreamBp"] as const).map((k,i)=><label key={k}>{["Maximum TSS distance (bp)","Minimum gene |log₂FC|","Minimum enhancer |log₂FC|","Maximum adjusted p-value","Maximum magnitude gap","Minimum mean signal","Peak bin width (bp)","Peak merge gap (bp)","Signal pseudocount","Promoter upstream (bp)","Promoter downstream (bp)"][i]}<input type="number" min="0" step="any" value={parameters[k]} onChange={e=>onParameters({...parameters,[k]:Number(e.target.value)})}/></label>)}</div><div className="check-row">{(["excludePromoters","excludeGeneBody","requireDirection","compareMagnitude"] as const).map((k,i)=><label key={k}><input type="checkbox" checked={parameters[k]} onChange={e=>onParameters({...parameters,[k]:e.target.checked})}/>{["Exclude promoter overlaps","Exclude gene-body overlaps","Require direction agreement","Use magnitude criterion"][i]}</label>)}</div><details><summary>Peak morphology classes</summary><div className="check-row">{[...new Set([...DEFAULT_PARAMETERS.morphologyClasses,"convergent_inward"])].map(m=><label key={m}><input type="checkbox" checked={parameters.morphologyClasses.includes(m)} onChange={e=>onParameters({...parameters,morphologyClasses:e.target.checked?[...parameters.morphologyClasses,m]:parameters.morphologyClasses.filter(x=>x!==m)})}/>{m.replaceAll("_"," ")}</label>)}</div></details></fieldset>

    <button type="button" className="button button-light" disabled={busy} onClick={inspectScope}>Inspect BigWig scope and estimates</button>{scopeReport?.signature===scopeSignature&&<details open><summary>Inspected scope / resource plan (first ready track contrast)</summary><p>Two passes per region; runtime depends on track density. Signal byte estimates exclude decoder/native memory. Every contrast validates its own dictionary during execution. A successful run certifies only its recorded scope and settings; default whole-genome output can exceed budgets.</p><pre>{JSON.stringify(scopeReport?.result,null,2)}</pre></details>}

    <div className="run-panel"><div><strong role="status">{progress||`${ready} contrasts ready for local analysis`}</strong><p>Sequential execution · maximum 24 contrasts · disk-backed result batches · no full pair array in React. Incomplete or excluded contrasts are reported.</p></div><div className="run-actions"><button type="button" className="button button-dark" disabled={busy||!ready} onClick={run}>Analyze ready contrasts</button>{busy&&<button type="button" className="button button-light" onClick={cancel}>Cancel experiment</button>}</div></div>

    {error&&<p className="error-box" role="alert">{error}</p>}

    <label>Local result payload budget (GiB)<input aria-label="Local result budget GiB" disabled={busy} type="number" min="0.01" max="16" step="0.25" value={diskBudget} onChange={e=>setDiskBudget(Number(e.target.value))}/></label>
    <label>Records per storage batch (100–1000)<input aria-label="Storage write batch rows" disabled={busy} type="number" min="100" max="1000" step="100" value={writeBatch} onChange={e=>setWriteBatch(Number(e.target.value))}/></label>
    <SavedResults key={savedRun??"saved"} activeRun={savedRun} revision={busy?undefined:outcomes} inventory={inventory}/>
    {snapshot&&!savedRun&&<section className="experiment-results"><h2>Experiment gene explorer</h2><p>Results use the saved run configuration. Editing the form does not change completed outputs; run again to apply changes. No shared-control p-values are pooled.</p><div className="contrast-outcomes">{outcomes.map(o=><details key={o.contrastId}><summary>{o.contrastId}: {o.status}{o.result?` · ${o.result.links.length} candidate links`:""}</summary><p>{o.findings.join(" ")||"Source-specific validation is preserved in the ZIP."}</p>{o.result&&<pre>{JSON.stringify(o.result.validation,null,2)}</pre>}</details>)}</div>

    <div className="results-toolbar"><input aria-label="Search experiment gene" placeholder="Search gene symbol or ID" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/><select aria-label="Experiment contrast filter" value={contrastFilter} onChange={e=>{setContrastFilter(e.target.value);setPage(0);}}><option value="all">All contrasts</option>{snapshot.experiment.contrasts.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select><select aria-label="Experiment evidence filter" value={tierFilter} onChange={e=>{setTierFilter(e.target.value);setPage(0);}}><option value="all">All evidence tiers</option>{tiers.map(t=><option key={t}>{t}</option>)}</select><select aria-label="Experiment evidence layer" value={layer} onChange={e=>{setLayer(e.target.value as typeof layer);setPage(0);}}><option value="primary">Primary model / descriptive results</option><option value="track">Separate combined-run track layer</option></select><select aria-label="Experiment sort" value={sort} onChange={e=>setSort(e.target.value)}><option value="contrast">Contrast</option><option value="distance">Distance</option><option value="magnitude">Magnitude gap</option></select></div>

    <p>{rows.length} matching contrast-specific candidate rows · {summaries.filter(s=>(!query||`${s.gene_id} ${s.gene_symbol}`.toLowerCase().includes(query.toLowerCase()))&&(contrastFilter==="all"||s.contrast_id===contrastFilter)).length} gene/contrast summaries (including genes with no candidates).</p>

    <details><summary>Gene response and candidate counts across contrasts</summary><div className="table-wrap"><table><thead><tr><th>Gene</th><th>Contrast</th><th>Region</th><th>Gene log₂FC</th><th>padj</th><th>Candidates</th><th>Concordant high/moderate</th><th>Discordant</th></tr></thead><tbody>{summaries.filter(s=>(!query||`${s.gene_id} ${s.gene_symbol}`.toLowerCase().includes(query.toLowerCase()))&&(contrastFilter==="all"||s.contrast_id===contrastFilter)).slice(0,100).map(s=><tr key={`${s.contrast_id}:${s.gene_id}`}><td>{s.gene_symbol||s.gene_id}</td><td>{s.contrast_id}</td><td>{s.chrom}:{s.start}-{s.end}</td><td>{fmt(s.gene_log2fc)}</td><td>{s.gene_padj??"NA"}</td><td>{s.candidate_count}</td><td>{s.high+s.moderate}</td><td>{s.discordant}</td></tr>)}</tbody></table></div><small>First 100 matching summaries; the experiment package includes all rows.</small></details>

    <div className="table-wrap"><table><thead><tr><th>Gene / location</th><th>Perturbation · time / contrast</th><th>Enhancer</th><th>Distance</th><th>Gene / enhancer log₂FC</th><th>SE gene / enhancer</th><th>padj gene / enhancer</th><th>Direction / magnitude gap</th><th>Tier / morphology</th><th>Overlap / provenance</th></tr></thead><tbody>{rows.slice(page*100,(page+1)*100).map(({row,contrast})=>decorateExperimentLink(snapshot.experiment,row,contrast,layer)).map(r=><tr key={r.candidate_id}><td><strong>{r.gene_symbol}</strong><small>{r.gene_id} · {r.gene_chrom}:{r.gene_start}-{r.gene_end} ({r.gene_strand})</small></td><td>{r.perturbation||r.treatment_condition} · {r.time_point}<small>{r.contrast_id}</small></td><td>{r.enhancer_id}<small>{r.chrom}:{r.enhancer_start}-{r.enhancer_end}</small></td><td>{r.distance_bp}</td><td>{fmt(r.gene_log2fc)} / {fmt(r.enhancer_log2fc)}</td><td>{fmt(r.gene_se)} / {fmt(r.enhancer_se)}</td><td>{r.gene_padj??"NA"} / {r.enhancer_padj??"NA"}</td><td>{r.direction_agreement===null?"uninformative":r.direction_agreement?"agree":"disagree"} / {fmt(r.magnitude_gap_log2fc)}</td><td><span className={`tier tier-${r.evidence_tier}`}>{r.evidence_tier}</span><small>{r.morphology}</small></td><td>{r.overlaps_promoter?"Promoter":r.overlaps_gene_body?"Gene body":"Intergenic"}<small>{r.compatibility_status} · {r.evidence_source}</small></td></tr>)}</tbody></table></div>

    <div className="results-bottom"><button className="button button-light" disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous candidates</button><span>Page {page+1} / {Math.max(1,Math.ceil(rows.length/100))}</span><button className="button button-light" disabled={(page+1)*100>=rows.length} onClick={()=>setPage(p=>p+1)}>Next candidates</button></div>

    <div className="download-actions"><button type="button" className="button button-green" disabled={busy||exporting} onClick={()=>exportResults()}>Download experiment ZIP</button>{["gel_experiment_links.tsv","gel_experiment_links.csv","gel_gene_summary.tsv","gel_experiment_links.bedpe","gel_experiment_links.interact","experiment_manifest.json"].map(f=><button type="button" className="button button-light" key={f} disabled={busy||exporting} onClick={()=>exportResults(f)}>{f}</button>)}</div><p className="field-help">Downloads contain all successful contrasts; explorer filters are review controls. Failed, excluded, incomplete and cancelled statuses remain in the package.</p>

    </section>}

  </div>;

}
