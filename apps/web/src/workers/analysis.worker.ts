/// <reference lib="webworker" />
import {
  buildLinks, compareChromosomes, importEnrsaEnhancers, importEnrsaGenes, inspectEnrsaOptionalInputs,
  importGeneDifferential, importGenes, importRDeSeqEnhancers, importRFilteredBed, type Parameters,
} from "@/lib/analysis";
import { runBigWigAnalysis } from "@/lib/bigwig";

type Request =
  | { id: string; kind: "enrsa"; files: { gbChange: File; normalizedPpGb: File; enhancerChange: File; ppChange?: File; normalizedEnhancerCounts?: File; designTable?: File; normalizationFactors?: File };
    metadata: { assembly: string; contrast: string; source: "enrsa" | "erna_r"; model: string; coordinateConfirmation: boolean };
    parameters: Parameters }
  | { id: string; kind: "erna-r"; files: { enhancerResults: File; geneResults: File; geneAnnotation: File; filteredBed?: File };
    metadata: { assembly: string; contrast: string; model: string; geneFormat: "tsv" | "gtf" | "bed"; geneCoordinates: "zero_based_half_open" | "one_based_inclusive" };
    parameters: Parameters }
  | { id: string; kind: "bigwig"; request: Parameters extends never ? never : import("@/lib/bigwig").BigWigRequest };

const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const report = (id: string, message: string) => scope.postMessage({ id, type: "progress", message });

