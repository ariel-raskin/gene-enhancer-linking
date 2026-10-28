export type Gene = {
  geneId: string; symbol: string; chrom: string; start: number; end: number; strand: "+" | "-";
  transcript?: string; sourceStart?: number; sourceEnd?: number; ambiguity?: string;
};

export type Differential = {
  featureId: string; chrom: string; start: number; end: number; strand?: "+" | "-";
  log2fc: number | null; se: number | null; pvalue: number | null; padj: number | null;
  baseMean: number | null; source: string; sourceId: string; sourceCoordinates: string; morphology?: string;
};

export type Link = {
  link_id: string; gene_id: string; gene_symbol: string; gene_chrom: string; gene_start: number; gene_end: number;
  gene_strand: string; tss: number; enhancer_id: string; chrom: string; enhancer_start: number; enhancer_end: number;
  distance_bp: number; midpoint_to_tss_bp: number; transcription_oriented_offset_bp: number; gene_log2fc: number | null; enhancer_log2fc: number | null;
  gene_se: number | null; enhancer_se: number | null; gene_pvalue: number | null; enhancer_pvalue: number | null;
  gene_padj: number | null; enhancer_padj: number | null; gene_baseMean: number | null; enhancer_baseMean: number | null;
  direction_agreement: boolean | null; magnitude_gap_log2fc: number | null; morphology: string;
  overlaps_promoter: boolean; overlaps_gene_body: boolean; evidence_tier: string; evidence_source: string;
  contrast: string; compatibility_status: string; classification_reason: string;
};

export type Parameters = {
  maxDistanceBp: number; minGeneAbsLfc: number; minEnhancerAbsLfc: number; maxPadj: number;
  peakBinBp: number; minMeanSignal: number; mergeGapBp: number; maxMagnitudeGapLfc: number;
  requireDirection: boolean; compareMagnitude: boolean;
  morphologyClasses: string[]; excludePromoters: boolean; excludeGeneBody: boolean; promoterUpstreamBp: number;
  promoterDownstreamBp: number; pseudocount: number; maxGenomeBases: number;
};

export const DEFAULT_PARAMETERS: Parameters = {
  maxDistanceBp: 100_000, minGeneAbsLfc: 0.5, minEnhancerAbsLfc: 0.5, maxPadj: 0.05,
  peakBinBp: 100, minMeanSignal: 0.08, mergeGapBp: 100, maxMagnitudeGapLfc: 2,
  requireDirection: true, compareMagnitude: true,
  morphologyClasses: ["divergent_outward", "asymmetric_divergent", "unidirectional_outward_candidate", "unidirectional_or_readthrough", "bidirectional_mixed_geometry", "low_signal_ambiguous", "asymmetric_uncertain"],
  excludePromoters: false, excludeGeneBody: false, promoterUpstreamBp: 1000, promoterDownstreamBp: 100,
  pseudocount: 1, maxGenomeBases: 50_000_000,
};

export type Compatibility = { status: "Verified compatible" | "Compatibility unverified" | "Incompatible"; checks: { name: string; status: string; detail: string }[] };

export function toZeroBasedHalfOpen(start: number, end: number, convention: "zero_based_half_open" | "one_based_inclusive") {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) throw new Error(`Invalid interval ${start}-${end}`);
  const converted = convention === "one_based_inclusive" ? { start: start - 1, end } : { start, end };
  if (converted.start < 0 || converted.end <= converted.start) throw new Error(`Invalid converted interval ${converted.start}-${converted.end}`);
  return converted;
}

export function parseDelimited(text: string, delimiter = "\t"): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length) return [];
  const parseLine = (line: string) => {
    const out: string[] = []; let field = ""; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') { if (quoted && line[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
      else if (char === delimiter && !quoted) { out.push(field); field = ""; }
      else field += char;
    }
    out.push(field); return out;
  };
  const headers = parseLine(lines[0]).map((value) => value.trim());
  return lines.slice(1).map((line) => {
    const values = parseLine(line); const row: Record<string, string> = {};
    headers.forEach((header, index) => { row[header] = (values[index] ?? "").trim(); }); return row;
  });
}

