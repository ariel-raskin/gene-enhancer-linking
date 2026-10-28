import { validateScope, validateExecution, type GenomicScope, type ExecutionLimits } from "./genomic-scope";
import { type Parameters, type Link, type Gene, type Differential, parseDelimited } from "./analysis";
import { type ExportInput } from "./exports";
import { type ImportedFile, type InputRole } from "./smart-importer";
import { type AnalysisRequest } from "./execute-analysis";

export type CoordinateRule = "zero_based_half_open" | "one_based_inclusive";
export type TrackSource = "unknown" | "averaged" | "replicate";
export type Scope = { chrom: string; start: number; end: number };
export type Sample = { id: string; condition: string; timePoint: string; biologicalReplicate: string; batch: string; matchedBlock: string; provenance: string };
export type Contrast = {
  id: string; label: string; control: string; treatment: string; perturbation: string; timePoint: string;
  confirmed: boolean; excluded: boolean; assembly: string; trackAssembly: string; model: string; normalization: string;
  controlSampleIds: string[]; treatmentSampleIds: string[]; controlTrackSource: TrackSource; treatmentTrackSource: TrackSource;
  controlTrackSampleIds: string[]; treatmentTrackSampleIds: string[];
  mode: "auto" | "enrsa" | "erna-r" | "bigwig" | "combined"; bindings: Partial<Record<InputRole, string>>;
  statisticalSource: "auto" | "enrsa" | "erna-r";
  geneFormat: "gtf" | "gff" | "tsv" | "bed" | "saf"; geneCoordinates: CoordinateRule; enhancerCoordinates: CoordinateRule | "";
  proposedFrom: string; fileIds: string[];
};
export type Experiment = {
  schema_version: 2; product: "GEL Web"; experimentId: string; assembly: string; annotationProvenance: string;
  model: string; normalization: string; scope: Scope; regionalStatistics: boolean; samples: Sample[];
  conditions: { id: string; label: string }[]; contrasts: Contrast[];
  metadataWarnings?: string[]; genomicScope?: GenomicScope; execution?: ExecutionLimits;
  files: { id: string; path: string; role: InputRole; size: number; lastModified: number; recognition: string; evidence: string[]; sha256?: string }[];
};
export type ContrastStatus = "pending" | "running" | "successful" | "failed" | "excluded" | "incomplete" | "cancelled";
export type Outcome = { contrastId: string; status: ContrastStatus; findings: string[]; result?: ExportInput; elapsedMs?: number; resultBytes?: number };
export type ExperimentLink = Link & { experiment_id: string; contrast_id: string; candidate_id: string; control_condition: string; treatment_condition: string; perturbation: string; time_point: string; genome_assembly: string; control_sample_ids: string; treatment_sample_ids: string; control_track_sample_ids:string; treatment_track_sample_ids:string; evidence_layer: string };
export const MAX_CONTRASTS = 24;
export const GEL_VERSION = "0.6.0";
export const MAX_EXPERIMENT_ROWS = 200_000;
export const MAX_RESULT_BYTES = 128 * 1024 * 1024;
export const fileKey = (f: ImportedFile) => `${f.path.replaceAll("\\", "/")}:${f.file.size}:${f.file.lastModified}`;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sorted = (xs: ImportedFile[]) => [...xs].sort((a, b) => compare(fileKey(a), fileKey(b)));
const timeOf = (s: string) => s.match(/(?:^|[_ .-])(\d+(?:\.\d+)?\s*(?:hr|h|min))(?:[_ .-]|$)/i)?.[1] ?? "";
export function pathGroup(path: string) {
  const parts = path.replaceAll("\\", "/").split("/");
  const index = parts.findIndex((p) => /_vs_/i.test(p));
  if (index < 0) {
    const internal=parts.findIndex(p=>/^(known_gene|eRNA|intermediate)$/i.test(p));
    if(internal>0){const name=parts[internal-1];return {id:parts.slice(0,internal).join("/"),label:name,treatment:name,control:"",timePoint:timeOf(name)};}
    return null;
  }
  const name = parts[index].replace(/(?:_results)?\.(csv|tsv|txt)(\.gz)?$/i, "");
  const [treatment, control] = name.split(/_vs_/i);
  return { id: parts.slice(0, index).concat(name).join("/"), label: name, treatment, control, timePoint: timeOf(treatment) };
}
function trackCondition(f: ImportedFile) {
  return f.file.name.replace(/\.(bw|bigwig)$/i, "").replace(/(?:[._-](?:eNRSA|plus|minus|pos|neg|forward|reverse|avg|average|mean))+/gi, "").replace(/[._-][AB]$/i, "").replace(/[._-]+$/, "");
}
export function blankContrast(id: string, label = id): Contrast {
  return { id, label, control: "", treatment: "", perturbation: "", timePoint: "", confirmed: false, excluded: false, assembly: "", trackAssembly: "", model: "", normalization: "", controlSampleIds: [], treatmentSampleIds: [], controlTrackSampleIds:[],treatmentTrackSampleIds:[],controlTrackSource: "unknown", treatmentTrackSource: "unknown", mode: "auto", statisticalSource:"auto", bindings: {}, geneFormat: "gtf", geneCoordinates: "zero_based_half_open", enhancerCoordinates: "", proposedFrom: "Researcher-created comparison", fileIds: [] };
}
/** Group by explicit contrast path first; all metadata inferred from names still needs confirmation. */
export function proposeContrasts(files: ImportedFile[], assignments: Record<string, string> = {}, extras: Contrast[] = []) {
  const ordered = sorted(files); const groups = new Map<string, Contrast>(extras.map((c) => [c.id, { ...c, fileIds: [] }]));
  const controls = ordered.filter((f) => /^control(Plus|Minus)$/.test(f.role) && !pathGroup(f.path));
  const controlNames = [...new Set(controls.map(trackCondition))];
  const flatStats=ordered.some(f=>["gbChange","enhancerChange","enhancerResults","geneResults"].includes(f.role)&&!pathGroup(f.path));
  const flatTreatments=[...new Set(ordered.filter(f=>/^treatment(Plus|Minus)$/.test(f.role)&&!pathGroup(f.path)).map(trackCondition))];
  for(const f of ordered){const pg=pathGroup(f.path);if(pg&&!groups.has(pg.id))groups.set(pg.id,{...blankContrast(pg.id,pg.label),control:pg.control,treatment:pg.treatment,timePoint:pg.timePoint,proposedFrom:`Directory/file ${pg.id}; identities inferred, not verified`});}
  const ungrouped: ImportedFile[] = [];
  for (const f of ordered) {
    const pg = pathGroup(f.path); let key = assignments[fileKey(f)] ?? pg?.id;
    const isTreatmentTrack = f.role === "treatmentPlus" || f.role === "treatmentMinus";
    const condition = isTreatmentTrack ? trackCondition(f) : "";
    if (!key && isTreatmentTrack) { const matching=[...groups.values()].filter(c=>c.treatment===condition); key=flatStats&&flatTreatments.length===1?"contrast-1":matching.length===1?matching[0].id:`tracks/${condition}`; }
    if (!key && !["experimentMetadata", "annotation", "designTable", "unknown", "controlPlus", "controlMinus"].includes(f.role)) key = "contrast-1";
    if (!key || key === "shared" || key === "unassigned") { ungrouped.push(f); continue; }
    if (!groups.has(key)) groups.set(key, { ...blankContrast(key, pg?.label ?? (condition || key)), control: pg?.control ?? (controlNames.length === 1 ? controlNames[0] : ""), treatment: pg?.treatment ?? condition, timePoint: pg?.timePoint ?? timeOf(condition), proposedFrom: pg ? `Directory/file ${pg.id}; identities inferred, not verified` : "Track-name grouping; identities inferred, not verified" });
    groups.get(key)!.fileIds.push(fileKey(f));
  }
  if (!groups.size && ordered.length) groups.set("contrast-1", blankContrast("contrast-1", "Comparison 1"));
  for (const c of groups.values()) {
    const own = ordered.filter((f) => c.fileIds.includes(fileKey(f)));
    const available = [...own, ...ungrouped.filter((f) => assignments[fileKey(f)] !== "unassigned")];
    for (const role of [...new Set(available.map((f) => f.role))]) {
      const specific = own.filter((f) => f.role === role); const candidates = specific.length ? specific : available.filter((f) => f.role === role);
      if (candidates.length === 1 && role !== "unknown" && (role !== "designTable" || specific.length === 1)) c.bindings[role] = fileKey(candidates[0]);
    }
    const annotation = ordered.find((f) => fileKey(f) === c.bindings.annotation);
    if (annotation) { c.geneFormat = annotation.format === "GTF" ? "gtf" : annotation.format === "GFF3" ? "gff" : annotation.format.startsWith("featureCounts SAF") ? "saf" : annotation.format === "BED" ? "bed" : "tsv"; c.geneCoordinates = ["gtf", "gff", "saf"].includes(c.geneFormat) ? "one_based_inclusive" : "zero_based_half_open"; }
    for (const side of ["control", "treatment"] as const) {
      const track = ordered.find((f) => fileKey(f) === c.bindings[`${side}Plus`]);
      c[`${side}TrackSource`] = track && /(?:[._/-])(avg|mean|average)(?:[._/-]|$)/i.test(track.path) ? "averaged" : "unknown";
    }
  }
  return [...groups.values()].sort((a, b) => compare(a.id, b.id));
}

