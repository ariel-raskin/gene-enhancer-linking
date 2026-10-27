import { describe, expect, it } from "vitest";
import { inspectFile, inspectFiles, previewSampleMetadata, readiness } from "./smart-importer";

function file(name: string, text: string, relativePath = name) {
  const value = new File([text], name, { lastModified: 12345 });
  Object.defineProperty(value, "webkitRelativePath", { value: relativePath });
  return value;
}

describe("local smart file importer", () => {
  it("detects BigWig by its binary signature and infers strand/condition only from path clues", async () => {
    const bytes = new Uint8Array([0x26, 0xfc, 0x8f, 0x88]);
    const bw = new File([bytes], "dTAG_1h_plus.bw");
    const match = await inspectFile(bw);
    expect(match.format).toBe("BigWig"); expect(match.role).toBe("treatmentPlus"); expect(match.recognition).toBe("inferred");
    const unclear = await inspectFile(new File([bytes], "signal.bw"));
    expect(unclear.role).toBe("unknown"); expect(unclear.recognition).toBe("structurally_verified");
  });

  it("recognizes audited eNRSA tables by their columns, independent of their filenames", async () => {
    const gb = await inspectFile(file("table.txt", "Transcript\tGene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\nTX\tG\t1\t1\t.1\t2\t.1\t.2"));
    const genes = await inspectFile(file("coords.tsv", "Transcript\tGene\tchr\tstart\tend\tstrand\tgbc_ctrl_A\nTX\tG\tchr1\t1\t2\t+\t1"));
    const enhancer = await inspectFile(file("diff.tsv", "Enhancer_ID\tchr\tstart\tend\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\nE\tchr1\t2\t3\t1\t1\t.1\t2\t.1\t.2"));
    expect([gb.role, genes.role, enhancer.role]).toEqual(["gbChange", "normalizedPpGb", "enhancerChange"]);
  });

  it("recognizes sample designs and the separate R-DESeq2 enhancer schema", async () => {
    const design = await inspectFile(file("samples.csv", "Sample,Treatment,Timepoint,Replicate\nS1,vehicle,0h,A"));
    const rDiff = await inspectFile(file("contrast.csv", "Chr,Start,End,Region_ID,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj\nchr1,1,2,R1,5,1,.2,5,.01,.02"));
    expect(design.role).toBe("designTable"); expect(rDiff.role).toBe("enhancerResults"); expect(rDiff.format).toContain("SAF");
  });

  it("summarizes declared sample, condition, time, replicate, and batch fields without interpreting independence", async () => {
    const preview = await previewSampleMetadata(file("samples.csv", "Sample,Treatment,Timepoint,Replicate,Batch\nS1,vehicle,0h,A,run1\nS2,dTAG,1h,B,run2"));
    expect(preview).toMatchObject({ sampleCount: 2, sampleIds: ["S1", "S2"], conditionLevels: ["dTAG", "vehicle"], timePoints: ["0h", "1h"], replicateLabels: ["A", "B"], batchLabels: ["run1", "run2"] });
  });

  it("uses relative directory context to recognize the promoter result as separate", async () => {
    const promoter = await inspectFile(file("pp_change.txt", "Transcript\tGene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\nTX\tG\t1\t1\t.1\t2\t.1\t.2", "contrast/known_gene/pp_change.txt"));
    expect(promoter.role).toBe("ppChange"); expect(promoter.recognition).toBe("inferred");
  });

  it("preserves directory paths and detects SAF separately from BED", async () => {
    const saf = await inspectFile(file("genes.txt", "GeneID\tChr\tStart\tEnd\tStrand\nG1\tchr1\t1\t20\t+", "analysis/annotation/genes.txt"));
    const bed = await inspectFile(file("peaks.bed", "chr1\t0\t20\tpeak1\t0\t+", "analysis/eRNA/peaks.bed"));
    expect(saf.path).toBe("analysis/annotation/genes.txt"); expect(saf.format).toContain("SAF"); expect(saf.role).toBe("annotation");
    expect(bed.format).toBe("BED"); expect(bed.role).toBe("annotation");
  });

  it("detects multiple contrast tables without treating them as independent or silently merging them", async () => {
    const files = await inspectFiles([
      file("gb_change.txt", "Transcript\tGene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\nTX\tG\t1\t1\t.1\t2\t.1\t.2", "1hr/known_gene/gb_change.txt"),
      file("gb_change.txt", "Transcript\tGene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\nTX\tG\t1\t1\t.1\t2\t.1\t.2", "2hr/known_gene/gb_change.txt"),
    ]);
    expect(files).toHaveLength(2); expect(files[0].path).not.toBe(files[1].path);
    expect(readiness(files).hasConflicts).toBe(true);
  });

  it("keeps ambiguous names unassigned and tracks readiness until required files arrive", async () => {
    const unknown = await inspectFile(file("results.csv", "a,b,c\n1,2,3"));
    expect(unknown.role).toBe("unknown");
    expect(readiness([unknown]).enrsaMissing).toEqual(["gbChange", "normalizedPpGb", "enhancerChange"]);
  });

  it("recognizes a selected folder input by its browser relative path", async () => {
    const dirFile = file("Enhancer_change.txt", "Enhancer_ID\tchr\tstart\tend\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\nE\tchr1\t2\t3\t1\t1\t.1\t2\t.1\t.2", "runA/eRNA/Enhancer_change.txt");
    const inspected = await inspectFiles([dirFile]);
    expect(inspected[0].path).toBe("runA/eRNA/Enhancer_change.txt"); expect(inspected[0].role).toBe("enhancerChange");
  });

  it("flags exact duplicates among small tables without reading large files for hashing", async () => {
    const text = "Transcript\tGene\tbaseMean\tlog2FoldChange\tlfcSE\tstat\tpvalue\tpadj\nTX\tG\t1\t1\t.1\t2\t.1\t.2";
    const duplicates = await inspectFiles([file("gb_change.txt", text), file("copy.txt", text, "copy.txt")]);
    expect(duplicates.filter((item) => item.duplicateOf)).toHaveLength(1);
  });
});