const first = (row: Record<string, string>, ...keys: string[]) => {
  for (const key of keys) if (row[key] !== undefined) return row[key];
  return "";
};
const num = (raw: string): number | null => raw.trim() === "" || raw === "NA" || raw === "NaN" ? null : Number.isFinite(Number(raw)) ? Number(raw) : null;
const need = (value: string, field: string) => { if (!value) throw new Error(`Missing required ${field}`); return value; };

export function importEnrsaGenes(changeText: string, coordinateText: string) {
  const changes = parseDelimited(changeText); const coords = parseDelimited(coordinateText);
  if (!changes.length || !coords.length) throw new Error("Gene body results and normalized_pp_gb coordinate table must contain data rows.");
  const coordByKey = new Map<string, Record<string, string>>();
  for (const row of coords) {
    const key = `${first(row, "Transcript")}\t${first(row, "Gene")}`;
    if (key === "\t") continue;
    if (coordByKey.has(key)) throw new Error(`Duplicate eNRSA transcript/gene coordinate key: ${key}`);
    coordByKey.set(key, row);
  }
  const genes: Gene[] = []; const stats: Differential[] = []; const missing = [] as string[];
  for (const change of changes) {
    const transcript = need(first(change, "Transcript"), "Transcript column in gb_change.txt");
    const geneId = need(first(change, "Gene"), "Gene column in gb_change.txt");
    const coord = coordByKey.get(`${transcript}\t${geneId}`);
    if (!coord) { missing.push(`${transcript}|${geneId}`); continue; }
    const startRaw = Number(need(first(coord, "start", "Start"), "start coordinate in normalized_pp_gb.txt"));
    const endRaw = Number(need(first(coord, "end", "End"), "end coordinate in normalized_pp_gb.txt"));
    const { start, end } = toZeroBasedHalfOpen(startRaw, endRaw, "one_based_inclusive");
    const chrom = need(first(coord, "chr", "Chr", "chrom", "Chrom"), "chromosome in normalized_pp_gb.txt");
    const strand = first(coord, "strand", "Strand");
    if (strand !== "+" && strand !== "-") throw new Error(`Invalid gene strand for ${geneId}/${transcript}: ${strand}`);
    genes.push({ geneId, symbol: geneId, chrom, start, end, strand, transcript, sourceStart: startRaw, sourceEnd: endRaw });
    stats.push({ featureId: geneId, chrom, start, end, strand, log2fc: num(first(change, "log2FoldChange", "LFC")),
      se: num(first(change, "lfcSE", "SE")), pvalue: num(first(change, "pvalue", "pval")), padj: num(first(change, "padj", "FDR")),
      baseMean: num(first(change, "baseMean", "base_mean")), source: "eNRSA gene-body DESeq2", sourceId: `${transcript}|${geneId}`,
      sourceCoordinates: `GTF 1-based inclusive ${startRaw}-${endRaw}; converted to BED ${start}-${end}` });
  }
  if (!genes.length) throw new Error("No gb_change rows matched normalized_pp_gb by exact Transcript and Gene identifiers.");
  const geneIds = genes.map((gene) => gene.geneId);
  if (new Set(geneIds).size !== geneIds.length) throw new Error("Multiple transcript-level differential rows map to the same Gene identifier. Resolve the source's representative transcript before importing; GEL will not sum or silently collapse them.");
  return { genes, stats, unmatchedDifferentialRows: missing, coordinateRule: "eNRSA retained GTF 1-based inclusive coordinates; start converted to start-1, end retained." };
}