scope.onmessage = async (event: MessageEvent<Request>) => {
  const req = event.data; const started = performance.now();
  try {
    let result;
    if (req.kind === "enrsa") {
      report(req.id, "Reading differential results and gene-coordinate table locally.");
      if (Object.values(req.files).some((file) => file && file.size > 300 * 1024 * 1024)) throw new Error("An eNRSA file exceeds the 300 MB browser import limit. Filter to the required files/contrast before import.");
      const [gbText, geneText, enhancerText] = await Promise.all([req.files.gbChange.text(), req.files.normalizedPpGb.text(), req.files.enhancerChange.text()]);
      const imported = importEnrsaGenes(gbText, geneText); report(req.id, `Mapped ${imported.genes.length.toLocaleString()} exact transcript/gene rows; importing enhancer statistics.`);
      const enhancers = importEnrsaEnhancers(enhancerText);
      const chromosomeComparison = compareChromosomes(imported.genes, enhancers);
      const optionalInput = await inspectEnrsaOptionalInputs({ geneMeasurements: geneText,
        enhancerMeasurements: req.files.normalizedEnhancerCounts ? await req.files.normalizedEnhancerCounts.text() : undefined,
        designTable: req.files.designTable ? await req.files.designTable.text() : undefined,
        normalizationFactors: req.files.normalizationFactors ? await req.files.normalizationFactors.text() : undefined }, enhancers);
      const promoter = req.files.ppChange ? importEnrsaGenes(await req.files.ppChange.text(), geneText).stats : [];
      const compatibility = { status: "Compatibility unverified" as const, checks: [
        { name: "Genome assembly", status: req.metadata.assembly ? "declared" : "unverified", detail: `User declared ${req.metadata.assembly || "no assembly"}; table itself does not encode assembly.` },
        { name: "Gene feature identity", status: "pass", detail: "Exact Transcript + Gene key joined differential rows to normalized_pp_gb coordinates." },
        { name: "Enhancer coordinates", status: "unverified", detail: "Assumes source eNRSA BED-derived intervals are 0-based half-open; verify source catalog provenance." },
        { name: "Contrast and model provenance", status: "unverified", detail: req.metadata.model.trim() ? `User declared contrast ${req.metadata.contrast}; verify against source analysis_summary/design table.` : "Model and contrast provenance missing." },
      ] };
      const links = buildLinks(imported.genes, imported.stats, enhancers, req.parameters, { contrast: req.metadata.contrast, compatibility, source: "differential" });
      result = { ...imported, enhancers, geneStats: imported.stats, secondaryGeneStats: promoter, links, validation: { mode: "eNRSA differential tables", genomeAssembly: req.metadata.assembly,
        contrast: req.metadata.contrast, statisticalModel: req.metadata.model, geneRows: imported.genes.length, enhancerRows: enhancers.length,
        unmatchedGeneDifferentialRows: imported.unmatchedDifferentialRows.length, pairCount: links.length, pValuesProduced: true,
        optionalInputProvenance: optionalInput, promoterResponseRows: promoter.length, chromosomeComparison,
        coordinateRule: imported.coordinateRule, compatibility, warnings: [...(chromosomeComparison.geneChromosomesWithoutEnhancers.length || chromosomeComparison.enhancerChromosomesWithoutGenes.length ? ["Some contig names have no exact counterpart in the other feature table; chromosome aliases are not rewritten. Review chromosomeComparison in validation_report.json."] : []), "Transcript-specific representative features are retained; normalized transcript values were not summed.",
          "These feature-level DE p-values are not enhancer–gene relationship p-values.", "Across multiple contrasts sharing controls, do not treat rows as independent observations."],
        elapsedMs: Math.round(performance.now() - started) } };
    } else if (req.kind === "erna-r") {
      report(req.id, "Reading eRNA_diff R-DESeq2 results and supplied gene annotation.");
      if ([req.files.enhancerResults, req.files.geneResults, req.files.geneAnnotation, req.files.filteredBed].some((file) => file && file.size > 300 * 1024 * 1024)) throw new Error("An R-DESeq2 input exceeds the 300 MB browser import limit. Filter to one contrast before import.");
      const enhancerText = await req.files.enhancerResults.text(); const geneText = await req.files.geneResults.text(); const annotationText = await req.files.geneAnnotation.text();
      const genes = importGenes(annotationText, req.metadata.geneFormat, req.metadata.geneCoordinates);
      const differential = importGeneDifferential(geneText, genes, "gene-body differential results");
      const enhancers = importRDeSeqEnhancers(enhancerText);
      const filteredEnhancers = req.files.filteredBed ? importRFilteredBed(await req.files.filteredBed.text()) : [];
      const chromosomeComparison = compareChromosomes(genes, [...enhancers, ...filteredEnhancers]);
      const seen = new Set(enhancers.map((item) => item.featureId)); const additions = filteredEnhancers.filter((item) => !seen.has(item.featureId));
      const compatibility = { status: "Compatibility unverified" as const, checks: [
        { name: "Genome assembly", status: req.metadata.assembly ? "declared" : "unverified", detail: `User declared ${req.metadata.assembly || "no assembly"}; table itself does not encode assembly.` },
        { name: "Enhancer coordinates", status: "pass", detail: "SAF 1-based inclusive Start/End converted to BED [Start-1, End)." },
        { name: "Gene feature identity", status: "pass", detail: `${differential.stats.length} gene results matched exact IDs in the supplied annotation.` },
        { name: "Contrast and model provenance", status: "unverified", detail: req.metadata.model.trim() ? `User declared ${req.metadata.contrast}; verify against source model metadata.` : "Model and contrast provenance missing." },
      ] };
      const links = buildLinks(genes, differential.stats, [...enhancers, ...additions], req.parameters, { contrast: req.metadata.contrast, compatibility, source: "differential" });
      result = { genes, enhancers: [...enhancers, ...additions], geneStats: differential.stats, links, validation: { mode: "eRNA_diff R-DESeq2", genomeAssembly: req.metadata.assembly,
        contrast: req.metadata.contrast, statisticalModel: req.metadata.model, geneRows: genes.length, geneRowsWithEffects: differential.stats.length,
        unmatchedGeneDifferentialRows: differential.unmatchedRows.length, enhancerDifferentialRows: enhancers.length, correctedSAFBedRows: additions.length,
        pairCount: links.length, pValuesProduced: true, chromosomeComparison, coordinateRule: "SAF 1-based inclusive Start/End converted to BED [Start-1, End); filtered BED is SAF-derived and corrected the same way.",
        compatibility, warnings: [...(chromosomeComparison.geneChromosomesWithoutEnhancers.length || chromosomeComparison.enhancerChromosomesWithoutGenes.length ? ["Some contig names have no exact counterpart in the other feature table; chromosome aliases are not rewritten. Review chromosomeComparison in validation_report.json."] : []), "The R-DESeq2 enhancer catalog is distinct from the eNRSA enhancer catalog.", "An enhancer result p-value only applies to that exact SAF feature.",
          "No eRNA-diff p-values are inferred for additional filtered BED features without a matched differential result."], elapsedMs: Math.round(performance.now() - started) } };
    } else {
      report(req.id, "Querying local indexed BigWig blocks in the worker.");
      result = await runBigWigAnalysis(req.request, (message) => report(req.id, message));
      result.validation.elapsedMs = Math.round(performance.now() - started);
    }
    scope.postMessage({ id: req.id, type: "complete", result });
  } catch (error) { scope.postMessage({ id: req.id, type: "error", error: error instanceof Error ? error.message : String(error) }); }
};

export {};
