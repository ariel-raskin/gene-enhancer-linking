import type { ResultSink, ResultPartition } from "./result-store";
import {
  buildLinks, iterateLinks, compareChromosomes, importEnrsaEnhancers, importEnrsaGenes, inspectEnrsaOptionalInputs,
  importGeneDifferential, importGenes, importRDeSeqEnhancers, importRFilteredBed, type Parameters, type Gene, type Differential,
} from "./analysis";
import { runChunkedBigWigAnalysis, ChunkCache } from "./chunked-bigwig";
import { runBigWigAnalysis } from "./bigwig";
import { AnalysisCache } from "./analysis-cache";
import { readLocalText } from "./read-local-text";

export type FeatureScope = {chrom:string;start:number;end:number}|{chromosomes?:string[];excludedContigs:string[]};
export type AnalysisRequest = { scope?: FeatureScope } & (
  | { id: string; kind: "enrsa"; files: { gbChange: File; normalizedPpGb: File; enhancerChange: File; ppChange?: File; normalizedEnhancerCounts?: File; designTable?: File; normalizationFactors?: File };
    metadata: { assembly: string; contrast: string; source: "enrsa" | "erna_r"; model: string; coordinateConfirmation?: boolean };
    parameters: Parameters }
  | { id: string; kind: "erna-r"; files: { enhancerResults: File; geneResults: File; geneAnnotation: File; filteredBed?: File };
    metadata: { assembly: string; contrast: string; model: string; geneFormat: "tsv" | "gtf" | "gff" | "bed" | "saf"; geneCoordinates: "zero_based_half_open" | "one_based_inclusive"; enhancerCoordinates: "zero_based_half_open" | "one_based_inclusive" };
    parameters: Parameters }
  | { id: string; kind: "bigwig"; request: Parameters extends never ? never : import("./bigwig").BigWigRequest });


function scopeFeatures(genes:Gene[],stats:Differential[],enhancers:Differential[],scope:AnalysisRequest["scope"],distance:number){
  if(!scope)return {genes,stats,enhancers};
  if(!("chrom" in scope)){
    const allowed=(chrom:string)=>!scope.excludedContigs.includes(chrom)&&(!scope.chromosomes||scope.chromosomes.includes(chrom));
    const selected=genes.filter(g=>allowed(g.chrom)),ids=new Set(selected.map(g=>g.geneId));
    return {genes:selected,stats:stats.filter(s=>ids.has(s.featureId)),enhancers:enhancers.filter(e=>allowed(e.chrom))};
  }
  const selected=genes.filter(g=>g.chrom===scope.chrom&&g.end>scope.start-distance&&g.start<scope.end+distance);
  const ids=new Set(selected.map(g=>g.geneId));
  return {genes:selected,stats:stats.filter(s=>ids.has(s.featureId)),enhancers:enhancers.filter(e=>e.chrom===scope.chrom&&e.end>scope.start&&e.start<scope.end)};
}

async function persistFeatures(sink:ResultSink,features:ResultPartition,params:Parameters,metadata:{contrast:string;compatibility:import("./analysis").Compatibility;source:"differential"}){
 for(const chrom of [...new Set([...features.genes.map(g=>g.chrom),...features.enhancers.map(e=>e.chrom)])].sort()){
  const genes=features.genes.filter(g=>g.chrom===chrom),stats=features.geneStats.filter(s=>s.chrom===chrom),enhancers=features.enhancers.filter(e=>e.chrom===chrom);
  await sink.partition(chrom,{genes,geneStats:stats,enhancers,secondaryGeneStats:features.secondaryGeneStats?.filter(s=>s.chrom===chrom)},iterateLinks(genes,stats,enhancers,params,{...metadata,maxLinks:Number.MAX_SAFE_INTEGER}));
 }
}