export function importEnrsaEnhancers(text: string) {
  const rows = parseDelimited(text);
  if (!rows.length) throw new Error("Enhancer differential table contains no data rows.");
  const enhancers: Differential[] = [];
  for (const row of rows) {
    const chrom = need(first(row, "chr", "Chr", "chrom"), "enhancer chromosome");
    const start = Number(need(first(row, "start", "Start"), "enhancer start")); const end = Number(need(first(row, "end", "End"), "enhancer end"));
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) throw new Error(`Invalid eNRSA enhancer interval ${chrom}:${start}-${end}`);
    const id = need(first(row, "Enhancer_ID", "Region_ID", "Geneid"), "enhancer identifier");
    enhancers.push({ featureId: `${chrom}:${start}-${end}:${id}`, chrom, start, end, log2fc: num(first(row, "log2FoldChange", "LFC")),
      se: num(first(row, "lfcSE", "SE")), pvalue: num(first(row, "pvalue", "pval")), padj: num(first(row, "padj", "FDR")),
      baseMean: num(first(row, "baseMean", "base_mean")), source: "eNRSA enhancer DESeq2", sourceId: id,
      sourceCoordinates: `eNRSA BED-derived interval (0-based half-open by source definition): ${start}-${end}` });
  }
  const keys = enhancers.map((item) => item.featureId);
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate eNRSA enhancer ID plus interval rows detected.");
  return enhancers;
}

export function inspectEnrsaOptionalInputs(input: { geneMeasurements: string; enhancerMeasurements?: string; designTable?: string; normalizationFactors?: string }, enhancers: Differential[]) {
  const geneRows = parseDelimited(input.geneMeasurements);
  if (!geneRows.length) throw new Error("normalized_pp_gb.txt contains no data rows.");
  const geneHeaders = Object.keys(geneRows[0]);
  const sampleColumns = geneHeaders.filter((header) => /^(ppc|ppd|gbc|gbd)_/.test(header));
  if (!sampleColumns.some((header) => header.startsWith("gbc_") || header.startsWith("gbd_"))) throw new Error("normalized_pp_gb.txt has no gbc_/gbd_ gene-body sample columns.");
  const result: Record<string, unknown> = { geneMeasurementRows: geneRows.length, geneMeasurementColumns: geneHeaders, geneBodySampleColumns: sampleColumns.filter((header) => /^gb[cd]_/.test(header)) };
  if (input.enhancerMeasurements) {
    const rows = parseDelimited(input.enhancerMeasurements); const known = new Set(enhancers.map((e) => `${e.sourceId}\t${e.chrom}\t${e.start}\t${e.end}`)); let matched = 0, unmatched = 0;
    for (const row of rows) {
      const key = `${first(row, "Enhancer_ID", "Region_ID", "Geneid")}\t${first(row, "chr", "Chr")}\t${first(row, "start", "Start")}\t${first(row, "end", "End")}`;
      if (known.has(key)) matched++; else unmatched++;
    }
    result.enhancerMeasurementRows = rows.length; result.enhancerMeasurementColumns = Object.keys(rows[0]); result.exactEnhancerMeasurementMatches = matched; result.unmatchedEnhancerMeasurementRows = unmatched;
  }
  const measurementSamples = [...new Set(sampleColumns.map((header) => header.replace(/^(ppc|ppd|gbc|gbd)_/, "")))];
  result.measurementSamples = measurementSamples;
  if (input.designTable) {
    const rows = parseDelimited(input.designTable); if (!rows.length) throw new Error("design table contains no data rows.");
    const headers = Object.keys(rows[0]); const sampleKey = headers.find((header) => ["sample", "sample_id", "Sample"].includes(header));
    const conditionKey = headers.find((header) => ["condition", "group", "Condition"].includes(header));
    if (!sampleKey || !conditionKey) throw new Error("design table must include explicit sample and condition/group columns.");
    const designSamples = rows.map((row) => row[sampleKey]); const designSet = new Set(designSamples);
    result.designSampleCount = rows.length; result.designColumns = headers; result.designSamples = designSamples;
    result.measurementSamplesMissingFromDesign = measurementSamples.filter((sample) => !designSet.has(sample));
    result.designSamplesWithoutGeneMeasurements = designSamples.filter((sample) => !measurementSamples.includes(sample));
  }
  if (input.normalizationFactors) {
    const rows = parseDelimited(input.normalizationFactors); if (!rows.length || !("sample" in rows[0]) || !("nfactor" in rows[0])) throw new Error("eNRSA nf.txt must contain sample and nfactor columns.");
    result.normalizationFactorRows = rows.length; result.normalizationSamples = rows.map((row) => row.sample);
  }
  return result;
}

