"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PARAMETERS, type Compatibility, type Link, type Parameters } from "@/lib/analysis";
import type { ExportInput } from "@/lib/exports";

type Mode = "bigwig" | "enrsa" | "erna-r" | "combined";
type Result = { genes: unknown[]; enhancers: { featureId: string; chrom: string; start: number; end: number; log2fc: number | null; sourceId: string; source: string; morphology?: string }[];
  geneStats?: unknown[]; secondaryGeneStats?: unknown[]; links: Link[]; trackEvidence?: Result; validation: Record<string, unknown> & { compatibility?: Compatibility; warnings?: string[]; elapsedMs?: number } };
type WorkerReply = { id: string; type: "progress" | "complete" | "error"; message?: string; result?: Result; error?: string };
type Fields = Record<string, File | null>;

const tierOrder = ["high", "moderate", "weak", "discordant", "insufficient"];
const tierLabels: Record<string, string> = { high: "Both statistically supported", moderate: "Concordant effects", weak: "Weak / descriptive", discordant: "Discordant", insufficient: "Insufficient response" };
const morphologyChoices = [...new Set([...DEFAULT_PARAMETERS.morphologyClasses, "convergent_inward", "asymmetric_uncertain", "low_signal_ambiguous"])];

function FileField({ label, accept, file, onChange, required = false }: { label: string; accept?: string; file: File | null; onChange: (file: File | null) => void; required?: boolean }) {
  const [preview, setPreview] = useState<{ name: string; text: string }>({ name: "", text: "" });
  useEffect(() => { let active = true; if (file && !/\.(bw|bigwig)$/i.test(file.name)) file.slice(0, 8192).text().then((text) => {
    const firstLine = text.split(/\r?\n/).find((line) => line.trim() && !line.startsWith("#")) ?? "";
    const cols = firstLine.split(firstLine.includes("\t") ? "\t" : ",").map((col) => col.replaceAll('"', "")).slice(0, 12).join(" · ");
    const name = file.name.toLowerCase(); const recognized = name.includes("gb_change") ? "eNRSA gene-body differential table" : name.includes("normalized_pp_gb") ? "eNRSA gene coordinates and normalized measurements" : name.includes("enhancer_change") ? "eNRSA enhancer differential table" : name.includes("_results.csv") ? "eRNA_diff R-DESeq2 differential table" : "Header preview";
    if (active) setPreview({ name: file.name, text: `${recognized}: ${cols}` });
  }).catch(() => { if (active) setPreview({ name: file.name, text: "File preview unavailable; analysis validation will check the schema." }); }); return () => { active = false; }; }, [file]);
  return <label className="local-file-field"><span>{label}{required && <b> Required</b>}</span><input type="file" accept={accept} onChange={(event) => onChange(event.target.files?.[0] ?? null)} /><small>{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : "Choose a local file"}</small>{file && preview.name === file.name && <small className="schema-preview">{preview.text}</small>}</label>;
}

