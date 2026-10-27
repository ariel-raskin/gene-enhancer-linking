"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PARAMETERS, type Compatibility, type Link, type Parameters } from "@/lib/analysis";
import ExperimentWorkspace from "@/components/experiment-workspace";
import { proposeContrasts } from "@/lib/experiment";
import type { ExportInput } from "@/lib/exports";
import { inspectFiles, previewSampleMetadata, readiness, ROLE_LABELS, type ImportedFile, type InputRole, type SampleMetadataPreview } from "@/lib/smart-importer";

type Mode = "bigwig" | "enrsa" | "erna-r" | "combined";
type Result = { genes: unknown[]; enhancers: { featureId: string; chrom: string; start: number; end: number; log2fc: number | null; sourceId: string; source: string; morphology?: string }[];
  geneStats?: unknown[]; secondaryGeneStats?: unknown[]; links: Link[]; trackEvidence?: Result; validation: Record<string, unknown> & { compatibility?: Compatibility; warnings?: string[]; elapsedMs?: number } };
type WorkerReply = { id: string; type: "progress" | "complete" | "error"; message?: string; result?: Result; error?: string };
type Fields = Record<string, File | null>;

const tierOrder = ["high", "moderate", "weak", "discordant", "insufficient"];
const tierLabels: Record<string, string> = { high: "Both statistically supported", moderate: "Concordant effects", weak: "Weak / descriptive", discordant: "Discordant", insufficient: "Insufficient response" };
const morphologyChoices = [...new Set([...DEFAULT_PARAMETERS.morphologyClasses, "convergent_inward", "asymmetric_uncertain", "low_signal_ambiguous"])];