export function importRDeSeqEnhancers(text: string, coordinateConvention: "zero_based_half_open" | "one_based_inclusive" = "one_based_inclusive") {
  const rows = parseDelimited(text, ",");
  if (!rows.length) throw new Error("R-DESeq2 enhancer results contain no data rows.");
  return rows.map((row) => {
    const chrom = need(first(row, "Chr"), "Chr"); const rawStart = Number(need(first(row, "Start"), "Start")); const rawEnd = Number(need(first(row, "End"), "End"));
    const { start, end } = toZeroBasedHalfOpen(rawStart, rawEnd, coordinateConvention);
    const id = need(first(row, "Region_ID", "Geneid"), "Region_ID");
    return { featureId: `${chrom}:${start}-${end}:${id}`, chrom, start, end, log2fc: num(first(row, "log2FoldChange")),
      se: num(first(row, "lfcSE")), pvalue: num(first(row, "pvalue")), padj: num(first(row, "padj")), baseMean: num(first(row, "baseMean")),
      source: "eRNA_diff R-DESeq2", sourceId: id, sourceCoordinates: `${coordinateConvention} ${rawStart}-${rawEnd}; represented as BED ${start}-${end}` } satisfies Differential;
  });
}

export function importRFilteredBed(text: string) {
  return text.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line, index) => {
    const fields = line.split("\t"); if (fields.length < 4) throw new Error(`eRNA_diff bidirectional BED row ${index + 1} needs Chr,Start,End,Geneid.`);
    const rawStart = Number(fields[1]), rawEnd = Number(fields[2]);
    // The audit verified this particular BED-shaped file copies SAF coordinates without converting the start.
    const { start, end } = toZeroBasedHalfOpen(rawStart, rawEnd, "one_based_inclusive");
    return { featureId: `${fields[0]}:${start}-${end}:${fields[3]}`, chrom: fields[0], start, end, log2fc: null, se: null,
      pvalue: null, padj: null, baseMean: null, source: "eRNA_diff bidirectional_enhancers.bed (SAF-derived; corrected)", sourceId: fields[3],
      sourceCoordinates: `SAF values copied into BED-shaped file; converted ${rawStart}-${rawEnd} to ${start}-${end}` } satisfies Differential;
  });
}

export function importGeneDifferential(text: string, genes: Gene[], source = "gene-body differential results") {
  const delimiter = text.split(/\r?\n/, 1)[0]?.includes("\t") ? "\t" : ",";
  const rows = parseDelimited(text, delimiter); if (!rows.length) throw new Error("Gene differential table contains no rows.");
  const geneById = new Map(genes.map((gene) => [gene.geneId, gene])); const stats: Differential[] = []; const missing: string[] = [];
  for (const row of rows) {
    const id = first(row, "Gene", "gene_id", "geneId", "Geneid"); const gene = geneById.get(id);
    if (!gene) { missing.push(id || "(missing Gene identifier)"); continue; }
    stats.push({ featureId: gene.geneId, chrom: gene.chrom, start: gene.start, end: gene.end, strand: gene.strand,
      log2fc: num(first(row, "log2FoldChange", "LFC")), se: num(first(row, "lfcSE", "SE")), pvalue: num(first(row, "pvalue", "pval")),
      padj: num(first(row, "padj", "FDR")), baseMean: num(first(row, "baseMean", "base_mean")), source, sourceId: id,
      sourceCoordinates: "Coordinates provided by separately uploaded gene annotation" });
  }
  return { stats, unmatchedRows: missing };
}

