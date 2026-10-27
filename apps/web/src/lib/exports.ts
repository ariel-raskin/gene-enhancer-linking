import { linksToBedpe, linksToInteract, rowsToCsv, rowsToTsv, type Link, type Parameters } from "./analysis";

export type ExportInput = {
  genes: unknown[]; enhancers: { featureId: string; chrom: string; start: number; end: number; log2fc: number | null; sourceId: string; source: string }[];
  links: Link[]; secondaryGeneStats?: unknown[]; trackEvidence?: ExportInput;
  validation: Record<string, unknown>;
};

export function makeArtifacts(result: ExportInput, parameters: Parameters, provenance: Record<string, unknown>) {
  const links = result.links; const objects = links as unknown as Record<string, unknown>[];
  const genes = new Map<string, Link>(); for (const row of links) if (!genes.has(row.gene_id)) genes.set(row.gene_id, row);
  const geneBed = [...genes.values()].map((row) => `${row.gene_chrom}\t${row.gene_start}\t${row.gene_end}\t${row.gene_symbol || row.gene_id}\t0\t${row.gene_strand}`).join("\n");
  const enhancerBed = result.enhancers.map((row) => `${row.chrom}\t${row.start}\t${row.end}\t${row.featureId}\t0\t.`).join("\n");
  const tierOrder = ["high", "moderate", "weak", "discordant", "insufficient"];
  const tierFiles = tierOrder.map((tier) => [`gel_links_${tier}.interact`, linksToInteract(links.filter((row) => row.evidence_tier === tier))] as const);
  return { "gel_links.csv": rowsToCsv(objects), "gel_links.tsv": rowsToTsv(objects), "gel_genes.bed": geneBed,
    "gel_enhancers.bed": enhancerBed, "gel_links.bedpe": linksToBedpe(links), "gel_links.interact": linksToInteract(links),
    ...Object.fromEntries(tierFiles), ...(result.trackEvidence ? { "track_only_enhancers.bed": result.trackEvidence.enhancers.map((row) => `${row.chrom}\t${row.start}\t${row.end}\t${row.featureId}\t0\t.`).join("\n"),
      "track_only_links.tsv": rowsToTsv(result.trackEvidence.links as unknown as Record<string, unknown>[]) } : {}),
    ...(result.secondaryGeneStats?.length ? { "promoter_proximal_effects.tsv": rowsToTsv(result.secondaryGeneStats as Record<string, unknown>[]) } : {}),
    "analysis_parameters.json": JSON.stringify(parameters, null, 2), "input_provenance.json": JSON.stringify(provenance, null, 2),
    "validation_report.json": JSON.stringify(result.validation, null, 2) };
}