/** Exact sample IDs recur once in the registry. Conflicting source rows remain errors. */
export function parseSamples(text: string, provenance: string) {
  const rows = parseDelimited(text, text.split(/\r?\n/, 1)[0]?.includes("\t") ? "\t" : ",");
  const samples: Sample[] = [];
  for (const row of rows) {
    const lower = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));
    const get = (...names: string[]) => names.map((n) => lower[n]).find((v) => v !== undefined) ?? "";
    const id = get("sample", "sample_id", "sampleid"); if (!id) throw new Error("Sample metadata contains a missing sample ID.");
    samples.push({ id, condition: get("condition", "group", "treatment"), timePoint: get("time", "timepoint", "time_point"), biologicalReplicate: get("replicate", "replicate_id", "biological_replicate"), batch: get("batch", "processing_batch"), matchedBlock: get("matched_block", "replicate_block"), provenance });
  }
  return samples;
}
export function sampleFindings(samples: Sample[]) {
  const seen = new Map<string, Sample>(); const errors: string[] = [];
  for (const s of samples) { const prev = seen.get(s.id); if (prev && ["condition", "timePoint", "biologicalReplicate", "batch", "matchedBlock"].some((k) => prev[k as keyof Sample] !== s[k as keyof Sample])) errors.push(`Conflicting metadata for sample ${s.id}.`); seen.set(s.id, s); }
  return errors;
}
export function readExperimentMetadata(text: string, files: ImportedFile[]) {
  const data = JSON.parse(text) as Experiment;
  if (data.schema_version !== 2 || data.product !== "GEL Web" || !Array.isArray(data.contrasts) || data.contrasts.length > MAX_CONTRASTS) throw new Error("Expected a GEL experiment manifest schema_version 2 with up to 24 contrasts.");
  if(data.regionalStatistics!==undefined&&typeof data.regionalStatistics!=="boolean")throw new Error("regionalStatistics must be boolean.");
  for (const key of ["experimentId", "assembly", "annotationProvenance", "model", "normalization"] as const) if (data[key] !== undefined && typeof data[key] !== "string") throw new Error(`Invalid manifest field: ${key}.`);
  if(data.genomicScope) validateScope(data.genomicScope);
  if(data.execution) validateExecution(data.execution);
  const paths = new Map((data.files ?? []).map(f=>[f.id,f.path]));
  for(const recorded of data.files??[]){const actual=files.find(f=>f.path===recorded.path);if(actual&&(recorded.size!==actual.file.size||(recorded.sha256&&actual.sha256&&recorded.sha256!==actual.sha256)))throw new Error(`Manifest content fingerprint differs for ${recorded.path}; review the changed file and update the manifest.`);}
  const ids = new Set<string>();
  data.contrasts=data.contrasts.map(raw=>{
    if (!raw.id || typeof raw.id !== "string" || ids.has(raw.id)) throw new Error("Contrast IDs must be unique nonempty strings."); ids.add(raw.id);
    const c={...blankContrast(raw.id),...raw,confirmed:false};
    if(typeof c.excluded!=="boolean"||!c.bindings||Array.isArray(c.bindings)||Object.values(c.bindings).some(v=>typeof v!=="string"))throw new Error(`Invalid file bindings or exclusion flag in ${c.id}.`);
    for(const key of ["label","control","treatment","perturbation","timePoint","assembly","trackAssembly","model","normalization"] as const) if(typeof c[key]!=="string") throw new Error(`Invalid contrast ${raw.id} field: ${key}.`);
    if(!["auto","enrsa","erna-r","bigwig","combined"].includes(c.mode) || !["gtf","gff","tsv","bed","saf"].includes(c.geneFormat) || !["zero_based_half_open","one_based_inclusive"].includes(c.geneCoordinates) || !["","zero_based_half_open","one_based_inclusive"].includes(c.enhancerCoordinates)) throw new Error(`Invalid input mode or coordinate rule in ${c.id}.`);
    if(!["unknown","averaged","replicate"].includes(c.controlTrackSource)||!["unknown","averaged","replicate"].includes(c.treatmentTrackSource)) throw new Error(`Invalid track source in ${c.id}.`);
    if(!["auto","enrsa","erna-r"].includes(c.statisticalSource))throw new Error(`Invalid statistical source in ${c.id}.`);
    for(const ids of [c.controlSampleIds,c.treatmentSampleIds,c.controlTrackSampleIds,c.treatmentTrackSampleIds]) if(!Array.isArray(ids)||ids.some(id=>typeof id!=="string")) throw new Error("Sample references must be string arrays.");
    c.bindings=Object.fromEntries(Object.entries(c.bindings).map(([role,ref])=>{
      const path=paths.get(ref)??ref;const f=files.find(f=>f.path===path);
      return [role,f?fileKey(f):`missing:${path}`];
    }));
    return c;
  });
  if(data.scope&&(!Number.isInteger(data.scope.start)||!Number.isInteger(data.scope.end)||typeof data.scope.chrom!=="string"))throw new Error("Invalid regional scope in manifest.");
  data.samples=(data.samples??[]).map(s=>{
    if(!s.id||typeof s.id!=="string")throw new Error("Manifest sample ID missing.");
    const sample={...{condition:"",timePoint:"",biologicalReplicate:"",batch:"",matchedBlock:""},...s,provenance:"Imported manifest; user-declared"};
    if(Object.values(sample).some(v=>typeof v!=="string"))throw new Error("Sample metadata fields must be strings.");return sample;
  });
  return data;
}
/** A renamed manifest comparison must not also execute its automatically inferred duplicate. */
export function duplicateProposals(proposals:Contrast[],declared:Contrast[]) {
  const coreRoles:InputRole[]=["controlPlus","controlMinus","treatmentPlus","treatmentMinus","annotation","gbChange","normalizedPpGb","enhancerChange","geneResults","enhancerResults"];
  const complete=(c:Contrast)=>[["controlPlus","controlMinus","treatmentPlus","treatmentMinus","annotation"],["gbChange","normalizedPpGb","enhancerChange"],["geneResults","enhancerResults","annotation"]].some(roles=>roles.every(role=>c.bindings[role as InputRole]));
  return proposals.filter(p=>!declared.some(c=>c.id===p.id)&&complete(p)&&declared.some(c=>
    inferredMode(c)===inferredMode(p)&&c.geneFormat===p.geneFormat&&c.geneCoordinates===p.geneCoordinates&&coreRoles.every(role=>p.bindings[role]===c.bindings[role])));
}
export function inferredMode(c: Contrast) {
  const has = (...roles: InputRole[]) => roles.every((r) => c.bindings[r]);
  const b = has("controlPlus", "controlMinus", "treatmentPlus", "treatmentMinus", "annotation");
  const e = has("gbChange", "normalizedPpGb", "enhancerChange"); const r = has("enhancerResults", "geneResults", "annotation");
  return c.mode !== "auto" ? c.mode : b && (e || r) ? "combined" : e ? "enrsa" : r ? "erna-r" : b ? "bigwig" : c.bindings.enhancerResults ? "erna-r" : c.bindings.gbChange || c.bindings.enhancerChange ? "enrsa" : "bigwig";
}
export function assessContrast(c: Contrast, exp: Experiment) {
  const mode = inferredMode(c); const findings: string[] = []; const has = (r: InputRole) => exp.files.some((f) => f.id === c.bindings[r]);
  const warnings:string[]=[...(exp.metadataWarnings??[])];
  if(!exp.annotationProvenance.trim())warnings.push("Annotation version / provenance was not supplied.");
  if(mode!=="bigwig"&&(!c.controlSampleIds.length||!c.treatmentSampleIds.length))warnings.push("Underlying library identities are incomplete; shared condition references are retained without inferring replication.");
  const hasEnrsa = has("gbChange") && has("normalizedPpGb") && has("enhancerChange");
  const hasR=has("enhancerResults")&&has("geneResults")&&has("annotation");
  const stats = mode === "enrsa" || mode === "erna-r" || mode === "combined"; const tracks = mode === "bigwig" || mode === "combined";
  const source = mode === "enrsa" || (mode === "combined" && (c.statisticalSource==="enrsa"||(c.statisticalSource==="auto"&&hasEnrsa))) ? "enrsa" : "erna-r";
  if(mode==="combined"&&hasEnrsa&&hasR&&c.statisticalSource==="auto")findings.push("Both statistical catalogs are present; select an explicit statistical source or separate comparisons.");
  const required: InputRole[] = [...(stats ? source === "enrsa" ? ["gbChange", "normalizedPpGb", "enhancerChange"] as InputRole[] : ["enhancerResults", "geneResults", "annotation"] as InputRole[] : []), ...(tracks ? ["controlPlus", "controlMinus", "treatmentPlus", "treatmentMinus", "annotation"] as InputRole[] : [])];
  for (const r of [...new Set(required)]) if (!has(r)) findings.push(`Missing or ambiguous file: ${r}.`);
  if (!exp.experimentId.trim() || !exp.assembly.trim()) findings.push("Declare experiment ID and assembly.");
  if (!c.control.trim() || !c.treatment.trim() || !c.timePoint.trim()) findings.push("Confirm control, treatment and time point.");
  if (c.control === c.treatment && c.control) findings.push("Control and treatment must reference distinct conditions (include time in condition IDs when appropriate).");
  if (!c.confirmed) findings.push("Review and confirm inferred experimental identity.");
  if ((c.assembly || exp.assembly) !== exp.assembly) findings.push("Incompatible assembly: contrast differs from experiment.");
  if (tracks && (c.trackAssembly || c.assembly || exp.assembly) !== exp.assembly) findings.push("Incompatible assembly: BigWig declaration differs from experiment.");
  if (stats && !(c.model || exp.model).trim()) findings.push("Declare statistical model / normalization provenance.");
  if (tracks && !(c.normalization || exp.normalization).trim()) findings.push("Declare track normalization / averaging provenance.");
  if (stats && source === "erna-r" && !c.enhancerCoordinates) findings.push("Confirm R-DESeq2 enhancer coordinate convention.");
  if (tracks) for (const side of ["control", "treatment"] as const) {
    if (c[`${side}TrackSource`] === "unknown") findings.push(`Confirm ${side} track source type.`);
    if (c[`${side}TrackSource`] === "replicate" && c[`${side}TrackSampleIds`].length !== 1) findings.push(`Select exactly one sample ID for ${side} replicate tracks; no implicit replicate averaging.`);
    if(c[`${side}TrackSource`]==="averaged"&&!c[`${side}TrackSampleIds`].length)warnings.push(`Contributing ${side} average-track sample IDs were not supplied.`);
    const a = c.bindings[`${side}Plus`], b = c.bindings[`${side}Minus`]; if (a && a === b) findings.push(`The ${side} plus and minus tracks must be distinct files.`);
  }
  if(tracks&&(["Plus","Minus"] as const).some(strand=>c.bindings[`control${strand}`]&&c.bindings[`control${strand}`]===c.bindings[`treatment${strand}`]))findings.push("A track file cannot represent both conditions in the same contrast.");
  for (const id of [...new Set([...c.controlSampleIds, ...c.treatmentSampleIds,...c.controlTrackSampleIds,...c.treatmentTrackSampleIds])]) if (!exp.samples.some((s) => s.id === id)) findings.push(`Sample ${id} is not in the sample registry.`);
  if ([...c.controlSampleIds,...c.controlTrackSampleIds].some((id) => [...c.treatmentSampleIds,...c.treatmentTrackSampleIds].includes(id))) findings.push("A sample cannot serve as both control and treatment in the same contrast.");
  for (const side of ["control", "treatment"] as const) for (const id of [...new Set([...c[`${side}SampleIds`],...c[`${side}TrackSampleIds`]])]) { const s = exp.samples.find((x) => x.id === id); if (s?.condition && s.condition !== c[side]) findings.push(`Sample ${id} condition ${s.condition} conflicts with ${side} ${c[side]}.`); }
  const referenced=new Set([...c.controlSampleIds,...c.treatmentSampleIds,...c.controlTrackSampleIds,...c.treatmentTrackSampleIds]);
  findings.push(...sampleFindings(exp.samples.filter(s=>referenced.has(s.id))));
  if(sampleFindings(exp.samples.filter(s=>!referenced.has(s.id))).length)warnings.push("The registry has conflicting unreferenced sample records; those records are not used in this comparison.");
  if ((exp.regionalStatistics || tracks) && (!exp.genomicScope || exp.genomicScope.mode === "interval")) if (!exp.scope.chrom || !Number.isInteger(exp.scope.start) || !Number.isInteger(exp.scope.end) || exp.scope.start < 0 || exp.scope.end <= exp.scope.start || exp.scope.end - exp.scope.start > 50_000_000) findings.push("Choose a valid region up to 50 Mb.");
  if(exp.genomicScope){try{validateScope(exp.genomicScope);validateExecution(exp.execution);}catch(e){findings.push(e instanceof Error?e.message:String(e));}}
  return { mode, source, status: c.excluded ? "excluded" as const : findings.length ? "incomplete" as const : "pending" as const, findings, warnings,
    statisticsReady:hasEnrsa||hasR,tracksReady:["controlPlus","controlMinus","treatmentPlus","treatmentMinus","annotation"].every(r=>has(r as InputRole)),
    trackFilesPresent:exp.files.some(f=>(c.fileIds.includes(f.id)||Object.values(c.bindings).includes(f.id))&&/^(control|treatment)(Plus|Minus)$/.test(f.role)),
    statisticalEvidence: stats, bigwigEvidence: tracks, compatibility: findings.some((f) => f.startsWith("Incompatible")) ? "Incompatible" : "Compatibility unverified" };
}
export function requestsForContrast(c: Contrast, exp: Experiment, registry: Record<string, File>, parameters: Parameters): AnalysisRequest[] {
  const check = assessContrast(c, exp); if (check.status !== "pending") throw new Error(check.findings.join(" ") || "Contrast excluded.");
  const f = (role: InputRole) => registry[c.bindings[role] ?? ""];
  const optional = (role: InputRole) => f(role) || undefined;
  const common = { id: c.id, parameters, scope: exp.regionalStatistics ? (!exp.genomicScope||exp.genomicScope.mode==="interval"?exp.scope:{chromosomes:exp.genomicScope.mode==="chromosomes"?exp.genomicScope.chromosomes:undefined,excludedContigs:exp.genomicScope.excludedContigs}) : undefined };
  const requests: AnalysisRequest[] = [];
  if (check.statisticalEvidence) {
    if (check.source === "enrsa") requests.push({ ...common, kind: "enrsa", files: { gbChange: f("gbChange"), normalizedPpGb: f("normalizedPpGb"), enhancerChange: f("enhancerChange"), ppChange: optional("ppChange"), designTable: optional("designTable"), normalizationFactors: optional("normalizationFactors"), normalizedEnhancerCounts: optional("normalizedEnhancerCounts") }, metadata: { assembly: exp.assembly, contrast: c.id, source: "enrsa", model: c.model || exp.model } });
    else requests.push({ ...common, kind: "erna-r", files: { enhancerResults: f("enhancerResults"), geneResults: f("geneResults"), geneAnnotation: f("annotation"), filteredBed: optional("filteredBed") }, metadata: { assembly: exp.assembly, contrast: c.id, model: c.model || exp.model, geneFormat: c.geneFormat, geneCoordinates: c.geneCoordinates, enhancerCoordinates: c.enhancerCoordinates as CoordinateRule } });
  }
  if (check.bigwigEvidence) requests.push({ id: c.id, kind: "bigwig", request: { files: { controlPlus: f("controlPlus"), controlMinus: f("controlMinus"), treatmentPlus: f("treatmentPlus"), treatmentMinus: f("treatmentMinus") }, annotationFile: f("annotation"), annotationFormat: c.geneFormat, annotationCoordinates: c.geneCoordinates, genomeAssembly: exp.assembly, normalization: c.normalization || exp.normalization, contrast: c.id, region: exp.scope, genomicScope:exp.genomicScope, execution:exp.execution, parameters } });
  return requests;
}
export function experimentLinkRefs(exp: Experiment, outcomes: Outcome[], layer: "primary" | "track" = "primary") {
  return outcomes.filter(o=>o.status==="successful"&&o.result).flatMap(o=>{
    const contrast=exp.contrasts.find(c=>c.id===o.contrastId)!;
    return (layer==="track"?o.result!.trackEvidence?.links??[]:o.result!.links).map(row=>({row,contrast}));
  }).sort((a,b)=>compare(a.contrast.id,b.contrast.id)||compare(a.row.link_id,b.row.link_id));
}
export function decorateExperimentLink(exp:Experiment,r:Link,c:Contrast,layer:"primary"|"track"="primary"):ExperimentLink {
  return {...r,experiment_id:exp.experimentId,contrast_id:c.id,candidate_id:`${encodeURIComponent(c.id)}::${encodeURIComponent(r.link_id)}`,control_condition:c.control,treatment_condition:c.treatment,perturbation:c.perturbation,time_point:c.timePoint,genome_assembly:exp.assembly,control_sample_ids:c.controlSampleIds.join(";"),treatment_sample_ids:c.treatmentSampleIds.join(";"),control_track_sample_ids:c.controlTrackSampleIds.join(";"),treatment_track_sample_ids:c.treatmentTrackSampleIds.join(";"),evidence_layer:layer};
}
export function experimentLinks(exp: Experiment, outcomes: Outcome[], layer: "primary" | "track" = "primary"): ExperimentLink[] {
  return experimentLinkRefs(exp,outcomes,layer).map(({row,contrast})=>decorateExperimentLink(exp,row,contrast,layer));
}
export function geneSummaries(exp: Experiment, outcomes: Outcome[]) {
  return outcomes.filter((o) => o.status === "successful" && o.result).flatMap((o) => {
    const c = exp.contrasts.find((c) => c.id === o.contrastId)!; const result = o.result! as ExportInput & { geneStats?: Differential[] };
    const counts = new Map<string, Link[]>(); for (const r of result.links) { const xs = counts.get(r.gene_id) ?? []; xs.push(r); counts.set(r.gene_id,xs); }
    const effects = new Map((result.geneStats ?? []).map((s) => [s.featureId,s]));
    return (result.genes as Gene[]).map((g) => { const rows = counts.get(g.geneId) ?? []; const stat=effects.get(g.geneId); return { contrast_id:c.id, treatment:c.treatment, control:c.control, time_point:c.timePoint, gene_id:g.geneId, gene_symbol:g.symbol, chrom:g.chrom, start:g.start, end:g.end, strand:g.strand, gene_log2fc:stat?.log2fc ?? null, gene_se:stat?.se ?? null, gene_padj:stat?.padj ?? null, candidate_count:rows.length, high:rows.filter(r=>r.evidence_tier==="high").length, moderate:rows.filter(r=>r.evidence_tier==="moderate").length, weak:rows.filter(r=>r.evidence_tier==="weak").length, discordant:rows.filter(r=>r.evidence_tier==="discordant").length, insufficient:rows.filter(r=>r.evidence_tier==="insufficient").length }; });
  }).sort((a,b)=>compare(a.gene_id,b.gene_id)||compare(a.contrast_id,b.contrast_id));
}