export function importGenes(text: string, format: "tsv" | "gtf" | "gff" | "bed" | "saf", coordinateConvention: "zero_based_half_open" | "one_based_inclusive" = "zero_based_half_open"): Gene[] {
  if (format === "gtf" || format === "gff") {
    const genes: Gene[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue; const f = line.split("\t"); if (f.length < 9 || f[2] !== "gene") continue;
      const attrs = format === "gtf"
        ? Object.fromEntries(Array.from(f[8].matchAll(/([\w.]+)\s+"([^"]*)"/g), (m) => [m[1], m[2]]))
        : Object.fromEntries(f[8].split(";").map((entry) => entry.split("=")).filter((parts) => parts.length >= 2).map(([key, ...value]) => [key, decodeURIComponent(value.join("="))]));
      const id = attrs.gene_id ?? attrs.gene_name ?? attrs.ID?.replace(/^gene:/, ""); if (!id) continue;
      const startRaw = Number(f[3]), endRaw = Number(f[4]); const interval = toZeroBasedHalfOpen(startRaw, endRaw, "one_based_inclusive");
      genes.push({ geneId: id, symbol: attrs.gene_name ?? attrs.Name ?? id, chrom: f[0], start: interval.start, end: interval.end, strand: f[6] as "+" | "-", sourceStart: startRaw, sourceEnd: endRaw });
    }
    return assertUniqueGenes(genes);
  }
  if (format === "bed") return assertUniqueGenes(text.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
    const f = line.split("\t"); const start = Number(f[1]), end = Number(f[2]); return { geneId: f[3] || `${f[0]}:${start}-${end}`, symbol: f[3] || "", chrom: f[0], start, end, strand: (f[5] || "+") as "+" | "-" };
  }));
  if (format === "saf") {
    const rows = parseDelimited(text); if (!rows.length) throw new Error("SAF annotation contains no rows.");
    return assertUniqueGenes(rows.map((row) => {
      const rawStart = Number(need(first(row, "Start"), "SAF Start")); const rawEnd = Number(need(first(row, "End"), "SAF End"));
      const { start, end } = toZeroBasedHalfOpen(rawStart, rawEnd, "one_based_inclusive"); const strand = first(row, "Strand");
      if (strand !== "+" && strand !== "-") throw new Error(`SAF Strand must be + or - for ${row.GeneID}`);
      return { geneId: need(first(row, "GeneID"), "SAF GeneID"), symbol: first(row, "GeneID"), chrom: need(first(row, "Chr"), "SAF Chr"), start, end, strand, sourceStart: rawStart, sourceEnd: rawEnd };
    }));
  }
  const rows = parseDelimited(text); if (!rows.length) throw new Error("Gene annotation TSV contains no rows.");
  return assertUniqueGenes(rows.map((row) => {
    const rawStart = Number(need(first(row, "start", "Start"), "gene start")); const rawEnd = Number(need(first(row, "end", "End"), "gene end"));
    const { start, end } = toZeroBasedHalfOpen(rawStart, rawEnd, coordinateConvention); const strand = first(row, "strand", "Strand");
    if (strand !== "+" && strand !== "-") throw new Error(`Gene annotation strand must be + or - for ${row.gene_id ?? row.Gene}`);
    return { geneId: need(first(row, "gene_id", "Gene", "gene", "geneId"), "gene_id"), symbol: first(row, "symbol", "gene_name", "Gene", "gene_id"),
      chrom: need(first(row, "chrom", "chr", "Chr"), "chrom"), start, end, strand, sourceStart: rawStart, sourceEnd: rawEnd };
  }));
}

function assertUniqueGenes(genes: Gene[]) {
  const seen = new Set<string>();
  for (const gene of genes) { if (!Number.isInteger(gene.start) || !Number.isInteger(gene.end) || gene.start < 0 || gene.end <= gene.start) throw new Error(`Invalid interval for ${gene.geneId}: ${gene.chrom}:${gene.start}-${gene.end}`); if (seen.has(gene.geneId)) throw new Error(`Duplicate gene identifier ${gene.geneId}; provide one explicit representative feature per gene.`); seen.add(gene.geneId); }
  return genes;
}

export function tss(gene: Gene) { return gene.strand === "+" ? gene.start : gene.end - 1; }
export function intervalDistance(start: number, end: number, point: number) { return point < start ? start - point : point >= end ? point - end + 1 : 0; }
export function compareChromosomes(genes: Gene[], enhancers: Differential[]) {
  const geneNames = new Set(genes.map((gene) => gene.chrom)); const enhancerNames = new Set(enhancers.map((enhancer) => enhancer.chrom));
  return { shared: [...geneNames].filter((name) => enhancerNames.has(name)).sort(), geneChromosomesWithoutEnhancers: [...geneNames].filter((name) => !enhancerNames.has(name)).sort(), enhancerChromosomesWithoutGenes: [...enhancerNames].filter((name) => !geneNames.has(name)).sort(),
    policy: "Exact chromosome names only; GEL does not silently rewrite aliases." };
}
export function promoterOverlap(enhancer: Differential, gene: Gene, params: Parameters) {
  const point = tss(gene); const left = gene.strand === "+" ? point - params.promoterUpstreamBp : point - params.promoterDownstreamBp;
  const right = gene.strand === "+" ? point + params.promoterDownstreamBp + 1 : point + params.promoterUpstreamBp + 1;
  return enhancer.start < right && left < enhancer.end;
}

