import { parseDelimited } from "./analysis";
import { readLocalText } from "./read-local-text";

/** Local-first structural file detection for the GEL workspace. */
export type InputRole =
  | "controlPlus" | "controlMinus" | "treatmentPlus" | "treatmentMinus" | "annotation"
  | "gbChange" | "normalizedPpGb" | "enhancerChange" | "ppChange" | "normalizedEnhancerCounts"
  | "experimentMetadata" | "designTable" | "normalizationFactors" | "enhancerResults" | "geneResults" | "filteredBed" | "unknown";
export type Recognition = "structurally_verified" | "inferred" | "user_confirmed" | "unassigned";
export type DetectorContext = { file: File; relativePath: string; header: string };
export type DetectorMatch = { role: InputRole; format: string; evidence: string; confidence: number; inferred: boolean };
export type DetectorPlugin = { id: string; detect(context: DetectorContext): DetectorMatch | null };
export type ImportedFile = { id: string; file: File; path: string; role: InputRole; format: string; evidence: string[]; confidence: number; recognition: Recognition; suggestedRole: InputRole; duplicateOf?: string; sha256?: string };
export type SampleMetadataPreview = { sampleCount: number; sampleIds: string[]; conditionLevels: string[]; timePoints: string[]; replicateLabels: string[]; batchLabels: string[]; missingSampleIds: number; columns: string[] };

const roles: { role: InputRole; label: string }[] = [
  { role: "experimentMetadata", label: "GEL experiment manifest (metadata only)" },
  { role: "controlPlus", label: "Control plus-strand BigWig" }, { role: "controlMinus", label: "Control minus-strand BigWig" },
  { role: "treatmentPlus", label: "Treatment plus-strand BigWig" }, { role: "treatmentMinus", label: "Treatment minus-strand BigWig" },
  { role: "annotation", label: "Gene annotation (GTF/GFF/BED/TSV)" }, { role: "gbChange", label: "eNRSA gene-body differential results" },
  { role: "normalizedPpGb", label: "eNRSA gene coordinates and normalized measurements" }, { role: "enhancerChange", label: "eNRSA enhancer differential results" },
  { role: "ppChange", label: "eNRSA promoter-proximal results" }, { role: "normalizedEnhancerCounts", label: "eNRSA normalized enhancer measurements" },
  { role: "designTable", label: "Sample design / experiment metadata" }, { role: "normalizationFactors", label: "eNRSA normalization factors" },
  { role: "enhancerResults", label: "eRNA_diff R-DESeq2 enhancer results" }, { role: "geneResults", label: "Gene-body differential results" },
  { role: "filteredBed", label: "eRNA_diff SAF-derived bidirectional BED" }, { role: "unknown", label: "Unrecognized / inspect manually" },
];
export const ROLE_LABELS = Object.fromEntries(roles.map(({ role, label }) => [role, label])) as Record<InputRole, string>;

function normalizedHeader(text: string) {
  return text.replace(/^\uFEFF/, "").split(/\r?\n/).find((line) => line.trim() && !line.trimStart().startsWith("#") && !/^\s*(track|browser)\s/i.test(line))?.trim() ?? "";
}
function columns(header: string) {
  const delimiter = header.includes("\t") ? "\t" : ",";
  return header.split(delimiter).map((value) => value.trim().replace(/^"|"$/g, "").toLowerCase());
}
const has = (all: string[], ...sets: string[][]) => sets.every((set) => set.some((column) => all.includes(column.toLowerCase())));