export async function executeAnalysis(req: AnalysisRequest, report: (message: string) => void = () => {}, cache?: AnalysisCache, signal?: AbortSignal, chunkCache?: ChunkCache, sink?:ResultSink) {
  const read = (file: File) => cache ? cache.readText(file) : readLocalText(file);
  const started = performance.now();
    let result;
    if (req.kind === "enrsa") {
      report("Reading differential results and gene-coordinate table locally.");
      if (Object.values(req.files).some((file) => file && file.size > 300 * 1024 * 1024)) throw new Error("An eNRSA file exceeds the 300 MB browser import limit. Filter to the required files/contrast before import.");
      const [gbText, geneText, enhancerText] = await Promise.all([read(req.files.gbChange), read(req.files.normalizedPpGb), read(req.files.enhancerChange)]);
      const imported = importEnrsaGenes(gbText, geneText); report(`Mapped ${imported.genes.length.toLocaleString()} exact transcript/gene rows; importing enhancer statistics.`);
      const enhancers = importEnrsaEnhancers(enhancerText);
      const chromosomeComparison = compareChromosomes(imported.genes, enhancers);
      const optionalInput = await inspectEnrsaOptionalInputs({ geneMeasurements: geneText,
        enhancerMeasurements: req.files.normalizedEnhancerCounts ? await read(req.files.normalizedEnhancerCounts) : undefined,
        designTable: req.files.designTable ? await read(req.files.designTable) : undefined,
        normalizationFactors: req.files.normalizationFactors ? await read(req.files.normalizationFactors) : undefined }, enhancers);
      const promoter = req.files.ppChange ? importEnrsaGenes(await read(req.files.ppChange), geneText).stats : [];
      const compatibility = { status: "Compatibility unverified" as const, checks: [
        { name: "Genome assembly", status: req.metadata.assembly ? "declared" : "unverified", detail: `User declared ${req.metadata.assembly || "no assembly"}; table itself does not encode assembly.` },
        { name: "Gene feature identity", status: "pass", detail: "Exact Transcript + Gene key joined differential rows to normalized_pp_gb coordinates." },
        { name: "Enhancer coordinates", status: "unverified", detail: "Assumes source eNRSA BED-derived intervals are 0-based half-open; verify source catalog provenance." },
        { name: "Contrast and model provenance", status: "unverified", detail: req.metadata.model.trim() ? `User declared contrast ${req.metadata.contrast}; verify against source analysis_summary/design table.` : "Model and contrast provenance missing." },
      ] };
      const scoped=scopeFeatures(imported.genes,imported.stats,enhancers,req.scope,req.parameters.maxDistanceBp);
      const links = sink ? [] : buildLinks(scoped.genes, scoped.stats, scoped.enhancers, req.parameters, { contrast: req.metadata.contrast, compatibility, source: "differential" });
      if(sink)await persistFeatures(sink,{genes:scoped.genes,geneStats:scoped.stats,enhancers:scoped.enhancers,secondaryGeneStats:promoter},req.parameters,{contrast:req.metadata.contrast,compatibility,source:"differential"});
      result = { ...imported, genes:scoped.genes, enhancers:scoped.enhancers, geneStats: scoped.stats, secondaryGeneStats: promoter, links, validation: { mode: "eNRSA differential tables", genomeAssembly: req.metadata.assembly,
        contrast: req.metadata.contrast, statisticalModel: req.metadata.model, geneRows: imported.genes.length, enhancerRows: enhancers.length,
        unmatchedGeneDifferentialRows: imported.unmatchedDifferentialRows.length, pairCount: links.length, pValuesProduced: true,
        optionalInputProvenance: optionalInput, promoterResponseRows: promoter.length, chromosomeComparison,
        coordinateRule: imported.coordinateRule, compatibility, warnings: [...(chromosomeComparison.geneChromosomesWithoutEnhancers.length || chromosomeComparison.enhancerChromosomesWithoutGenes.length ? ["Some contig names have no exact counterpart in the other feature table; chromosome aliases are not rewritten. Review chromosomeComparison in validation_report.json."] : []), "Transcript-specific representative features are retained; normalized transcript values were not summed.",
          "These feature-level DE p-values are not enhancer–gene relationship p-values.", "Across multiple contrasts sharing controls, do not treat rows as independent observations."],
        elapsedMs: Math.round(performance.now() - started) } };
    } else if (req.kind === "erna-r") {
      report("Reading eRNA_diff R-DESeq2 results and supplied gene annotation.");
      if ([req.files.enhancerResults, req.files.geneResults, req.files.geneAnnotation, req.files.filteredBed].some((file) => file && file.size > 300 * 1024 * 1024)) throw new Error("An R-DESeq2 input exceeds the 300 MB browser import limit. Filter to one contrast before import.");
      const enhancerText = await read(req.files.enhancerResults); const geneText = await read(req.files.geneResults); const annotationText = await read(req.files.geneAnnotation);
      const genes = importGenes(annotationText, req.metadata.geneFormat, req.metadata.geneCoordinates);
      const differential = importGeneDifferential(geneText, genes, "gene-body differential results");
      const enhancers = importRDeSeqEnhancers(enhancerText, req.metadata.enhancerCoordinates);
      const filteredEnhancers = req.files.filteredBed ? importRFilteredBed(await read(req.files.filteredBed)) : [];
      const chromosomeComparison = compareChromosomes(genes, [...enhancers, ...filteredEnhancers]);
      const seen = new Set(enhancers.map((item) => item.featureId)); const additions = filteredEnhancers.filter((item) => !seen.has(item.featureId));
      const compatibility = { status: "Compatibility unverified" as const, checks: [
        { name: "Genome assembly", status: req.metadata.assembly ? "declared" : "unverified", detail: `User declared ${req.metadata.assembly || "no assembly"}; table itself does not encode assembly.` },
        { name: "Enhancer coordinates", status: "user-confirmed", detail: `${req.metadata.enhancerCoordinates} converted to internal 0-based half-open coordinates.` },
        { name: "Gene feature identity", status: "pass", detail: `${differential.stats.length} gene results matched exact IDs in the supplied annotation.` },
        { name: "Contrast and model provenance", status: "unverified", detail: req.metadata.model.trim() ? `User declared ${req.metadata.contrast}; verify against source model metadata.` : "Model and contrast provenance missing." },
      ] };
      const scoped=scopeFeatures(genes,differential.stats,[...enhancers,...additions],req.scope,req.parameters.maxDistanceBp);
      const links = sink ? [] : buildLinks(scoped.genes, scoped.stats, scoped.enhancers, req.parameters, { contrast: req.metadata.contrast, compatibility, source: "differential" });
      if(sink)await persistFeatures(sink,{genes:scoped.genes,geneStats:scoped.stats,enhancers:scoped.enhancers},req.parameters,{contrast:req.metadata.contrast,compatibility,source:"differential"});
      result = { genes:scoped.genes, enhancers: scoped.enhancers, geneStats: scoped.stats, links, validation: { mode: "eRNA_diff R-DESeq2", genomeAssembly: req.metadata.assembly,
        contrast: req.metadata.contrast, statisticalModel: req.metadata.model, geneRows: genes.length, geneRowsWithEffects: differential.stats.length,
        unmatchedGeneDifferentialRows: differential.unmatchedRows.length, enhancerDifferentialRows: enhancers.length, correctedSAFBedRows: additions.length,
        pairCount: links.length, pValuesProduced: true, chromosomeComparison, coordinateRule: `${req.metadata.enhancerCoordinates} enhancer results converted to internal 0-based half-open; filtered BED is SAF-derived and corrected the same way.`,
        compatibility, warnings: [...(chromosomeComparison.geneChromosomesWithoutEnhancers.length || chromosomeComparison.enhancerChromosomesWithoutGenes.length ? ["Some contig names have no exact counterpart in the other feature table; chromosome aliases are not rewritten. Review chromosomeComparison in validation_report.json."] : []), "The R-DESeq2 enhancer catalog is distinct from the eNRSA enhancer catalog.", "An enhancer result p-value only applies to that exact SAF feature.",
          "No eRNA-diff p-values are inferred for additional filtered BED features without a matched differential result."], elapsedMs: Math.round(performance.now() - started) } };
    } else {
      report("Querying local indexed BigWig blocks in the worker.");
      result = req.request.genomicScope ? await runChunkedBigWigAnalysis(req.request, report, signal, chunkCache, sink) : await runBigWigAnalysis(req.request, (message) => report(message), cache);
      result.validation.elapsedMs = Math.round(performance.now() - started);
    }
  if(sink){
    // Legacy interval runner remains bounded; its completed data are persisted once.
    if(req.kind==="bigwig"&&!req.request.genomicScope)await sink.partition("legacy-region",{genes:result.genes as Gene[],geneStats:result.geneStats??[],enhancers:result.enhancers as Differential[]},result.links);
    return {genes:[],enhancers:[],geneStats:[],secondaryGeneStats:[],links:[],validation:{...result.validation,...(req.kind!=="bigwig"?{geneRows:result.genes.length,enhancerRows:result.enhancers.length,regionalScope:req.scope}:{}),persisted:true}};
  }
  if (req.scope && req.kind !== "bigwig") {
    return {...result,validation:{...result.validation,geneRows:result.genes.length,enhancerRows:result.enhancers.length,pairCount:result.links.length,regionalScope:req.scope}};
  }
  return result;
}