export function* iterateLinks(genes: Gene[], geneStats: Differential[], enhancers: Differential[], params: Parameters, metadata: { contrast: string; compatibility: Compatibility; morphologyById?: Map<string, string>; source: "differential" | "bigwig"; maxLinks?: number }) {
  const geneStat = new Map(geneStats.map((stat) => [stat.featureId, stat]));
  let count = 0;
  const byChrom = new Map<string, Differential[]>();
  for (const enhancer of enhancers) { const list = byChrom.get(enhancer.chrom) ?? []; list.push(enhancer); byChrom.set(enhancer.chrom, list); }
  for (const list of byChrom.values()) list.sort((a, b) => a.start - b.start || a.end - b.end || a.featureId.localeCompare(b.featureId));
  const maxLength = new Map([...byChrom].map(([chrom, list]) => [chrom, list.reduce((largest, item) => Math.max(largest, item.end - item.start), 1)]));
  for (const gene of [...genes].sort((a,b)=>a.chrom.localeCompare(b.chrom)||a.start-b.start||a.end-b.end||a.geneId.localeCompare(b.geneId))) {
    const tssPos = tss(gene); const stat = geneStat.get(gene.geneId); const list = byChrom.get(gene.chrom) ?? [];
    const leftBound = tssPos - params.maxDistanceBp - (maxLength.get(gene.chrom) ?? 1);
    const rightBound = tssPos + params.maxDistanceBp;
    let low = 0, high = list.length;
    while (low < high) { const mid = (low + high) >>> 1; if (list[mid].start < leftBound) low = mid + 1; else high = mid; }
    for (let index = low; index < list.length && list[index].start <= rightBound; index++) {
      const enhancer = list[index];
      const distance = intervalDistance(enhancer.start, enhancer.end, tssPos); if (distance > params.maxDistanceBp) continue;
      const isPromoter = promoterOverlap(enhancer, gene, params); const isBody = enhancer.start < gene.end && gene.start < enhancer.end;
      if (params.excludePromoters && isPromoter || params.excludeGeneBody && isBody) continue;
      const eLfc = enhancer.log2fc, gLfc = stat?.log2fc ?? null;
      const informative = eLfc !== null && gLfc !== null && Math.abs(eLfc) >= params.minEnhancerAbsLfc && Math.abs(gLfc) >= params.minGeneAbsLfc;
      const same = informative ? Math.sign(eLfc!) === Math.sign(gLfc!) : null;
      const significant = stat?.padj !== null && stat?.padj !== undefined && enhancer.padj !== null && enhancer.padj !== undefined
        && stat.padj <= params.maxPadj && enhancer.padj <= params.maxPadj;
      let tier = "insufficient", reason = "one or both response measurements are unavailable or below the effect threshold";
      if (informative && same === false && params.requireDirection) { tier = "discordant"; reason = "both effects pass thresholds but directions differ; not evidence of nonfunctionality"; }
      else if (informative && (same === true || !params.requireDirection)) {
        const gap = Math.abs(Math.abs(eLfc!) - Math.abs(gLfc!));
        tier = significant ? "high" : "moderate"; reason = significant ? "both matched features pass the configured adjusted-p threshold and response thresholds" : "response thresholds agree; one or both adjusted-p values are unavailable or above threshold";
        if (same === false && !params.requireDirection) { tier = "weak"; reason = "direction differs but the direction filter is disabled; retained as weak with the mismatch visible"; }
        else if (params.compareMagnitude && gap > params.maxMagnitudeGapLfc) tier = significant ? "moderate" : "weak";
      } else if (metadata.source === "bigwig" && eLfc !== null && gLfc !== null && Math.sign(eLfc) === Math.sign(gLfc) && Math.abs(eLfc) >= params.minEnhancerAbsLfc * 0.5 && Math.abs(gLfc) >= params.minGeneAbsLfc * 0.5) {
        tier = "weak"; reason = "descriptive BigWig signal changes are directionally similar; no p-values are inferred";
      }
      const mid = Math.floor((enhancer.start + enhancer.end) / 2);
      const row: Link = { link_id: `${enhancer.featureId}__${gene.geneId}`, gene_id: gene.geneId, gene_symbol: gene.symbol, gene_chrom: gene.chrom, gene_start: gene.start, gene_end: gene.end,
        gene_strand: gene.strand, tss: tssPos, enhancer_id: enhancer.featureId, chrom: enhancer.chrom, enhancer_start: enhancer.start, enhancer_end: enhancer.end,
        distance_bp: distance, midpoint_to_tss_bp: mid - tssPos, transcription_oriented_offset_bp: (mid - tssPos) * (gene.strand === "+" ? 1 : -1),
        gene_log2fc: gLfc, enhancer_log2fc: eLfc, gene_se: stat?.se ?? null, enhancer_se: enhancer.se,
        gene_pvalue: stat?.pvalue ?? null, enhancer_pvalue: enhancer.pvalue, gene_padj: stat?.padj ?? null, enhancer_padj: enhancer.padj,
        gene_baseMean: stat?.baseMean ?? null, enhancer_baseMean: enhancer.baseMean,
        direction_agreement: same, magnitude_gap_log2fc: eLfc === null || gLfc === null ? null : Math.abs(Math.abs(eLfc) - Math.abs(gLfc)),
        morphology: metadata.morphologyById?.get(enhancer.featureId) ?? "catalog_transcribed_region", overlaps_promoter: isPromoter, overlaps_gene_body: isBody,
        evidence_tier: tier, evidence_source: metadata.source === "bigwig" ? "descriptive local BigWig signal" : "matched differential feature estimates", contrast: metadata.contrast,
        compatibility_status: metadata.compatibility.status, classification_reason: reason };
      if (++count > (metadata.maxLinks ?? 1_000_000)) throw new Error("Candidate pair count exceeds the configured browser safety limit; this contrast is incomplete. Restrict the distance window or use a local workflow.");
      yield row;
    }
  }
}

