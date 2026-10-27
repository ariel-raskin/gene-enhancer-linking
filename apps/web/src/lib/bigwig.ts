import { AnalysisCache } from "./analysis-cache";
import { readLocalText } from "./read-local-text";
import { BigWig } from "@gmod/bbi";
import { BlobFile } from "generic-filehandle2";
import { buildLinks, importGenes, type Differential, type Parameters } from "./analysis";
import type { GenomicScope, ExecutionLimits } from "./genomic-scope";

export type BigWigRequest = {
  files: { controlPlus: File; controlMinus: File; treatmentPlus: File; treatmentMinus: File };
  annotationFile: File; annotationFormat: "gtf" | "gff" | "tsv" | "bed" | "saf"; annotationCoordinates: "zero_based_half_open" | "one_based_inclusive";
  genomeAssembly: string; normalization: string; contrast: string;
  region: { chrom: string; start: number; end: number }; parameters: Parameters;
  genomicScope?: GenomicScope; execution?: ExecutionLimits;
};

type Wig = InstanceType<typeof BigWig>;
type SignalBlock = { start: number; end: number; score: number };
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_QUERY_BYTES = 64 * 1024 * 1024;
const MAX_ANNOTATION_BYTES = 150 * 1024 * 1024;

export function integrate(blocks: SignalBlock[], start: number, end: number) {
  let sum = 0, low = 0, high = blocks.length;
  while (low < high) { const mid = (low + high) >>> 1; if (blocks[mid].end <= start) low = mid + 1; else high = mid; }
  for (let index = low; index < blocks.length && blocks[index].start < end; index++) {
    const block = blocks[index]; const overlap = Math.max(0, Math.min(end, block.end) - Math.max(start, block.start)); if (overlap) sum += overlap * Math.abs(block.score);
  }
  return sum;
}

function binned(blocks: SignalBlock[], start: number, end: number, bin: number) {
  const count = Math.ceil((end - start) / bin); const sums = new Float64Array(count);
  for (const block of blocks) {
    const first = Math.max(0, Math.floor((block.start - start) / bin)); const last = Math.min(count - 1, Math.floor((Math.max(block.start, block.end - 1) - start) / bin));
    for (let index = first; index <= last; index++) { const s = start + index * bin, e = Math.min(end, s + bin); sums[index] += Math.max(0, Math.min(e, block.end) - Math.max(s, block.start)) * Math.abs(block.score); }
  }
  return sums;
}

function mergeActive(start: number, end: number, values: Float64Array, bin: number, threshold: number, gap: number) {
  const active: { start: number; end: number; score: number }[] = [];
  for (let i = 0; i < values.length; i++) if (values[i] / Math.min(bin, end - (start + i * bin)) >= threshold) active.push({ start: start + i * bin, end: Math.min(end, start + (i + 1) * bin), score: values[i] });
  const merged: { start: number; end: number; score: number }[] = [];
  for (const item of active) { const last = merged.at(-1); if (last && item.start <= last.end + gap) { last.end = item.end; last.score += item.score; } else merged.push({ ...item }); }
  return merged;
}

export function morphology(plus: SignalBlock[], minus: SignalBlock[], start: number, end: number, flank = 250) {
  const center = Math.floor((start + end) / 2), left = Math.max(start, center - flank), right = Math.min(end, center + flank);
  const ml = integrate(minus, left, center), pl = integrate(plus, left, center), mr = integrate(minus, center, right), pr = integrate(plus, center, right);
  return classifyGeometry(ml, pl, mr, pr);
}

export function classifyGeometry(ml: number, pl: number, mr: number, pr: number) {
  const outward = ml + pr, inward = pl + mr, total = outward + inward;
  if (total < 4) return "low_signal_ambiguous";
  if (outward / total >= 0.65) { const balance = Math.min(ml, pr) / Math.max(ml, pr, 1e-12); return balance < 0.15 ? "unidirectional_outward_candidate" : balance >= 0.85 ? "divergent_outward" : "asymmetric_divergent"; }
  if (inward / total >= 0.65) { const balance = Math.min(pl, mr) / Math.max(pl, mr, 1e-12); return balance < 0.15 ? "unidirectional_or_readthrough" : "convergent_inward"; }
  if (Math.max(pl + pr, ml + mr) / total >= 0.85) return "unidirectional_or_readthrough";
  return Math.min(outward, inward) / total >= 0.15 ? "bidirectional_mixed_geometry" : "asymmetric_uncertain";
}

