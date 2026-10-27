import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PARAMETERS, buildLinks, importEnrsaEnhancers, importEnrsaGenes, importRDeSeqEnhancers,
  importRFilteredBed, importGenes, toZeroBasedHalfOpen, type Differential, type Gene,
  linksToBedpe, linksToInteract, rowsToCsv,
} from "./analysis";
import { runBigWigAnalysis } from "./bigwig";

describe("coordinate conversions", () => {
  it("converts one-based inclusive starts exactly once, including chromosome starts", () => {
    expect(toZeroBasedHalfOpen(1, 1, "one_based_inclusive")).toEqual({ start: 0, end: 1 });
    expect(toZeroBasedHalfOpen(9, 12, "one_based_inclusive")).toEqual({ start: 8, end: 12 });
    expect(toZeroBasedHalfOpen(8, 12, "zero_based_half_open")).toEqual({ start: 8, end: 12 });
    expect(() => toZeroBasedHalfOpen(0, 1, "one_based_inclusive")).toThrow("Invalid converted interval");
  });

  it("imports the audited eRNA_diff SAF-derived outputs with a one-base start correction", () => {
    const r = importRDeSeqEnhancers("Chr,Start,End,Region_ID,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj,Comparison,Significant\nchr1,101,200,Peak_1,10,1.4,0.2,7,0.001,0.01,treated_vs_control,TRUE");
    expect(r[0]).toMatchObject({ start: 100, end: 200, sourceId: "Peak_1", source: "eRNA_diff R-DESeq2" });
    const bed = importRFilteredBed("chr1\t101\t200\tPeak_1\t4");
    expect(bed[0]).toMatchObject({ start: 100, end: 200, log2fc: null });
    const preserved = importRDeSeqEnhancers("Chr,Start,End,Region_ID,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj\nchr1,101,200,Peak_1,10,1.4,0.2,7,0.001,0.01", "zero_based_half_open");
    expect(preserved[0]).toMatchObject({ start: 101, end: 200 });
  });

  it("parses eNRSA real header semantics and joins by Transcript plus Gene", () => {
    const changes = "Transcript\tGene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\nTX1\tGENE1\t100\t1.2\t0.2\t6\t0.001\t0.01\nTXMISS\tGENEX\t2\t0\t1\t0\t1\t1";
    const coords = "Transcript\tGene\tchr\tstart\tend\tstrand\tppc_ctrl_A\tgbc_ctrl_A\nTX1\tGENE1\tchr1\t101\t500\t-\t10\t20";
    const imported = importEnrsaGenes(changes, coords);
    expect(imported.genes[0]).toMatchObject({ geneId: "GENE1", start: 100, end: 500, strand: "-", transcript: "TX1" });
    expect(imported.stats[0]).toMatchObject({ featureId: "GENE1", log2fc: 1.2, se: 0.2, padj: 0.01 });
    expect(imported.unmatchedDifferentialRows).toEqual(["TXMISS|GENEX"]);
    const enh = importEnrsaEnhancers("Enhancer_ID\tchr\tstart\tend\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\nE1\tchr1\t10\t20\t10\t-1\t0.1\t-10\t0.001\t0.01");
    expect(enh[0]).toMatchObject({ start: 10, end: 20, log2fc: -1, sourceId: "E1" });
  });
});