/** Frozen collecting interface; persistent execution consumes the same generator. */
export function buildLinks(...args: ParametersOfLinks) {
  return [...iterateLinks(...args)].sort((a, b) => a.gene_symbol.localeCompare(b.gene_symbol) || a.distance_bp - b.distance_bp || a.enhancer_id.localeCompare(b.enhancer_id));
}

type ParametersOfLinks = [Gene[], Differential[], Differential[], Parameters, { contrast:string; compatibility:Compatibility; morphologyById?:Map<string,string>; source:"differential"|"bigwig"; maxLinks?:number }];

export function checkCompatibility(input: { bigwigAssembly?: string; statsAssembly?: string; bigwigChromStyle?: string; statsChromStyle?: string; contrastMatched?: boolean | null; normalizationKnown?: boolean; strandKnown?: boolean; exactFeatureMapping?: boolean; coordinateCompatible?: boolean | null }): Compatibility {
  const checks: Compatibility["checks"] = [];
  const mismatch = (name: string, ok: boolean, detail: string) => { checks.push({ name, status: ok ? "pass" : "fail", detail }); };
  const unknown = (name: string, ok: boolean | undefined, detail: string) => checks.push({ name, status: ok === true ? "pass" : "unverified", detail });
  if (input.bigwigAssembly && input.statsAssembly) mismatch("Genome assembly", input.bigwigAssembly.toLowerCase() === input.statsAssembly.toLowerCase(), `${input.bigwigAssembly} tracks; ${input.statsAssembly} statistics`);
  else unknown("Genome assembly", false, "Assembly must be declared for both sources.");
  if (input.bigwigChromStyle && input.statsChromStyle) mismatch("Chromosome naming", input.bigwigChromStyle === input.statsChromStyle, `Track style ${input.bigwigChromStyle}; table style ${input.statsChromStyle}`);
  else unknown("Chromosome naming", false, "Chromosome aliases have not been reconciled.");
  if (input.contrastMatched !== null && input.contrastMatched !== undefined) mismatch("Contrast identity", input.contrastMatched, input.contrastMatched ? "Same control and treatment contrast declared." : "Control/treatment assignments conflict.");
  else unknown("Contrast identity", false, "Explicit control/treatment mapping is required.");
  unknown("Normalization provenance", input.normalizationKnown, input.normalizationKnown ? "Both signal normalization and differential model are described." : "Track normalization or model offset provenance is incomplete.");
  unknown("Strand orientation", input.strandKnown, input.strandKnown ? "Plus/minus orientation is explicitly assigned." : "Strand orientation is not verified.");
  unknown("Feature identity", input.exactFeatureMapping, input.exactFeatureMapping ? "Statistical rows match the same feature IDs and coordinates." : "Exact feature mapping has not been established.");
  if (input.coordinateCompatible !== null && input.coordinateCompatible !== undefined) mismatch("Coordinate convention", input.coordinateCompatible, input.coordinateCompatible ? "Source-specific conversion is defined and applied." : "Coordinate systems conflict or remain unknown.");
  else unknown("Coordinate convention", false, "Coordinate source and conversion are not verified.");
  const status = checks.some((c) => c.status === "fail") ? "Incompatible" : checks.every((c) => c.status === "pass") ? "Verified compatible" : "Compatibility unverified";
  return { status, checks };
}