/** Plugins are ordered; the first structural match defines the schema. Filenames only refine strand/contrast roles. */
export const detectorPlugins: DetectorPlugin[] = [
  { id: "experiment-manifest", detect: ({ header }) => /"schema_version"\s*:\s*2/.test(header) && /"contrasts"\s*:/.test(header) && /"product"\s*:\s*"GEL Web"/.test(header) ? {role:"experimentMetadata",format:"GEL experiment manifest v2",evidence:"Versioned GEL experiment metadata; declarations require researcher review",confidence:0.99,inferred:false} : null },
  { id: "bigwig-signature", detect: ({ header }) => header.startsWith("__BIGWIG__") ? { role: "unknown", format: "BigWig", evidence: "Binary BigWig magic signature", confidence: 0.99, inferred: false } : null },
  { id: "bigbed-signature", detect: ({ header }) => header.startsWith("__BIGBED__") ? { role: "unknown", format: "BigBed (not yet processed)", evidence: "Binary BigBed magic signature; GEL does not read BigBed annotations yet", confidence: 0.99, inferred: false } : null },
  { id: "gtf-gff-schema", detect: ({ header }) => { const f = header.split("\t"); if (!(f.length >= 9 && /^\w+$/.test(f[1] ?? "") && /^\d+$/.test(f[3] ?? "") && /^\d+$/.test(f[4] ?? "") && ["gene", "transcript", "exon", "region"].includes((f[2] ?? "").toLowerCase()))) return null; const gff3 = (f[8] ?? "").includes("="); return { role: "annotation", format: gff3 ? "GFF3" : "GTF", evidence: "9-column feature record with genomic coordinates", confidence: 0.97, inferred: false }; } },
  { id: "gel-gene-tsv", detect: ({ header }) => { const c = columns(header); return has(c, ["gene_id"], ["symbol", "gene_name"], ["chrom", "chr"], ["start"], ["end"], ["strand"]) ? { role: "annotation", format: "GEL gene TSV (0-based unless declared otherwise)", evidence: "Gene ID, symbol, coordinates and strand columns", confidence: 0.99, inferred: false } : null; } },
  { id: "enrsa-gene-body", detect: ({ header }) => { const c = columns(header); return has(c, ["transcript"], ["gene"], ["log2foldchange", "lfc"], ["lfcse", "se"], ["padj", "fdr"]) ? { role: "gbChange", format: "eNRSA gene-body DE results", evidence: "Transcript/Gene plus effect, uncertainty and adjusted p-value columns", confidence: 0.99, inferred: false } : null; } },
  { id: "enrsa-enhancer-diff", detect: ({ header }) => { const c = columns(header); return has(c, ["enhancer_id"], ["chr", "chrom"], ["start"], ["end"], ["log2foldchange", "lfc"], ["padj", "fdr"]) ? { role: "enhancerChange", format: "eNRSA enhancer DE results", evidence: "Enhancer_ID, interval and differential statistics", confidence: 0.99, inferred: false } : null; } },
  { id: "r-deseq-enhancer", detect: ({ header }) => { const c = columns(header); return has(c, ["chr"], ["start"], ["end"], ["region_id", "geneid"], ["log2foldchange"], ["padj"]) ? { role: "enhancerResults", format: "R-DESeq2 enhancer table (SAF coordinates)", evidence: "Chr/Start/End/Region_ID with DESeq2 statistics", confidence: 0.98, inferred: false } : null; } },
  { id: "enrsa-normalized-gene", detect: ({ header }) => { const c = columns(header); return has(c, ["transcript"], ["gene"], ["chr", "chrom"], ["start"], ["end"], ["strand"]) && c.some((x) => /^(gbc|gbd|ppc|ppd)_/.test(x)) ? { role: "normalizedPpGb", format: "eNRSA normalized gene measurements", evidence: "Transcript/gene coordinates and ppc/ppd/gbc/gbd sample columns", confidence: 0.99, inferred: false } : null; } },
  { id: "normalization-factors", detect: ({ header }) => has(columns(header), ["sample"], ["nfactor"]) ? { role: "normalizationFactors", format: "eNRSA normalization factors", evidence: "sample and nfactor columns", confidence: 0.96, inferred: false } : null },
  { id: "sample-design", detect: ({ header }) => { const c = columns(header); return has(c, ["sample", "sample_id"], ["condition", "group", "treatment"]) ? { role: "designTable", format: "sample design table", evidence: "sample identifier and condition/group columns", confidence: 0.83, inferred: false } : null; } },
  { id: "saf-annotation", detect: ({ header }) => { const c = columns(header); return has(c, ["geneid"], ["chr"], ["start"], ["end"], ["strand"]) ? { role: "annotation", format: "featureCounts SAF (1-based inclusive)", evidence: "SAF annotation columns; source-specific conversion required", confidence: 0.98, inferred: false } : null; } },
  { id: "normalized-enhancers", detect: ({ header }) => { const c = columns(header); return has(c, ["enhancer_id", "region_id"], ["chr"], ["start"], ["end"]) ? { role: "normalizedEnhancerCounts", format: "eNRSA enhancer measurements", evidence: "Enhancer IDs and exact interval coordinates", confidence: 0.78, inferred: false } : null; } },
  { id: "gene-differential", detect: ({ header }) => { const c = columns(header); return has(c, ["gene", "gene_id", "geneid"], ["log2foldchange", "lfc"], ["padj", "fdr"]) ? { role: "geneResults", format: "gene differential results", evidence: "Gene identifier plus differential statistics", confidence: 0.9, inferred: false } : null; } },
  { id: "bedgraph", detect: ({ header }) => { const f = header.split("\t"); return f.length >= 4 && /^\d+$/.test(f[1] ?? "") && /^\d+$/.test(f[2] ?? "") && Number.isFinite(Number(f[3])) ? { role: "unknown", format: "bedGraph", evidence: "Chrom/start/end/numeric signal row", confidence: 0.95, inferred: false } : null; } },
  { id: "bed", detect: ({ header }) => { const f = header.split("\t"); return f.length >= 3 && /^\d+$/.test(f[1] ?? "") && /^\d+$/.test(f[2] ?? "") ? { role: "unknown", format: "BED", evidence: "Chrom/start/end interval row; coordinate convention is BED 0-based half-open", confidence: 0.87, inferred: false } : null; } },
];