export default function WorkspacePage() {
  const [experimentMode, setExperimentMode] = useState(false);
  const [mode, setMode] = useState<Mode>("enrsa"); const [source, setSource] = useState<"enrsa" | "erna_r">("enrsa");
  const [files, setFiles] = useState<Fields>({}); const [inventory, setInventory] = useState<ImportedFile[]>([]); const [assembly, setAssembly] = useState(""); const [trackAssembly, setTrackAssembly] = useState(""); const [statisticsAssembly, setStatisticsAssembly] = useState(""); const [contrast, setContrast] = useState("");
  const [controlCondition, setControlCondition] = useState(""); const [treatmentCondition, setTreatmentCondition] = useState(""); const [timePoint, setTimePoint] = useState("");
  const [model, setModel] = useState(""); const [normalization, setNormalization] = useState("");
  const [region, setRegion] = useState({ chrom: "chr1", start: "0", end: "1000000" }); const [geneFormat, setGeneFormat] = useState<"tsv" | "gtf" | "gff" | "bed" | "saf">("gtf");
  const [geneCoordinates, setGeneCoordinates] = useState<"zero_based_half_open" | "one_based_inclusive">("zero_based_half_open");
  const [enhancerCoordinates, setEnhancerCoordinates] = useState<"zero_based_half_open" | "one_based_inclusive" | "">("");
  const [parameters, setParameters] = useState<Parameters>({ ...DEFAULT_PARAMETERS }); const [showAdvanced, setShowAdvanced] = useState(false);
  const [result, setResult] = useState<Result | null>(null); const [busy, setBusy] = useState(false); const [exporting, setExporting] = useState(false); const [status, setStatus] = useState(""); const [error, setError] = useState("");
  const [sampleMetadataState, setSampleMetadataState] = useState<{ file: File; preview?: SampleMetadataPreview; error?: string } | null>(null);
  const [query, setQuery] = useState(""); const [tier, setTier] = useState("all"); const [sort, setSort] = useState("evidence"); const [page, setPage] = useState(0);
  const workerRef = useRef<Worker | null>(null); const cancelRef = useRef<(() => void) | null>(null); const currentJob = useRef(0); const PAGE_SIZE = 100; const folderInput = useRef<HTMLInputElement | null>(null);
  useEffect(() => { folderInput.current?.setAttribute("webkitdirectory", ""); folderInput.current?.setAttribute("directory", ""); }, []);
  const syncInventory = (items: ImportedFile[]) => {
    setInventory(items);
    if (proposeContrasts(items).length > 1) setExperimentMode(true);
    const roles = new Set(items.filter((item) => !item.duplicateOf).map((item) => item.role));
    const trackRoles = ["controlPlus", "controlMinus", "treatmentPlus", "treatmentMinus", "annotation"];
    const hasAnyTrack = trackRoles.slice(0, 4).some((role) => roles.has(role as InputRole)); const hasTrack = trackRoles.every((role) => roles.has(role as InputRole));
    const hasAnyEnrsa = ["gbChange", "normalizedPpGb", "enhancerChange"].some((role) => roles.has(role as InputRole));
    const hasEnrsa = ["gbChange", "normalizedPpGb", "enhancerChange"].every((role) => roles.has(role as InputRole));
    const hasAnyR = roles.has("enhancerResults") || roles.has("geneResults"); const hasR = ["enhancerResults", "geneResults", "annotation"].every((role) => roles.has(role as InputRole));
    setMode(hasTrack && (hasEnrsa || hasR) ? "combined" : hasTrack ? "bigwig" : hasEnrsa ? "enrsa" : hasR ? "erna-r" : hasAnyTrack ? "bigwig" : hasAnyR ? "erna-r" : hasAnyEnrsa ? "enrsa" : "enrsa");
    if (hasR && !hasEnrsa) setSource("erna_r"); else if (hasEnrsa) setSource("enrsa");
    const mapped: Fields = {};
    for (const item of items) if (!item.duplicateOf && item.role !== "unknown" && !mapped[item.role]) mapped[item.role] = item.file;
    setFiles(mapped);
    const annotation = items.find((item) => item.role === "annotation");
    if (annotation?.format === "GTF" || annotation?.format === "GFF3") { setGeneFormat(annotation.format === "GTF" ? "gtf" : "gff"); setGeneCoordinates("one_based_inclusive"); }
    else if (annotation?.format.startsWith("GEL gene TSV")) { setGeneFormat("tsv"); setGeneCoordinates("zero_based_half_open"); }
    else if (annotation?.format.startsWith("featureCounts SAF")) { setGeneFormat("saf"); setGeneCoordinates("one_based_inclusive"); }
    else if (annotation?.format === "BED") { setGeneFormat("bed"); setGeneCoordinates("zero_based_half_open"); }
  };
  const addFiles = async (incoming: FileList | File[], replace = false) => {
    const newFiles = Array.from(incoming); if (!newFiles.length) return;
    setError(""); setStatus(`Inspecting ${newFiles.length} file${newFiles.length === 1 ? "" : "s"} locally…`);
    try {
      const baseline = replace ? [] : inventory; const already = new Set(baseline.map((item) => `${item.path}\t${item.file.size}\t${item.file.lastModified}`));
      const fresh = newFiles.filter((file) => { const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name; const key = `${path}\t${file.size}\t${file.lastModified}`; if (already.has(key)) return false; already.add(key); return true; });
      const detected = await inspectFiles(fresh);
      syncInventory([...baseline, ...detected]); setStatus(`Inspected ${baseline.length + detected.length} local files. Review inferred assignments and experiment metadata.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus("File inspection did not complete."); }
  };
  const changeRole = (id: string, role: InputRole) => syncInventory(inventory.map((item) => item.id === id ? { ...item, role, recognition: role === item.suggestedRole ? item.recognition : "user_confirmed", evidence: role === item.suggestedRole ? item.evidence : [...item.evidence, `Role confirmed by researcher as ${ROLE_LABELS[role]}`] } : item));
  const confirmFileRole = (id: string) => syncInventory(inventory.map((item) => item.id === id ? { ...item, recognition: "user_confirmed", evidence: [...item.evidence, `Role reviewed and confirmed by researcher as ${ROLE_LABELS[item.role]}`] } : item));
  const replaceImportedFile = async (id: string, replacement: File) => {
    const old = inventory.find((item) => item.id === id); if (!old) return;
    try { const [detected] = await inspectFiles([replacement]); const selectedRole = detected.role === "unknown" ? old.role : detected.role;
      syncInventory(inventory.map((item) => item.id === id ? { ...detected, id: old.id, role: selectedRole, suggestedRole: detected.suggestedRole, recognition: selectedRole === detected.suggestedRole ? detected.recognition : "user_confirmed" } : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const removeImportedFile = (id: string) => syncInventory(inventory.filter((item) => item.id !== id));
  const statusSummary = useMemo(() => readiness(inventory), [inventory]);
  const designFile = inventory.find((item) => item.role === "designTable" && !item.duplicateOf)?.file ?? null;
  useEffect(() => {
    let active = true;
    if (designFile) void previewSampleMetadata(designFile).then((preview) => { if (active) setSampleMetadataState({ file: designFile, preview }); }).catch((cause: unknown) => { if (active) setSampleMetadataState({ file: designFile, error: cause instanceof Error ? cause.message : String(cause) }); });
    return () => { active = false; };
  }, [designFile]);
  const sampleMetadata = sampleMetadataState?.file === designFile ? sampleMetadataState.preview : null;
  const sampleMetadataError = sampleMetadataState?.file === designFile ? sampleMetadataState.error : null;
  const workflowOptions = useMemo(() => {
    const options: { value: Mode; label: string }[] = [];
    if (statusSummary.bigwig) options.push({ value: "bigwig", label: "BigWig-only descriptive" });
    if (statusSummary.enrsa) options.push({ value: "enrsa", label: "eNRSA differential" });
    if (statusSummary.rDeseq) options.push({ value: "erna-r", label: "R-DESeq2 differential" });
    if (statusSummary.bigwig && (statusSummary.enrsa || statusSummary.rDeseq)) options.push({ value: "combined", label: "Combined (keeps evidence separate)" });
    return options;
  }, [statusSummary]);
  const saveManifest = () => {
    const manifest = { schema_version: 1, product: "GEL Web", manifest_status: "researcher-confirmed fields are recorded as declared; detector-based assignments remain inferred or structurally verified", experiment: { genome_assembly: { value: assembly || null, status: assembly ? "user_confirmed" : "missing" }, differential_genome_assembly: { value: statisticsAssembly || null, status: statisticsAssembly ? "user_confirmed" : "missing" }, track_genome_assembly: { value: trackAssembly || null, status: trackAssembly ? "user_confirmed" : "missing" }, control: { value: controlCondition || null, status: controlCondition ? "user_confirmed" : "missing" }, treatment: { value: treatmentCondition || null, status: treatmentCondition ? "user_confirmed" : "missing" }, time_point: { value: timePoint || null, status: timePoint ? "user_confirmed" : "missing" }, contrast_id: contrast || null, statistical_model: { value: model || null, status: model ? "user_confirmed" : "missing" }, signal_normalization: { value: normalization || null, status: normalization ? "user_confirmed" : "missing" }, gene_coordinate_convention: { value: geneCoordinates, status: "user_selected" }, enhancer_coordinate_convention: { value: enhancerCoordinates || null, status: enhancerCoordinates ? "user_confirmed" : "missing" } }, files: inventory.map((item) => ({ path: item.path, size_bytes: item.file.size, last_modified: new Date(item.file.lastModified).toISOString(), role: item.role, detected_format: item.format, recognition: item.recognition, confidence: item.confidence, evidence: item.evidence, duplicate_of: item.duplicateOf ?? null })), analysis_parameters: parameters, privacy: { selected_file_contents_uploaded: false } };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "gel_experiment_manifest.json"; anchor.click(); URL.revokeObjectURL(url);
  };
  const loadSynthetic = async (type: "bigwig" | "enrsa" | "experiment") => {
    setError(""); setStatus("Loading the small public synthetic fixture into local File objects…");
    const get = async (url: string, filename = url.split("/").at(-1) ?? "fixture") => { const response = await fetch(url); if (!response.ok) throw new Error(`Could not load synthetic fixture ${filename}`); return new File([await response.blob()], filename); };
    try {
      if (type === "experiment") {
        const response=await fetch("/demo/experiment/files.json"); if(!response.ok)throw new Error("Could not load experiment fixture index.");
        const paths=await response.json() as string[];
        const localFiles=await Promise.all(paths.map(async path=>{const file=await get(`/demo/experiment/${path}`,path.split("/").at(-1));Object.defineProperty(file,"webkitRelativePath",{value:`synthetic_experiment/${path}`});return file;}));
        await addFiles(localFiles,true);setExperimentMode(true);setStatus("Synthetic experiment loaded. Apply its metadata and review each comparison.");
      } else if (type === "bigwig") {
        setExperimentMode(false);
        const names = ["ctrl_A_plus.bw", "ctrl_A_minus.bw", "treat_A_plus.bw", "treat_A_minus.bw"];
        const localFiles = await Promise.all(names.map((name) => get(`/demo/tracks/${name}`, name)));
        const annotation = await get("/demo/genes.tsv", "genes.tsv");
        await addFiles([...localFiles, annotation], true);
        setMode("bigwig"); setGeneFormat("tsv"); setGeneCoordinates("zero_based_half_open"); setAssembly("synthetic-demo-v1"); setNormalization("Synthetic shared per-base scale; no statistical normalization"); setContrast(""); setControlCondition("control"); setTreatmentCondition("perturbation"); setTimePoint("1h");
        setRegion({ chrom: "chrDemo", start: "0", end: "10000" }); setParameters({ ...DEFAULT_PARAMETERS, maxDistanceBp: 5000, minMeanSignal: 0.08, mergeGapBp: 0 }); setStatus("Synthetic BigWig fixture loaded. Run it through the browser analysis worker.");
      } else {
        setExperimentMode(false);
        const names = ["gb_change.txt", "normalized_pp_gb.txt", "Enhancer_change.txt"];
        const localFiles = await Promise.all(names.map((name) => get(`/demo/enrsa/${name}`, name)));
        await addFiles(localFiles, true);
        setMode("enrsa"); setSource("enrsa"); setAssembly("synthetic-demo-v1"); setContrast(""); setControlCondition("control"); setTreatmentCondition("perturbation"); setTimePoint("1h"); setModel("Synthetic fixture with eNRSA-compatible columns; not biological DESeq2 output"); setStatus("Synthetic eNRSA-schema fixture loaded. Run it through the browser importer.");
        setParameters({ ...DEFAULT_PARAMETERS, maxDistanceBp: 5000 });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const workerRun = (request: Record<string, unknown>) => new Promise<Result>((resolve, reject) => {
    const worker = new Worker(new URL("../../workers/analysis.worker.ts", import.meta.url), { type: "module" }); workerRef.current = worker;
    const id = `${Date.now()}-${++currentJob.current}`;
    cancelRef.current = () => { worker.terminate(); workerRef.current = null; cancelRef.current = null; reject(new Error("Analysis cancelled.")); };
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data; if (reply.id !== id) return;
      if (reply.type === "progress") setStatus(reply.message ?? "Working locally…");
      if (reply.type === "error") { worker.terminate(); workerRef.current = null; cancelRef.current = null; reject(new Error(reply.error ?? "Analysis failed.")); }
      if (reply.type === "complete" && reply.result) { worker.terminate(); workerRef.current = null; cancelRef.current = null; resolve(reply.result); }
    };
    worker.onerror = (event) => { worker.terminate(); workerRef.current = null; cancelRef.current = null; reject(new Error(event.message || "Analysis worker failed.")); };
    worker.postMessage({ id, ...request });
  });

  const run = async () => {
    setError(""); setResult(null); setBusy(true); setStatus("Preparing local analysis worker…");
    try {
      if (statusSummary.hasConflicts) throw new Error("This simple view accepts one file per role. Choose Organize as experiment to assign multiple comparisons or select an explicit track pair.");
      if (mode === "combined" && trackAssembly.trim() && statisticsAssembly.trim() && trackAssembly.trim().toLowerCase() !== statisticsAssembly.trim().toLowerCase()) throw new Error(`Incompatible assemblies were declared for tracks (${trackAssembly}) and differential results (${statisticsAssembly}). Run one source at a time or correct the assembly declarations.`);
      const trackBuild = mode === "combined" ? trackAssembly.trim() || assembly.trim() : assembly.trim();
      const statisticsBuild = mode === "combined" ? statisticsAssembly.trim() || assembly.trim() : assembly.trim();
      let output: Result;
      const runTracks = async () => {
        const required = ["controlPlus", "controlMinus", "treatmentPlus", "treatmentMinus", "annotation"];
        const missing = required.filter((key) => !files[key]); if (missing.length) throw new Error(`Choose all four strand-specific BigWigs and a gene annotation file. Missing: ${missing.join(", ")}.`);
        if (!trackBuild || !normalization.trim() || !controlCondition.trim() || !treatmentCondition.trim() || !timePoint.trim()) throw new Error("Declare genome assembly, control, treatment, time point, and signal normalization before running BigWigs.");
        return workerRun({ kind: "bigwig", request: { files: { controlPlus: files.controlPlus, controlMinus: files.controlMinus, treatmentPlus: files.treatmentPlus, treatmentMinus: files.treatmentMinus },
          annotationFile: files.annotation, annotationFormat: geneFormat, annotationCoordinates: geneCoordinates, genomeAssembly: trackBuild, normalization,
          contrast: contrastLabel, region: { chrom: region.chrom, start: Number(region.start), end: Number(region.end) }, parameters } });
      };
      if (mode === "bigwig") output = await runTracks();
      else if (source === "enrsa") {
        const missing = ["gbChange", "normalizedPpGb", "enhancerChange"].filter((key) => !files[key]); if (missing.length) throw new Error(`Choose gb_change.txt, normalized_pp_gb.txt, and Enhancer_change.txt. Missing: ${missing.join(", ")}.`);
        if (!statisticsBuild || !controlCondition.trim() || !treatmentCondition.trim() || !timePoint.trim() || !model.trim()) throw new Error("Declare genome assembly, control, treatment, time point, and differential model/normalization provenance before running.");
        output = await workerRun({ kind: "enrsa", files: { gbChange: files.gbChange, normalizedPpGb: files.normalizedPpGb, enhancerChange: files.enhancerChange, ppChange: files.ppChange ?? undefined,
          normalizedEnhancerCounts: files.normalizedEnhancerCounts ?? undefined, designTable: files.designTable ?? undefined, normalizationFactors: files.normalizationFactors ?? undefined },
          metadata: { assembly: statisticsBuild, contrast: contrastLabel, source: "enrsa", model }, parameters });
      } else {
        const missing = ["enhancerResults", "geneResults", "annotation"].filter((key) => !files[key]); if (missing.length) throw new Error(`Choose R-DESeq2 enhancer results, gene-body differential results, and gene annotation. Missing: ${missing.join(", ")}.`);
        if (!statisticsBuild || !controlCondition.trim() || !treatmentCondition.trim() || !timePoint.trim() || !model.trim()) throw new Error("Declare genome assembly, control, treatment, time point, and differential model/normalization provenance before running.");
        if (!enhancerCoordinates) throw new Error("Confirm whether the R-DESeq2 enhancer Start/End fields are SAF 1-based inclusive or BED 0-based half-open.");
        output = await workerRun({ kind: "erna-r", files: { enhancerResults: files.enhancerResults, geneResults: files.geneResults, geneAnnotation: files.annotation, filteredBed: files.filteredBed ?? undefined },
          metadata: { assembly: statisticsBuild, contrast: contrastLabel, model, geneFormat, geneCoordinates, enhancerCoordinates }, parameters });
      }
      const provenance = { inputMode: mode, statisticalSource: source, genomeAssembly: assembly || statisticsBuild, trackAssembly: trackBuild, statisticsAssembly: statisticsBuild, contrast: contrastLabel, controlCondition, treatmentCondition, timePoint, statisticalModel: model, normalization,
        parameters, fileMetadata: Object.entries(files).filter((entry): entry is [string, File] => entry[1] instanceof File).map(([role, file]) => ({ role, name: file.name, bytes: file.size, lastModified: file.lastModified })),
        localOnly: true, uploadedToServer: false };
      if (mode === "combined") {
        output.trackEvidence = await runTracks();
        output.validation.compatibility = { status: "Compatibility unverified", checks: [
          { name: "Assembly", status: trackBuild === statisticsBuild && trackBuild ? "matching-declarations" : "unverified", detail: `Differential: ${statisticsBuild || "not declared"}; tracks: ${trackBuild || "not declared"}. Neither source embeds an independently verifiable annotation checksum.` },
          { name: "Contrast", status: "user-declared", detail: `${contrastLabel} entered once for both file groups; source-side contrast identity was not independently read from metadata.` },
          { name: "Normalization", status: "unverified", detail: `${model} versus ${normalization}; signal and model estimates represent different quantities unless provenance documents otherwise.` },
          { name: "Feature identity", status: "exact-coordinate only", detail: "Track-only intervals remain separate; no DE statistic is propagated by overlap." },
        ] };
        output.validation.warnings = [...(output.validation.warnings ?? []), "Combined mode runs statistical tables and indexed BigWig signal in separate evidence layers. No numerical evidence was merged because normalization and exact feature identity are not independently verified."];
      }
      setResult(output); setStatus(`Finished locally in ${(output.validation.elapsedMs ?? 0) / 1000}s · ${output.links.length.toLocaleString()} candidate rows.`);
      setProvenance(provenance);
    } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); if (message !== "Analysis cancelled.") setError(message); setStatus(message === "Analysis cancelled." ? "Cancelled by user." : "Analysis did not complete."); }
    finally { setBusy(false); }
  };
  const [provenance, setProvenance] = useState<Record<string, unknown>>({});
  const contrastLabel = contrast.trim() || `${treatmentCondition} ${timePoint} vs ${controlCondition}`;
  const visible = useMemo(() => (result?.links ?? []).filter((row) => (!query || `${row.gene_symbol} ${row.gene_id}`.toLowerCase().includes(query.toLowerCase())) && (tier === "all" || row.evidence_tier === tier))
    .sort((a, b) => sort === "distance" ? a.distance_bp - b.distance_bp : sort === "magnitude" ? (a.magnitude_gap_log2fc ?? Infinity) - (b.magnitude_gap_log2fc ?? Infinity) : tierOrder.indexOf(a.evidence_tier) - tierOrder.indexOf(b.evidence_tier) || a.distance_bp - b.distance_bp), [result, query, tier, sort]);
  const pageCount = Math.ceil(visible.length / PAGE_SIZE); const shown = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const saveExport = (name: string, blob: Blob) => { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const runExport = async (kind: "zip" | "file", fileKey?: string, exportResult?: Result) => {
    if (!result) return; setExporting(true); setError("");
    const target = exportResult ?? result; const id = `export-${Date.now()}`;
    const worker = new Worker(new URL("../../workers/export.worker.ts", import.meta.url), { type: "module" });
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<{ id: string; type: string; blob?: Blob; name?: string; error?: string }>) => {
          const reply = event.data; if (reply.id !== id) return;
          if (reply.type === "error") reject(new Error(reply.error ?? "Export failed."));
          else if (reply.type === "complete" && reply.blob) { saveExport(reply.name ?? "gel-export.txt", reply.blob); resolve(reply.blob); }
        };
        worker.onerror = (event) => reject(new Error(event.message || "Export worker failed."));
        worker.postMessage({ id, kind, fileKey, result: target as unknown as ExportInput, parameters, provenance });
      });
      return blob;
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { worker.terminate(); setExporting(false); }
  };
  const filteredResult = (): Result | null => result ? { ...result, links: visible,
    enhancers: result.enhancers.filter((enhancer) => visible.some((link) => link.enhancer_id === enhancer.featureId)) } : null;

  return <main className="workspace-wrap">
    <div className="workspace-title"><div><div className="eyebrow">LOCAL ANALYSIS WORKSPACE</div><h1>Analyze processed PRO-seq data</h1><p>Files are read in your browser. GEL does not send selected files or generated genomic results to a server.</p></div><span className="pill pill-blue">Worker-based · no upload endpoint</span></div>
    <div className="disclaimer"><strong>Research interpretation:</strong> response concordance nominates candidate associations. It does not prove direct causal regulation. BigWig ratios are descriptive and never produce p-values.</div>
    <div className={`workspace-grid ${experimentMode ? "experiment-grid" : ""}`}>
      <section className="panel"><div className="panel-header"><span className="panel-kicker">01</span><div><h2>Import experiment files</h2><p>Add files or a processed directory. GEL inspects each file locally and proposes roles from structure and context.</p></div></div>
        <div className="demo-loaders"><button type="button" className="button button-light" onClick={() => void loadSynthetic("bigwig")}>Load synthetic BigWig example</button><button type="button" className="button button-light" onClick={() => void loadSynthetic("enrsa")}>Load synthetic eNRSA-table example</button><button type="button" className="button button-light" onClick={() => void loadSynthetic("experiment")}>Load synthetic multi-contrast experiment</button><small>Synthetic data use the same local detectors and analysis worker as researcher files.</small></div>
        <div className="smart-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(event.dataTransfer.files); }}>
          <strong>Drop files or a processed analysis collection</strong><span>Local browser reads only. Files are not uploaded.</span>
          <div className="smart-actions"><label className="button button-dark">Choose files<input aria-label="Choose experiment files" type="file" multiple onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.currentTarget.value = ""; }} /></label>
            <button type="button" className="button button-light" onClick={() => folderInput.current?.click()}>Choose folder</button>
            <input {...{ webkitdirectory: "", directory: "" }} ref={folderInput} aria-label="Choose processed-analysis folder" className="folder-input" type="file" multiple onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.currentTarget.value = ""; }} /></div>
        </div>
        {!!inventory.length && <div className="smart-actions"><button type="button" className="button button-light" disabled={experimentMode && proposeContrasts(inventory).length > 1} onClick={() => setExperimentMode(!experimentMode)}>{experimentMode ? "Use simple single-contrast view" : "Organize as experiment"}</button></div>}
        {experimentMode ? <ExperimentWorkspace inventory={inventory} parameters={parameters} onParameters={setParameters} onRole={changeRole} onRemove={removeImportedFile} onReplace={(id,file)=>void replaceImportedFile(id,file)} /> : <>
        {!!inventory.length && <><div className="import-summary"><strong>{inventory.length} files inspected</strong><span>{statusSummary.available.length ? `Possible workflows: ${statusSummary.available.join(" · ")}` : "No complete workflow detected yet; add missing files below."}</span><button type="button" className="text-button" onClick={saveManifest}>Save experiment manifest ↓</button></div>
          {workflowOptions.length > 1 && <label className="workflow-choice">Analysis to run after import<select aria-label="Analysis workflow" value={mode} onChange={(event) => { const selected = event.target.value as Mode; setMode(selected); if (selected === "enrsa") setSource("enrsa"); if (selected === "erna-r") setSource("erna_r"); }}>{workflowOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>}
          {statusSummary.hasConflicts && <p className="warning-box">More than one unique file is assigned to a role, or an exact duplicate was selected. Choose “Organize as experiment” to keep multiple contrasts and assign files within each comparison. This simple view accepts one file per role.</p>}
          <div className="inventory-list">{inventory.map((item) => <div className="inventory-row" key={item.id}><div className="inventory-file"><strong title={item.path}>{item.path}</strong><small>{item.format} · {(item.file.size / 1024 / 1024).toFixed(2)} MB · {item.recognition.replaceAll("_", " ")} · {Math.round(item.confidence * 100)}%</small><small>{item.evidence.join("; ")}{item.duplicateOf ? ` · duplicate of ${item.duplicateOf}` : ""}</small></div><select aria-label={`Role for ${item.path}`} value={item.role} onChange={(event) => changeRole(item.id, event.target.value as InputRole)}>{Object.entries(ROLE_LABELS).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select><div className="inventory-actions">{item.recognition === "inferred" && <button type="button" className="text-button" onClick={() => confirmFileRole(item.id)}>Confirm role</button>}<label className="text-button replace-import">Replace<input aria-label={`Replace ${item.path}`} type="file" onChange={(event) => { const picked = event.target.files?.[0]; if (picked) void replaceImportedFile(item.id, picked); event.currentTarget.value = ""; }} /></label><button type="button" className="text-button remove-import" onClick={() => removeImportedFile(item.id)}>Remove</button></div></div>)}</div>
          <div className="readiness-box"><strong>Readiness</strong><span>{statusSummary.bigwig ? "✓ BigWig requirements met" : `BigWig missing: ${statusSummary.bigwigMissing.map((role) => ROLE_LABELS[role as InputRole]).join(", ")}`}</span><span>{statusSummary.enrsa ? "✓ eNRSA requirements met" : `eNRSA missing: ${statusSummary.enrsaMissing.map((role) => ROLE_LABELS[role as InputRole]).join(", ")}`}</span><span>{statusSummary.rDeseq ? "✓ R-DESeq2 requirements met" : `R-DESeq2 missing: ${statusSummary.rMissing.map((role) => ROLE_LABELS[role as InputRole]).join(", ")}`}</span></div></>}
        {sampleMetadata && <div className="sample-preview"><strong>Sample sheet preview · source-declared</strong><span>{sampleMetadata.sampleCount} rows · {sampleMetadata.sampleIds.length} unique sample IDs · conditions: {sampleMetadata.conditionLevels.join(", ") || "none"}</span><span>Time points: {sampleMetadata.timePoints.join(", ") || "not provided"} · replicate labels: {sampleMetadata.replicateLabels.join(", ") || "not provided"} · batch labels: {sampleMetadata.batchLabels.join(", ") || "not provided"}</span><small>These labels are reported as written. A replicate column does not establish biological independence or pairing, and this simple view runs one contrast. The experiment view retains multiple comparisons separately.</small></div>}
        {sampleMetadataError && <p className="warning-box">Sample sheet was recognized but its preview needs attention: {sampleMetadataError}</p>}
        <div className="parameter-grid metadata-grid">{mode !== "combined" ? <label>Genome assembly<input value={assembly} onChange={(e) => setAssembly(e.target.value)} placeholder="Confirm, e.g. GRCh38" /></label> : <><label>Differential tables genome assembly<input value={statisticsAssembly} onChange={(e) => setStatisticsAssembly(e.target.value)} placeholder="e.g. GRCh38" /></label><label>BigWig tracks genome assembly<input value={trackAssembly} onChange={(e) => setTrackAssembly(e.target.value)} placeholder="e.g. GRCh38" /></label></>}<label>Control condition<input value={controlCondition} onChange={(e) => setControlCondition(e.target.value)} placeholder="Confirm control / vehicle" /></label><label>Treatment condition<input value={treatmentCondition} onChange={(e) => setTreatmentCondition(e.target.value)} placeholder="Confirm perturbation" /></label><label>Time point<input value={timePoint} onChange={(e) => setTimePoint(e.target.value)} placeholder="Confirm e.g. 1 h" /></label><label>Contrast ID (optional)<input value={contrast} onChange={(e) => setContrast(e.target.value)} placeholder={`${treatmentCondition} ${timePoint} vs ${controlCondition}`} /></label>
          {mode !== "bigwig" && <label>Statistical model / normalization provenance<input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Required for statistical results" /></label>}
          {(mode === "bigwig" || mode === "combined") && <label>Track normalization / averaging<input value={normalization} onChange={(e) => setNormalization(e.target.value)} placeholder="Describe scaling and replicate averaging" /></label>}
        </div>
        {(mode === "bigwig" || mode === "combined") && <><div className="field-split"><label className="field-label">Gene annotation format<select value={geneFormat} onChange={(e) => setGeneFormat(e.target.value as "gtf" | "gff" | "tsv" | "bed" | "saf")}><option value="gtf">GTF (1-based inclusive)</option><option value="gff">GFF3 (1-based inclusive)</option><option value="tsv">GEL gene TSV</option><option value="bed">BED6 (0-based)</option><option value="saf">SAF (1-based inclusive)</option></select></label><label className="field-label">TSV coordinate convention<select value={geneCoordinates} onChange={(e) => setGeneCoordinates(e.target.value as typeof geneCoordinates)}><option value="zero_based_half_open">0-based half-open</option><option value="one_based_inclusive">1-based inclusive</option></select></label></div><div className="field-split region-fields"><label>Scan chromosome<input value={region.chrom} onChange={(e) => setRegion({ ...region, chrom: e.target.value })} /></label><label>Start (0-based)<input type="number" min="0" value={region.start} onChange={(e) => setRegion({ ...region, start: e.target.value })} /></label><label>End (exclusive)<input type="number" min="1" value={region.end} onChange={(e) => setRegion({ ...region, end: e.target.value })} /></label></div><p className="field-help">One interval up to 50 Mb and 64 MB indexed data across four tracks. Genome-wide scanning is not yet supported. eRNA_diff SAF coordinates are corrected only when that exact role is selected.</p></>}
        {mode === "erna-r" && <label className="coordinate-confirm">R-DESeq2 enhancer interval coordinate convention<select aria-label="Enhancer coordinate convention" value={enhancerCoordinates} onChange={(event) => setEnhancerCoordinates(event.target.value as typeof enhancerCoordinates)}><option value="">Select and confirm…</option><option value="one_based_inclusive">SAF 1-based inclusive (start converted to start−1)</option><option value="zero_based_half_open">BED 0-based half-open (preserved)</option></select><small>Confirm from source annotation. Filename and columns alone do not establish coordinate convention.</small></label>}
        {(mode === "combined" || (mode !== "bigwig" && source === "enrsa")) && <p className="warning-box">Combined inputs remain separate evidence layers unless assembly, contrast, exact feature identity, sample provenance, and normalization are verified. Different source-specific assembly declarations block a combined run. An overlap never transfers a differential statistic to a track-derived region.</p>}
        <p className="field-help">Recognized role and file format are structural observations. Condition, time, replicate, strand and assembly guesses from file names or paths remain inferred until you confirm the experiment fields above. Multiple contrasts sharing controls must be analyzed separately.</p>
        </>}
      </section>
      {!experimentMode && <><section className="panel"><div className="panel-header"><span className="panel-kicker">02</span><div><h2>Analysis criteria</h2><p>Defaults are transparent effect thresholds, not probability cutoffs.</p></div></div>
        <div className="parameter-grid"><label>Maximum TSS distance (bp)<input type="number" min="1" value={parameters.maxDistanceBp} onChange={(e) => setParameters({ ...parameters, maxDistanceBp: Number(e.target.value) })} /></label><label>Minimum gene |log₂FC|<input type="number" min="0" step="0.1" value={parameters.minGeneAbsLfc} onChange={(e) => setParameters({ ...parameters, minGeneAbsLfc: Number(e.target.value) })} /></label><label>Minimum enhancer |log₂FC|<input type="number" min="0" step="0.1" value={parameters.minEnhancerAbsLfc} onChange={(e) => setParameters({ ...parameters, minEnhancerAbsLfc: Number(e.target.value) })} /></label></div>
        <details open={showAdvanced} onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}><summary>Advanced thresholds and overlap settings</summary><div className="parameter-grid advanced-grid"><label>Maximum adjusted p-value<input type="number" min="0" max="1" step="0.01" value={parameters.maxPadj} onChange={(e) => setParameters({ ...parameters, maxPadj: Number(e.target.value) })} /></label><label>Maximum magnitude gap<input type="number" min="0" step="0.1" value={parameters.maxMagnitudeGapLfc} onChange={(e) => setParameters({ ...parameters, maxMagnitudeGapLfc: Number(e.target.value) })} /></label><label>Minimum mean signal per base<input type="number" min="0" step="0.01" value={parameters.minMeanSignal} onChange={(e) => setParameters({ ...parameters, minMeanSignal: Number(e.target.value) })} /></label><label>Peak bin width (bp)<input type="number" min="10" step="10" value={parameters.peakBinBp} onChange={(e) => setParameters({ ...parameters, peakBinBp: Number(e.target.value) })} /></label><label>Promoter upstream window<input type="number" min="0" value={parameters.promoterUpstreamBp} onChange={(e) => setParameters({ ...parameters, promoterUpstreamBp: Number(e.target.value) })} /></label><label>Promoter downstream window<input type="number" min="0" value={parameters.promoterDownstreamBp} onChange={(e) => setParameters({ ...parameters, promoterDownstreamBp: Number(e.target.value) })} /></label></div><div className="check-row"><label><input type="checkbox" checked={parameters.requireDirection} onChange={(e) => setParameters({ ...parameters, requireDirection: e.target.checked })} /> Require direction agreement</label><label><input type="checkbox" checked={parameters.compareMagnitude} onChange={(e) => setParameters({ ...parameters, compareMagnitude: e.target.checked })} /> Apply magnitude similarity criterion</label><label><input type="checkbox" checked={parameters.excludePromoters} onChange={(e) => setParameters({ ...parameters, excludePromoters: e.target.checked })} /> Exclude promoter overlaps</label><label><input type="checkbox" checked={parameters.excludeGeneBody} onChange={(e) => setParameters({ ...parameters, excludeGeneBody: e.target.checked })} /> Exclude gene-body overlaps</label></div><div className="morphology-choice"><strong>BigWig peak classes to retain</strong><div className="check-row">{morphologyChoices.map((choice) => <label key={choice}><input type="checkbox" checked={parameters.morphologyClasses.includes(choice)} onChange={(e) => setParameters({ ...parameters, morphologyClasses: e.target.checked ? [...parameters.morphologyClasses, choice] : parameters.morphologyClasses.filter((x) => x !== choice) })} /> {choice.replaceAll("_", " ")}</label>)}</div></div><p className="field-help">Changing effect and p-value thresholds changes evidence tiers; raw effects remain in the results. BigWig morphology filters affect the signal-derived peak catalog only.</p></details>
      </section>
      <section className="run-panel"><div><strong>{busy ? status : "Run locally in this browser"}</strong><p>{result ? `${result.links.length.toLocaleString()} candidates · ${(result.validation.elapsedMs ?? 0).toLocaleString()} ms · privacy: local` : "No selected file contents are sent to GEL servers. Processing runs in a dedicated Web Worker."}</p></div><div className="run-actions"><button disabled={busy} className="button button-dark" onClick={run}>{busy ? "Analyzing…" : "Validate inputs and analyze →"}</button>{busy && <button className="button button-light" onClick={() => cancelRef.current?.()}>Cancel</button>}</div></section>
      </>}
    </div>
    {error && <div className="error-box" role="alert"><strong>Could not run analysis</strong><p>{error}</p></div>}
    {!experimentMode && result && <section className="panel result-panel"><div className="workspace-title"><div><div className="eyebrow">ANALYSIS RESULTS</div><h2>Candidate enhancer evidence</h2><p>{result.links.length.toLocaleString()} all-pairs rows from {result.genes.length.toLocaleString()} genes and {result.enhancers.length.toLocaleString()} enhancer features.</p></div><button className="button button-green" disabled={exporting} onClick={() => void runExport("zip")}>{exporting ? "Building ZIP in worker…" : "Download complete result ZIP ↓"}</button></div>
      <div className="validation-strip"><strong>Status: {result.validation.compatibility?.status ?? "Source-internal differential analysis"}</strong><span>Duration: {(result.validation.elapsedMs ?? 0).toLocaleString()} ms</span><span>Inferential p-values: {result.validation.pValuesProduced ? "source table only" : "none"}</span></div>
      {!!result.secondaryGeneStats?.length && <p className="field-help">{result.secondaryGeneStats.length.toLocaleString()} promoter-proximal differential rows were imported as a separate secondary measure; they are included in the ZIP and are not combined with gene-body effects.</p>}
      {(result.validation.warnings ?? []).map((warning) => <p className="field-help" key={warning}>• {warning}</p>)}
      {result.trackEvidence && <div className="track-evidence"><div className="eyebrow">SEPARATE DESCRIPTIVE TRACK LAYER</div><h3>{result.trackEvidence.enhancers.length.toLocaleString()} signal-derived regions · {result.trackEvidence.links.length.toLocaleString()} track-only pairs</h3><p>These indexed BigWig calculations are not merged into the statistical result table. They have no p-values and do not inherit statistics through overlap. The combined-run ZIP preserves this layer in separate files.</p><div className="table-wrap"><table><thead><tr><th>Signal interval</th><th>Track log₂ ratio</th><th>Strand morphology</th></tr></thead><tbody>{result.trackEvidence.enhancers.slice(0, 100).map((item) => <tr key={item.featureId}><td>{item.chrom}:{item.start}-{item.end}</td><td>{item.log2fc?.toFixed(3) ?? "NA"}</td><td>{item.morphology ?? "signal-derived candidate"}</td></tr>)}</tbody></table></div></div>}
      <div className="results-toolbar"><input aria-label="Search gene" placeholder="Search gene symbol or ID" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} /><select aria-label="Evidence tier filter" value={tier} onChange={(e) => { setTier(e.target.value); setPage(0); }}><option value="all">All evidence tiers</option>{tierOrder.map((x) => <option value={x} key={x}>{tierLabels[x]}</option>)}</select><select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}><option value="evidence">Sort: evidence, then distance</option><option value="distance">Sort: distance</option><option value="magnitude">Sort: magnitude gap</option></select><span>{visible.length.toLocaleString()} visible</span></div>
      <div className="table-wrap"><table><thead><tr><th>Evidence</th><th>Gene</th><th>Enhancer</th><th>Distance</th><th>Gene log₂FC</th><th>Enhancer log₂FC</th><th>Gene padj</th><th>Enhancer padj</th><th>Peak class</th><th>Overlap</th></tr></thead><tbody>{shown.map((row) => <tr key={row.link_id}><td><span className={`tier tier-${row.evidence_tier}`}>{tierLabels[row.evidence_tier]}</span></td><td><strong>{row.gene_symbol}</strong><small>{row.gene_id} · {row.gene_chrom}:{row.gene_start}-{row.gene_end} ({row.gene_strand})</small></td><td><code>{row.chrom}:{row.enhancer_start}-{row.enhancer_end}</code><small>{row.enhancer_id}</small></td><td>{row.distance_bp.toLocaleString()} bp</td><td>{row.gene_log2fc?.toFixed(3) ?? "NA"}</td><td>{row.enhancer_log2fc?.toFixed(3) ?? "NA"}</td><td>{row.gene_padj?.toExponential(2) ?? "NA"}</td><td>{row.enhancer_padj?.toExponential(2) ?? "NA"}</td><td>{row.morphology.replaceAll("_", " ")}</td><td>{row.overlaps_promoter ? "Promoter" : row.overlaps_gene_body ? "Gene body" : "No"}</td></tr>)}</tbody></table>{shown.length === 0 && <div className="empty-state">No candidate relationships match these filters.</div>}</div>
      <div className="results-bottom"><button className="button button-light" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Previous</button><span>Page {page + 1} of {Math.max(1, pageCount)} · showing at most 100 rows</span><button className="button button-light" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>Next →</button></div>
      <div className="download-actions"><button disabled={exporting} className="button button-light" onClick={() => void runExport("file", "gel_links.csv", filteredResult() ?? undefined)}>Filtered CSV</button><button disabled={exporting} className="button button-light" onClick={() => void runExport("file", "gel_links.tsv", filteredResult() ?? undefined)}>Filtered TSV</button><button disabled={exporting} className="button button-light" onClick={() => void runExport("file", "gel_links.bedpe", filteredResult() ?? undefined)}>Filtered BEDPE</button><button disabled={exporting} className="button button-light" onClick={() => void runExport("file", "gel_links.interact", filteredResult() ?? undefined)}>Filtered colored interact</button><button disabled={exporting} className="button button-light" onClick={() => void runExport("file", "gel_enhancers.bed", filteredResult() ?? undefined)}>Filtered enhancer BED</button><button disabled={exporting} className="button button-light" onClick={() => void runExport("file", "gel_genes.bed", filteredResult() ?? undefined)}>Filtered gene BED</button></div>
    </section>}
  </main>;
}