export function rowsToTsv(rows: Record<string, unknown>[]) { const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))]; return [keys.join("\t"), ...rows.map((row) => keys.map((key) => quote(String(row[key] ?? ""), "\t")).join("\t"))].join("\n"); }
export function rowsToCsv(rows: Record<string, unknown>[]) { const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))]; return [keys.join(","), ...rows.map((row) => keys.map((key) => quote(String(row[key] ?? ""), ",")).join(","))].join("\n"); }
const quote = (value: string, delimiter: string) => value.includes(delimiter) || value.includes('"') || value.includes("\n") ? `"${value.replaceAll('"', '""')}"` : value;
export function promoterAnchor(row:Link,sizes:Record<string,number>={}) {
  const start=Math.max(0,row.tss-(row.gene_strand==="+"?500:100));
  const end=Math.max(start+1,row.tss+(row.gene_strand==="+"?101:501));
  const length=sizes[row.gene_chrom];
  if(length!==undefined&&(row.tss<0||row.tss>=length))throw new Error("Gene TSS lies outside the validated chromosome bounds.");
  return {start,end:length===undefined?end:Math.min(length,end)};
}
export function linksToBedpe(rows: Link[],sizes:Record<string,number>={}) { return rows.map((row) => { const p=promoterAnchor(row,sizes); return [row.chrom, row.enhancer_start, row.enhancer_end, row.gene_chrom, p.start, p.end, row.link_id, tierScore(row.evidence_tier), ".", row.gene_strand].join("\t"); }).join("\n"); }
const tierScore = (tier: string) => ({ high: 1000, moderate: 700, weak: 450, discordant: 250, insufficient: 100 }[tier] ?? 0);
export function linksToInteract(rows: Link[],sizes:Record<string,number>={}) { const colors: Record<string, string> = { high: "31,112,79", moderate: "129,181,109", weak: "221,157,56", discordant: "190,76,58", insufficient: "130,140,137" };
  return ['track type=interact name="GEL candidate responses" description="Evidence tier is not causal validation" visibility=full', ...rows.map((row) => {
    const p=promoterAnchor(row,sizes);const s=Math.min(row.enhancer_start,p.start),e=Math.max(row.enhancer_end,p.end);
    return [row.chrom, s, e, row.link_id, tierScore(row.evidence_tier), row.magnitude_gap_log2fc ?? 0, "response-evidence", colors[row.evidence_tier] ?? colors.insufficient,
      row.chrom, row.enhancer_start, row.enhancer_end, row.enhancer_id, ".", row.gene_chrom, p.start, p.end, row.gene_symbol, row.gene_strand].join("\t");
  })].join("\n");
}