async function boundedHeader(file: File, limit = 64 * 1024) {
  const prefix = await file.slice(0, 4).arrayBuffer(); const bytes = new Uint8Array(prefix);
  const magic = bytes.length === 4 ? new DataView(prefix).getUint32(0, true) : 0;
  if (magic === 0x888ffc26) return "__BIGWIG__";
  if (magic === 0x8789f2eb) return "__BIGBED__";
  let text: string;
  if (/\.gz$/i.test(file.name)) {
    if (typeof DecompressionStream === "undefined") throw new Error(`Cannot inspect ${file.name}: this browser does not support local gzip decompression.`);
    const stream = file.stream().pipeThrough(new DecompressionStream("gzip")); const reader = stream.getReader(); const decoder = new TextDecoder(); let output = "";
    while (output.length < limit) { const item = await reader.read(); if (item.done) break; output += decoder.decode(item.value, { stream: true }); if (output.includes("\n")) break; }
    await reader.cancel(); text = output;
  } else text = await file.slice(0, limit).text();
  return text.trimStart().startsWith("{") ? text.slice(0, limit) : normalizedHeader(text);
}

function filenameRole(match: DetectorMatch, path: string): { role: InputRole; inferred: boolean; evidence: string[] } {
  const lower = path.toLowerCase(); const evidence = [match.evidence]; let role = match.role; let inferred = match.inferred;
  if (match.format === "BigWig") {
    const plus = /(^|[._/-])(plus|pos|forward|fwd|sense)([._/-]|$)/i.test(path);
    const minus = /(^|[._/-])(minus|neg|reverse|rev|antisense)([._/-]|$)/i.test(path);
    const control = /(?:^|[._/-])(?:control|ctrl|vehicle|untreated|0(?:hr|h|min))(?:[._/-]|$)/i.test(path); const treatment = !control && /treat|dtag|agb|degrad|perturb|(?:^|[_ .-])\d+(?:\.\d+)?(?:hr|h|min)(?:[_ .-]|$)/i.test(path);
    if (plus !== minus && control !== treatment) { role = control ? (plus ? "controlPlus" : "controlMinus") : (plus ? "treatmentPlus" : "treatmentMinus"); evidence.push("Filename/path suggests strand and condition (inferred; confirm before analysis)"); return { role, inferred: true, evidence }; }
  }
  if (role === "unknown" && /bidirectional_enhancers\.bed$/i.test(lower)) { role = "filteredBed"; inferred = true; evidence.push("Known eRNA_diff SAF-derived BED filename; coordinate correction applies only to this role"); }
  if (role === "unknown" && (match.format === "BED" || match.format === "GTF/GFF")) role = "annotation";
  const basename = lower.split(/[\\/]/).at(-1) ?? lower;
  if (role === "gbChange" && /pp_change/i.test(basename)) { role = "ppChange"; inferred = true; evidence.push("Filename identifies this as the separate promoter-proximal table"); }
  if (role === "normalizedEnhancerCounts" && /enhancer_change|enhancer_results/i.test(basename)) role = "enhancerChange";
  if (role === "geneResults" && /gb_change|gene.?body/i.test(basename)) role = "gbChange";
  if (role === "geneResults" && /pp_change|promoter/i.test(basename)) role = "ppChange";
  return { role, inferred, evidence };
}