describe("candidate pairs and tiers", () => {
  const gene: Gene = { geneId: "G1", symbol: "GENE1", chrom: "chr1", start: 1000, end: 2000, strand: "-" };
  const stat = (featureId: string, start: number, end: number, lfc: number, padj: number | null): Differential => ({ featureId, chrom: "chr1", start, end, log2fc: lfc, se: 0.1, pvalue: 0.01, padj, baseMean: 100, source: "fixture", sourceId: featureId, sourceCoordinates: "fixture" });
  it("retains multiple enhancer relationships and calls promoter/gene-body overlaps", () => {
    const enhancers = [stat("e-near", 2050, 2100, 1.1, 0.01), stat("e-body", 1950, 1995, 1.0, 0.01), stat("e-far", 300000, 300100, 1.0, 0.01)];
    const links = buildLinks([gene], [stat("G1", gene.start, gene.end, 1, 0.01)], enhancers, { ...DEFAULT_PARAMETERS, maxDistanceBp: 100000 },
      { contrast: "x vs c", compatibility: { status: "Compatibility unverified", checks: [] }, source: "differential" });
    expect(links).toHaveLength(2); expect(links.find((row) => row.enhancer_id === "e-body")?.overlaps_gene_body).toBe(true);
    expect(links.find((row) => row.enhancer_id === "e-body")?.overlaps_promoter).toBe(true);
    expect(links.every((row) => row.evidence_tier === "high")).toBe(true);
  });

  it("does not invent direction when a locus is below its effect threshold", () => {
    const links = buildLinks([gene], [stat("G1", gene.start, gene.end, 0.1, 0.01)], [stat("e", 700, 750, 2, 0.01)], DEFAULT_PARAMETERS,
      { contrast: "x", compatibility: { status: "Compatibility unverified", checks: [] }, source: "differential" });
    expect(links[0].direction_agreement).toBeNull(); expect(links[0].evidence_tier).toBe("insufficient");
  });

  it("validates GTF and BED gene intervals", () => {
    expect(importGenes('chr2\ts\tgene\t1\t1\t.\t+\t.\tgene_id "G"; gene_name "SYM";', "gtf")[0]).toMatchObject({ start: 0, end: 1, geneId: "G", symbol: "SYM" });
    expect(importGenes("chr2\t10\t20\tG\t0\t-", "bed")[0]).toMatchObject({ start: 10, end: 20, strand: "-" });
    expect(importGenes("GeneID\tChr\tStart\tEnd\tStrand\nG1\tchr2\t1\t1\t-", "saf")[0]).toMatchObject({ start: 0, end: 1, geneId: "G1", strand: "-" });
    expect(importGenes("chr2\ts\tgene\t1\t3\t.\t-\t.\tID=gene:GFF1;Name=SYM", "gff")[0]).toMatchObject({ start: 0, end: 3, geneId: "GFF1", symbol: "SYM" });
    expect(() => importGenes("gene_id\tsymbol\tchrom\tstart\tend\tstrand\nG\tA\tchr1\t1\t2\t+\nG\tB\tchr1\t3\t4\t+", "tsv")).toThrow("Duplicate gene identifier");
  });

  it("keeps input ordering, signed strand position, and browser output coordinates deterministic", () => {
    const e1 = stat("e1", 500, 600, 1, 0.01), e2 = stat("e2", 700, 800, 1, 0.01);
    const args = { contrast: "x", compatibility: { status: "Compatibility unverified" as const, checks: [] }, source: "differential" as const };
    const forward = buildLinks([gene], [stat("G1", gene.start, gene.end, 1, 0.01)], [e1, e2], DEFAULT_PARAMETERS, args);
    const reversed = buildLinks([gene], [stat("G1", gene.start, gene.end, 1, 0.01)], [e2, e1], DEFAULT_PARAMETERS, args);
    expect(forward.map((row) => row.link_id)).toEqual(reversed.map((row) => row.link_id));
    expect(forward[0].transcription_oriented_offset_bp).toBeGreaterThan(0);
    expect(linksToBedpe(forward).split("\n")).toHaveLength(2);
    expect(linksToInteract(forward).split("\n")[1].split("\t")).toHaveLength(18);
    expect(rowsToCsv([{ value: "a,b", other: "quote\"" }])).toBe('value,other\n"a,b","quote"""');
  });
});

describe("indexed browser BigWig analysis parity", () => {
  it("reads the real synthetic BigWigs locally and recovers the Python reference intervals and classes", async () => {
    const root = fileURLToPath(new URL("../../../../examples/demo/", import.meta.url));
    const file = async (name: string) => new File([await readFile(`${root}data/${name}`)], name);
    const annotation = new File([await readFile(`${root}genes.tsv`, "utf8")], "genes.tsv");
    const parameters = { ...DEFAULT_PARAMETERS, maxDistanceBp: 5000, minMeanSignal: 0.08, mergeGapBp: 0, peakBinBp: 100 };
    const result = await runBigWigAnalysis({ files: { controlPlus: await file("ctrl_A_plus.bw"), controlMinus: await file("ctrl_A_minus.bw"),
      treatmentPlus: await file("treat_A_plus.bw"), treatmentMinus: await file("treat_A_minus.bw") }, annotationFile: annotation, annotationFormat: "tsv",
      annotationCoordinates: "zero_based_half_open", genomeAssembly: "synthetic-demo-v1", normalization: "synthetic shared scale",
      contrast: "perturbation vs control · 1h", region: { chrom: "chrDemo", start: 0, end: 10000 }, parameters }, () => undefined);
    const expected = ["1900-2100:divergent_outward", "3900-4100:unidirectional_or_readthrough", "6000-7500:bidirectional_mixed_geometry"];
    expect(result.enhancers.map((e) => `${e.start}-${e.end}:${result.links.find((p) => p.enhancer_id === e.featureId)?.morphology}`).sort()).toEqual(expected.sort());
    expect(result.links).toHaveLength(6);
    expect(result.links.find((p) => p.enhancer_start === 3900 && p.gene_id === "GENE_CONC")?.evidence_tier).toBe("discordant");
    expect(result.links.find((p) => p.enhancer_start === 1900 && p.gene_id === "GENE_CONC")?.evidence_tier).toBe("moderate");
    expect(result.validation.pValuesProduced).toBe(false);
  });
});