export default function WorkspacePage() {
  const [mode, setMode] = useState<Mode>("enrsa"); const [source, setSource] = useState<"enrsa" | "erna_r">("enrsa");
  const [files, setFiles] = useState<Fields>({}); const [assembly, setAssembly] = useState(""); const [contrast, setContrast] = useState("");
  const [controlCondition, setControlCondition] = useState(""); const [treatmentCondition, setTreatmentCondition] = useState(""); const [timePoint, setTimePoint] = useState("");
  const [model, setModel] = useState(""); const [normalization, setNormalization] = useState("");
  const [region, setRegion] = useState({ chrom: "chr1", start: "0", end: "1000000" }); const [geneFormat, setGeneFormat] = useState<"tsv" | "gtf" | "bed">("gtf");
  const [geneCoordinates, setGeneCoordinates] = useState<"zero_based_half_open" | "one_based_inclusive">("zero_based_half_open");
  const [parameters, setParameters] = useState<Parameters>({ ...DEFAULT_PARAMETERS }); const [showAdvanced, setShowAdvanced] = useState(false);
  const [result, setResult] = useState<Result | null>(null); const [busy, setBusy] = useState(false); const [exporting, setExporting] = useState(false); const [status, setStatus] = useState(""); const [error, setError] = useState("");
  const [query, setQuery] = useState(""); const [tier, setTier] = useState("all"); const [sort, setSort] = useState("evidence"); const [page, setPage] = useState(0);
  const workerRef = useRef<Worker | null>(null); const cancelRef = useRef<(() => void) | null>(null); const currentJob = useRef(0); const PAGE_SIZE = 100;
  const setField = (key: string) => (file: File | null) => setFiles((old) => ({ ...old, [key]: file }));
  const loadSynthetic = async (type: "bigwig" | "enrsa") => {
    setError(""); setStatus("Loading the small public synthetic fixture into local File objects…");
    const get = async (url: string, filename = url.split("/").at(-1) ?? "fixture") => { const response = await fetch(url); if (!response.ok) throw new Error(`Could not load synthetic fixture ${filename}`); return new File([await response.blob()], filename); };
    try {
      if (type === "bigwig") {
        const names = ["ctrl_A_plus.bw", "ctrl_A_minus.bw", "treat_A_plus.bw", "treat_A_minus.bw"];
        const localFiles = await Promise.all(names.map((name) => get(`/demo/tracks/${name}`, name)));
        const annotation = await get("/demo/genes.tsv", "genes.tsv");
        setFiles((old) => ({ ...old, controlPlus: localFiles[0], controlMinus: localFiles[1], treatmentPlus: localFiles[2], treatmentMinus: localFiles[3], annotation }));
        setMode("bigwig"); setGeneFormat("tsv"); setGeneCoordinates("zero_based_half_open"); setAssembly("synthetic-demo-v1"); setNormalization("Synthetic shared per-base scale; no statistical normalization"); setContrast(""); setControlCondition("control"); setTreatmentCondition("perturbation"); setTimePoint("1h");
        setRegion({ chrom: "chrDemo", start: "0", end: "10000" }); setParameters({ ...DEFAULT_PARAMETERS, maxDistanceBp: 5000, minMeanSignal: 0.08, mergeGapBp: 0 }); setStatus("Synthetic BigWig fixture loaded. Run it through the browser analysis worker.");
      } else {
        const names = ["gb_change.txt", "normalized_pp_gb.txt", "Enhancer_change.txt"];
        const localFiles = await Promise.all(names.map((name) => get(`/demo/enrsa/${name}`, name)));
        setFiles((old) => ({ ...old, gbChange: localFiles[0], normalizedPpGb: localFiles[1], enhancerChange: localFiles[2] }));
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
      let output: Result;
      const runTracks = async () => {
        const required = ["controlPlus", "controlMinus", "treatmentPlus", "treatmentMinus", "annotation"];
        const missing = required.filter((key) => !files[key]); if (missing.length) throw new Error(`Choose all four strand-specific BigWigs and a gene annotation file. Missing: ${missing.join(", ")}.`);
        if (!assembly.trim() || !normalization.trim() || !controlCondition.trim() || !treatmentCondition.trim() || !timePoint.trim()) throw new Error("Declare genome assembly, control, treatment, time point, and signal normalization before running BigWigs.");
        return workerRun({ kind: "bigwig", request: { files: { controlPlus: files.controlPlus, controlMinus: files.controlMinus, treatmentPlus: files.treatmentPlus, treatmentMinus: files.treatmentMinus },
          annotationFile: files.annotation, annotationFormat: geneFormat, annotationCoordinates: geneCoordinates, genomeAssembly: assembly, normalization,
          contrast: contrastLabel, region: { chrom: region.chrom, start: Number(region.start), end: Number(region.end) }, parameters } });
      };
      if (mode === "bigwig") output = await runTracks();
      else if (source === "enrsa") {
        const missing = ["gbChange", "normalizedPpGb", "enhancerChange"].filter((key) => !files[key]); if (missing.length) throw new Error(`Choose gb_change.txt, normalized_pp_gb.txt, and Enhancer_change.txt. Missing: ${missing.join(", ")}.`);
        if (!assembly.trim() || !controlCondition.trim() || !treatmentCondition.trim() || !timePoint.trim() || !model.trim()) throw new Error("Declare genome assembly, control, treatment, time point, and differential model/normalization provenance before running.");
        output = await workerRun({ kind: "enrsa", files: { gbChange: files.gbChange, normalizedPpGb: files.normalizedPpGb, enhancerChange: files.enhancerChange, ppChange: files.ppChange ?? undefined,
          normalizedEnhancerCounts: files.normalizedEnhancerCounts ?? undefined, designTable: files.designTable ?? undefined, normalizationFactors: files.normalizationFactors ?? undefined },
          metadata: { assembly, contrast: contrastLabel, source: "enrsa", model }, parameters });
      } else {
        const missing = ["enhancerResults", "geneResults", "annotation"].filter((key) => !files[key]); if (missing.length) throw new Error(`Choose R-DESeq2 enhancer results, gene-body differential results, and gene annotation. Missing: ${missing.join(", ")}.`);
        if (!assembly.trim() || !controlCondition.trim() || !treatmentCondition.trim() || !timePoint.trim() || !model.trim()) throw new Error("Declare genome assembly, control, treatment, time point, and differential model/normalization provenance before running.");
        output = await workerRun({ kind: "erna-r", files: { enhancerResults: files.enhancerResults, geneResults: files.geneResults, geneAnnotation: files.annotation, filteredBed: files.filteredBed ?? undefined },
          metadata: { assembly, contrast: contrastLabel, model, geneFormat, geneCoordinates }, parameters });
      }
      const provenance = { inputMode: mode, statisticalSource: source, genomeAssembly: assembly, contrast: contrastLabel, controlCondition, treatmentCondition, timePoint, statisticalModel: model, normalization,
        parameters, fileMetadata: Object.entries(files).filter((entry): entry is [string, File] => entry[1] instanceof File).map(([role, file]) => ({ role, name: file.name, bytes: file.size, lastModified: file.lastModified })),
        localOnly: true, uploadedToServer: false };
      if (mode === "combined") {
        output.trackEvidence = await runTracks();
        output.validation.compatibility = { status: "Compatibility unverified", checks: [
          { name: "Assembly", status: "user-declared", detail: `${assembly} declared; neither source embeds an independently verifiable annotation checksum.` },
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
    <div className="workspace-grid">
      <section className="panel"><div className="panel-header"><span className="panel-kicker">01</span><div><h2>Input mode and experiment</h2><p>Choose one contrast and state the source metadata explicitly.</p></div></div>
        <label className="field-label">Input mode<select value={mode} onChange={(e) => setMode(e.target.value as Mode)}><option value="bigwig">BigWig-only · descriptive</option><option value="enrsa">eNRSA / PyDESeq2 tables</option><option value="erna-r">eRNA_diff / R-DESeq2 tables</option><option value="combined">Combined statistics + tracks (separate evidence)</option></select></label>
        <div className="demo-loaders"><button type="button" className="button button-light" onClick={() => void loadSynthetic("bigwig")}>Load synthetic BigWig example</button><button type="button" className="button button-light" onClick={() => void loadSynthetic("enrsa")}>Load synthetic eNRSA-table example</button><small>Public artificial data only; both paths run through the local importer and analysis worker.</small></div>
        {(mode !== "bigwig") && <label className="field-label">Differential source<select value={source} onChange={(e) => setSource(e.target.value as "enrsa" | "erna_r")}><option value="enrsa">eNRSA output</option><option value="erna_r">eRNA_diff R-DESeq2 branch</option></select></label>}
        <div className="parameter-grid metadata-grid"><label>Genome assembly<input value={assembly} onChange={(e) => setAssembly(e.target.value)} placeholder="e.g. GRCh38" /></label><label>Control condition<input value={controlCondition} onChange={(e) => setControlCondition(e.target.value)} placeholder="e.g. vehicle / 0 h" /></label><label>Treatment condition<input value={treatmentCondition} onChange={(e) => setTreatmentCondition(e.target.value)} placeholder="e.g. degrader / 1 h" /></label><label>Time point<input value={timePoint} onChange={(e) => setTimePoint(e.target.value)} placeholder="e.g. 1 h" /></label><label>Contrast ID (optional)<input value={contrast} onChange={(e) => setContrast(e.target.value)} placeholder={`${treatmentCondition} ${timePoint} vs ${controlCondition}`} /></label>
          {mode !== "bigwig" && <label>Model and normalization provenance<input value={model} onChange={(e) => setModel(e.target.value)} /></label>}
          {(mode === "bigwig" || mode === "combined") && <label>Track normalization / averaging<input value={normalization} onChange={(e) => setNormalization(e.target.value)} /></label>}
        </div>
        {(mode === "bigwig" || mode === "combined") && <><div className="fields-grid"><FileField label="Control plus BigWig" accept=".bw,.bigwig" file={files.controlPlus ?? null} onChange={setField("controlPlus")} required /><FileField label="Control minus BigWig" accept=".bw,.bigwig" file={files.controlMinus ?? null} onChange={setField("controlMinus")} required /><FileField label="Treatment plus BigWig" accept=".bw,.bigwig" file={files.treatmentPlus ?? null} onChange={setField("treatmentPlus")} required /><FileField label="Treatment minus BigWig" accept=".bw,.bigwig" file={files.treatmentMinus ?? null} onChange={setField("treatmentMinus")} required /></div>
          <div className="field-split"><label className="field-label">Gene annotation format<select value={geneFormat} onChange={(e) => setGeneFormat(e.target.value as "gtf" | "tsv" | "bed")}><option value="gtf">GTF (1-based inclusive)</option><option value="tsv">GEL gene TSV</option><option value="bed">BED6</option></select></label><label className="field-label">TSV coordinate convention<select value={geneCoordinates} onChange={(e) => setGeneCoordinates(e.target.value as typeof geneCoordinates)}><option value="zero_based_half_open">0-based half-open</option><option value="one_based_inclusive">1-based inclusive</option></select></label></div>
          <FileField label="Gene annotation" accept=".gtf,.gff,.tsv,.bed,.txt" file={files.annotation ?? null} onChange={setField("annotation")} required />
          <div className="field-split region-fields"><label>Scan chromosome<input value={region.chrom} onChange={(e) => setRegion({ ...region, chrom: e.target.value })} /></label><label>Start (0-based)<input type="number" min="0" value={region.start} onChange={(e) => setRegion({ ...region, start: e.target.value })} /></label><label>End (exclusive)<input type="number" min="1" value={region.end} onChange={(e) => setRegion({ ...region, end: e.target.value })} /></label></div>
          <p className="field-help">This first browser version scans one declared interval, up to 50 Mb and 64 MB of indexed blocks across the four tracks. It is not genome-wide. The annotation must include genes within the distance flank.</p></>}
        {source === "enrsa" && mode !== "bigwig" && <><div className="fields-grid"><FileField label="known_gene/gb_change.txt" accept=".txt,.tsv" file={files.gbChange ?? null} onChange={setField("gbChange")} required /><FileField label="known_gene/normalized_pp_gb.txt" accept=".txt,.tsv" file={files.normalizedPpGb ?? null} onChange={setField("normalizedPpGb")} required /><FileField label="eRNA/Enhancer_change.txt" accept=".txt,.tsv" file={files.enhancerChange ?? null} onChange={setField("enhancerChange")} required /></div><details className="optional-files"><summary>Optional eNRSA supporting files</summary><div className="fields-grid"><FileField label="known_gene/pp_change.txt · separate promoter response" accept=".txt,.tsv" file={files.ppChange ?? null} onChange={setField("ppChange")} /><FileField label="eRNA/normalized_count_enhancer.txt · exact interval/sample QC" accept=".txt,.tsv" file={files.normalizedEnhancerCounts ?? null} onChange={setField("normalizedEnhancerCounts")} /><FileField label="intermediate/design_table_for_deseq2.txt" accept=".txt,.tsv" file={files.designTable ?? null} onChange={setField("designTable")} /><FileField label="intermediate/nf.txt" accept=".txt,.tsv" file={files.normalizationFactors ?? null} onChange={setField("normalizationFactors")} /></div></details></>}
        {source === "erna_r" && mode !== "bigwig" && <><div className="fields-grid"><FileField label="eRNA_diff differential_analysis/*_results.csv" accept=".csv" file={files.enhancerResults ?? null} onChange={setField("enhancerResults")} required /><FileField label="Gene-body differential results (Gene ID column)" accept=".csv,.tsv,.txt" file={files.geneResults ?? null} onChange={setField("geneResults")} required /></div><FileField label="Optional: bidirectional_enhancers.bed (SAF start correction applied)" accept=".bed,.txt" file={files.filteredBed ?? null} onChange={setField("filteredBed")} /><p className="field-help">eRNA_diff effects are SAF-based: [Start, End] becomes [Start−1, End). The filtered BED-shaped file carries SAF coordinates and gets the same correction. Its rows lack p-values unless matched to a differential result.</p></>}
        {mode === "combined" && <p className="warning-box">Combined mode currently runs DESeq2-table analysis as the inferential source. BigWig-derived signal remains separate descriptive evidence; GEL does not transfer statistics across overlapping intervals. Shared HEL eNRSA normalization does not establish numerical equivalence to averaged BigWig signal.</p>}
      </section>
      <section className="panel"><div className="panel-header"><span className="panel-kicker">02</span><div><h2>Analysis criteria</h2><p>Defaults are transparent effect thresholds, not probability cutoffs.</p></div></div>
        <div className="parameter-grid"><label>Maximum TSS distance (bp)<input type="number" min="1" value={parameters.maxDistanceBp} onChange={(e) => setParameters({ ...parameters, maxDistanceBp: Number(e.target.value) })} /></label><label>Minimum gene |log₂FC|<input type="number" min="0" step="0.1" value={parameters.minGeneAbsLfc} onChange={(e) => setParameters({ ...parameters, minGeneAbsLfc: Number(e.target.value) })} /></label><label>Minimum enhancer |log₂FC|<input type="number" min="0" step="0.1" value={parameters.minEnhancerAbsLfc} onChange={(e) => setParameters({ ...parameters, minEnhancerAbsLfc: Number(e.target.value) })} /></label></div>
        <details open={showAdvanced} onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}><summary>Advanced thresholds and overlap settings</summary><div className="parameter-grid advanced-grid"><label>Maximum adjusted p-value<input type="number" min="0" max="1" step="0.01" value={parameters.maxPadj} onChange={(e) => setParameters({ ...parameters, maxPadj: Number(e.target.value) })} /></label><label>Maximum magnitude gap<input type="number" min="0" step="0.1" value={parameters.maxMagnitudeGapLfc} onChange={(e) => setParameters({ ...parameters, maxMagnitudeGapLfc: Number(e.target.value) })} /></label><label>Minimum mean signal per base<input type="number" min="0" step="0.01" value={parameters.minMeanSignal} onChange={(e) => setParameters({ ...parameters, minMeanSignal: Number(e.target.value) })} /></label><label>Peak bin width (bp)<input type="number" min="10" step="10" value={parameters.peakBinBp} onChange={(e) => setParameters({ ...parameters, peakBinBp: Number(e.target.value) })} /></label><label>Promoter upstream window<input type="number" min="0" value={parameters.promoterUpstreamBp} onChange={(e) => setParameters({ ...parameters, promoterUpstreamBp: Number(e.target.value) })} /></label><label>Promoter downstream window<input type="number" min="0" value={parameters.promoterDownstreamBp} onChange={(e) => setParameters({ ...parameters, promoterDownstreamBp: Number(e.target.value) })} /></label></div><div className="check-row"><label><input type="checkbox" checked={parameters.requireDirection} onChange={(e) => setParameters({ ...parameters, requireDirection: e.target.checked })} /> Require direction agreement</label><label><input type="checkbox" checked={parameters.compareMagnitude} onChange={(e) => setParameters({ ...parameters, compareMagnitude: e.target.checked })} /> Apply magnitude similarity criterion</label><label><input type="checkbox" checked={parameters.excludePromoters} onChange={(e) => setParameters({ ...parameters, excludePromoters: e.target.checked })} /> Exclude promoter overlaps</label><label><input type="checkbox" checked={parameters.excludeGeneBody} onChange={(e) => setParameters({ ...parameters, excludeGeneBody: e.target.checked })} /> Exclude gene-body overlaps</label></div><div className="morphology-choice"><strong>BigWig peak classes to retain</strong><div className="check-row">{morphologyChoices.map((choice) => <label key={choice}><input type="checkbox" checked={parameters.morphologyClasses.includes(choice)} onChange={(e) => setParameters({ ...parameters, morphologyClasses: e.target.checked ? [...parameters.morphologyClasses, choice] : parameters.morphologyClasses.filter((x) => x !== choice) })} /> {choice.replaceAll("_", " ")}</label>)}</div></div><p className="field-help">Changing effect and p-value thresholds changes evidence tiers; raw effects remain in the results. BigWig morphology filters affect the signal-derived peak catalog only.</p></details>
      </section>
      <section className="run-panel"><div><strong>{busy ? status : "Run locally in this browser"}</strong><p>{result ? `${result.links.length.toLocaleString()} candidates · ${(result.validation.elapsedMs ?? 0).toLocaleString()} ms · privacy: local` : "No selected file contents are sent to GEL servers. Processing runs in a dedicated Web Worker."}</p></div><div className="run-actions"><button disabled={busy} className="button button-dark" onClick={run}>{busy ? "Analyzing…" : "Validate inputs and analyze →"}</button>{busy && <button className="button button-light" onClick={() => cancelRef.current?.()}>Cancel</button>}</div></section>
    </div>
    {error && <div className="error-box" role="alert"><strong>Could not run analysis</strong><p>{error}</p></div>}
    {result && <section className="panel result-panel"><div className="workspace-title"><div><div className="eyebrow">ANALYSIS RESULTS</div><h2>Candidate enhancer evidence</h2><p>{result.links.length.toLocaleString()} all-pairs rows from {result.genes.length.toLocaleString()} genes and {result.enhancers.length.toLocaleString()} enhancer features.</p></div><button className="button button-green" disabled={exporting} onClick={() => void runExport("zip")}>{exporting ? "Building ZIP in worker…" : "Download complete result ZIP ↓"}</button></div>
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