export async function inspectFile(file: File): Promise<ImportedFile> {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const header = await boundedHeader(file); const context = { file, relativePath: path, header };
  const match = detectorPlugins.map((plugin) => plugin.detect(context)).find((candidate) => candidate !== null);
  if (!match) return { id: `${path}:${file.size}:${file.lastModified}`, file, path, role: "unknown", suggestedRole: "unknown", format: "Unrecognized", evidence: ["No registered signature/schema matched within the bounded header."], confidence: 0, recognition: "unassigned" };
  const inferred = filenameRole(match, path);
  return { id: `${path}:${file.size}:${file.lastModified}`, file, path, role: inferred.role, suggestedRole: inferred.role, format: match.format, evidence: inferred.evidence, confidence: inferred.inferred ? 0.8 : match.confidence,
    recognition: inferred.inferred ? "inferred" : "structurally_verified" };
}

export async function inspectFiles(files: File[]) {
  if (files.length > 2000) throw new Error("Select at most 2,000 processed files per addition. Raw reads and alignment files are not analysis inputs.");
  const imported: ImportedFile[] = [];
  for (let start = 0; start < files.length; start += 8) imported.push(...await Promise.all(files.slice(start, start + 8).map((file) => inspectFile(file))));
  const byDigest = new Map<string, ImportedFile>();
  for (const item of imported) {
    // Hash small tables to identify exact duplicates; never read large tracks/matrices just for duplicate checking.
    if (item.file.size > 2 * 1024 * 1024 || !globalThis.crypto?.subtle) continue;
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await item.file.arrayBuffer());
    const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    item.sha256 = key;
    const first = byDigest.get(key);
    if (first) item.duplicateOf = first.id; else byDigest.set(key, item);
  }
  return imported;
}

export function readiness(files: ImportedFile[]) {
  const assigned = new Set(files.filter((file) => !file.duplicateOf).map((file) => file.role));
  const bigwigMissing = ["controlPlus", "controlMinus", "treatmentPlus", "treatmentMinus", "annotation"].filter((role) => !assigned.has(role as InputRole));
  const enrsaMissing = ["gbChange", "normalizedPpGb", "enhancerChange"].filter((role) => !assigned.has(role as InputRole));
  const rMissing = ["enhancerResults", "geneResults", "annotation"].filter((role) => !assigned.has(role as InputRole));
  return { bigwig: bigwigMissing.length === 0, bigwigMissing, enrsa: enrsaMissing.length === 0, enrsaMissing, rDeseq: rMissing.length === 0, rMissing,
    hasConflicts: files.some((file) => file.duplicateOf) || files.some((file) => file.role !== "unknown" && files.filter((other) => other.role === file.role && !other.duplicateOf).length > 1),
    available: [bigwigMissing.length === 0 && "BigWig-only descriptive", enrsaMissing.length === 0 && "eNRSA differential", rMissing.length === 0 && "R-DESeq2 differential"].filter(Boolean) as string[] };
}
/** Parse a small sample-sheet preview; source labels are reported as declared, never certified as biological replicates. */
export async function previewSampleMetadata(file: File): Promise<SampleMetadataPreview> {
  const text = await readLocalText(file, 10 * 1024 * 1024); const delimiter = text.split(/\r?\n/, 1)[0]?.includes("\t") ? "\t" : ",";
  const rows = parseDelimited(text, delimiter); if (!rows.length) throw new Error("Sample design file contains no data rows.");
  const columns = Object.keys(rows[0]); const byLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  const pick = (...names: string[]) => names.map((name) => byLower.get(name)).find(Boolean);
  const sampleKey = pick("sample", "sample_id", "sampleid", "library", "library_id");
  const conditionKey = pick("condition", "group", "treatment", "treatment_group");
  const timeKey = pick("time", "timepoint", "time_point"); const replicateKey = pick("replicate", "replicate_id", "bio_rep", "biological_replicate"); const batchKey = pick("batch", "processing_batch", "technical_batch");
  if (!sampleKey || !conditionKey) throw new Error("Sample sheet must include a sample identifier and condition/group/treatment column.");
  const unique = (key?: string) => key ? [...new Set(rows.map((row) => row[key]?.trim()).filter((value): value is string => Boolean(value)))].sort() : [];
  return { sampleCount: rows.length, sampleIds: unique(sampleKey), conditionLevels: unique(conditionKey), timePoints: unique(timeKey), replicateLabels: unique(replicateKey), batchLabels: unique(batchKey), missingSampleIds: rows.filter((row) => !row[sampleKey]?.trim()).length, columns };
}