export async function open(file: File, signal?: AbortSignal) {
  if (file.size === 0 || file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: file is empty or exceeds the 1 GB browser input limit.`);
  const bw = new BigWig({ filehandle: new BlobFile(file) });
  const header = await bw.getHeader({signal});
  if (header.fileType !== "bigwig") throw new Error(`${file.name} is not a BigWig file.`);
  return { bw, header };
}

export async function runBigWigAnalysis(request: BigWigRequest, progress: (message: string) => void, cache?: AnalysisCache) {
  const { files, region, parameters } = request;
  if (!request.genomeAssembly.trim() || !request.normalization.trim() || !request.contrast.trim()) throw new Error("Genome assembly, normalization description, and explicit contrast are required.");
  if (!region.chrom || region.start < 0 || region.end <= region.start) throw new Error("Enter a valid 0-based half-open scan interval.");
  if (region.end - region.start > parameters.maxGenomeBases) throw new Error(`This browser build limits BigWig analysis to ${parameters.maxGenomeBases.toLocaleString()} bases per run.`);
  if (request.annotationFile.size > MAX_ANNOTATION_BYTES) throw new Error("Gene annotation exceeds the 150 MB browser limit. Use a chromosome/region-filtered GTF or TSV.");
  const annotationText = await (cache ? cache.readText(request.annotationFile) : readLocalText(request.annotationFile));
  const genes = importGenes(annotationText, request.annotationFormat, request.annotationCoordinates);
  const selectedGenes = genes.filter((g) => g.chrom === region.chrom && g.end > region.start - parameters.maxDistanceBp && g.start < region.end + parameters.maxDistanceBp);
  if (!selectedGenes.length) throw new Error("No genes from the annotation overlap the scan interval or its candidate distance flank.");
  progress(`Opening four local indexed BigWigs; ${selectedGenes.length.toLocaleString()} nearby genes selected.`);
  const entries = await Promise.all([open(files.controlPlus), open(files.controlMinus), open(files.treatmentPlus), open(files.treatmentMinus)]);
  const [cp, cm, tp, tm] = entries.map((entry) => entry.bw);
  const reference = entries[0].header.refsByName[region.chrom];
    if (reference === undefined) throw new Error(`Chromosome ${region.chrom} is absent from the selected BigWig files.`);
    const refInfo = entries[0].header.refsByNumber[reference];
    for (const { header } of entries.slice(1)) {
      const id = header.refsByName[region.chrom]; if (id === undefined || header.refsByNumber[id].length !== refInfo.length) throw new Error("The four BigWigs do not agree on chromosome names/lengths.");
    }
    if (region.end > refInfo.length) throw new Error(`Scan interval end ${region.end} exceeds ${region.chrom} length ${refInfo.length}.`);
    const rangeBytes = await Promise.all(entries.map(({ bw }) => bw.getRegionByteSize(region.chrom, region.start, region.end)));
    if (rangeBytes.reduce((a, b) => a + b, 0) > MAX_QUERY_BYTES) throw new Error("This indexed query exceeds the 64 MB compressed-block budget. Narrow the genomic interval.");
    progress(`Reading indexed signal blocks (${rangeBytes.reduce((a, b) => a + b, 0).toLocaleString()} bytes estimated).`);
    const read = async (bw: Wig, file: File) => {
      const key=`${region.chrom}:${region.start}-${region.end}`; const previous=cache?.getBlocks(file,key);
      if(previous) return previous;
      const blocks=(await bw.getFeatures(region.chrom, region.start, region.end)).map((f) => ({ start:f.start,end:f.end,score:Number(f.score) })).filter(f=>Number.isFinite(f.score));
      cache?.setBlocks(file,key,blocks); return blocks;
    };
    const cpBlocks = await read(cp, files.controlPlus); progress("Read control plus strand."); const cmBlocks = await read(cm, files.controlMinus); progress("Read control minus strand.");
    const tpBlocks = await read(tp, files.treatmentPlus); progress("Read treatment plus strand."); const tmBlocks = await read(tm, files.treatmentMinus); progress("Read treatment minus strand.");
    const bin = Math.max(10, Math.floor(parameters.peakBinBp));
    const bins = [binned(cpBlocks, region.start, region.end, bin), binned(cmBlocks, region.start, region.end, bin), binned(tpBlocks, region.start, region.end, bin), binned(tmBlocks, region.start, region.end, bin)];
    const meanBins = new Float64Array(bins[0].length);
    for (let i = 0; i < meanBins.length; i++) meanBins[i] = (bins[0][i] + bins[1][i] + bins[2][i] + bins[3][i]) / (4 * Math.min(bin, region.end - region.start - i * bin));
    const peaks = mergeActive(region.start, region.end, meanBins.map((v, i) => v * Math.min(bin, region.end - region.start - i * bin)), bin, parameters.minMeanSignal, parameters.mergeGapBp);
    const classifiedPeaks = peaks.map((peak) => ({ ...peak, morphology: morphology(cpBlocks, cmBlocks, peak.start, peak.end) }))
      .filter((peak) => parameters.morphologyClasses.length === 0 || parameters.morphologyClasses.includes(peak.morphology));
    const enhancers: Differential[] = classifiedPeaks.map((peak, index) => {
      const control = integrate(cpBlocks, peak.start, peak.end) + integrate(cmBlocks, peak.start, peak.end);
      const treatment = integrate(tpBlocks, peak.start, peak.end) + integrate(tmBlocks, peak.start, peak.end);
      const lfc = Math.log2((treatment + parameters.pseudocount) / (control + parameters.pseudocount));
      return { featureId: `${region.chrom}:${peak.start}-${peak.end}:bw${index + 1}`, chrom: region.chrom, start: peak.start, end: peak.end,
        log2fc: lfc, se: null, pvalue: null, padj: null, baseMean: (control + treatment) / 2, source: "local BigWig signal discovery", sourceId: `bw${index + 1}`,
        sourceCoordinates: "BigWig query returns 0-based half-open intervals", morphology: peak.morphology };
    });
    const morphologyById = new Map(enhancers.map((e) => [e.featureId, e.morphology ?? "low_signal_ambiguous"]));
    const geneStats: Differential[] = selectedGenes.map((gene) => {
      const c = integrate(cpBlocks, gene.start, gene.end) + integrate(cmBlocks, gene.start, gene.end);
      const t = integrate(tpBlocks, gene.start, gene.end) + integrate(tmBlocks, gene.start, gene.end);
      return { featureId: gene.geneId, chrom: gene.chrom, start: gene.start, end: gene.end, strand: gene.strand,
        log2fc: Math.log2((t + parameters.pseudocount) / (c + parameters.pseudocount)), se: null, pvalue: null, padj: null, baseMean: (c + t) / 2,
        source: "local BigWig gene-body integral", sourceId: gene.geneId, sourceCoordinates: "Gene annotation interval; descriptive integrated normalized signal" };
    });
    const links = buildLinks(selectedGenes, geneStats, enhancers, parameters, { contrast: request.contrast, compatibility: { status: "Compatibility unverified", checks: [
      { name: "Genome assembly", status: "unverified", detail: `${request.genomeAssembly}; selected by user, not embedded in BigWig header` },
      { name: "Normalization", status: "unverified", detail: request.normalization },
      { name: "Inferential statistics", status: "unavailable", detail: "Averaged tracks do not provide valid differential p-values." },
    ] }, morphologyById, source: "bigwig" });
    return { genes: selectedGenes, enhancers, geneStats, links, validation: { mode: "BigWig-only descriptive", genomeAssembly: request.genomeAssembly,
      region, inputFileBytes: Object.values(files).reduce((sum, file) => sum + file.size, 0) + request.annotationFile.size, indexedBytesEstimated: rangeBytes.reduce((a, b) => a + b, 0),
      featureBlockCounts: { controlPlus: cpBlocks.length, controlMinus: cmBlocks.length, treatmentPlus: tpBlocks.length, treatmentMinus: tmBlocks.length },
      maxIntervalBases: parameters.maxGenomeBases, normalization: request.normalization, chromosomeDictionaryAgreement: true, chromosomeSizes:{[region.chrom]:refInfo.length}, pValuesProduced: false,
      warnings: ["Single contrast descriptive track ratios; no inferential p-values are calculated.", "Signal-derived peaks are candidates, not confirmed enhancers."], elapsedMs: 0 } };
}
