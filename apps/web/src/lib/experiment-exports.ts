import { rowsToCsv, rowsToTsv, linksToBedpe, linksToInteract, type Parameters } from "./analysis";
import { makeArtifacts } from "./exports";
import { experimentLinks, geneSummaries, GEL_VERSION, type Experiment, type Outcome, type ExperimentLink } from "./experiment";

export function experimentBedpe(rows: ExperimentLink[]) {
  return rows.map((r)=>`${linksToBedpe([{...r,link_id:r.candidate_id}])}\t${encodeURIComponent(r.contrast_id)}\t${r.genome_assembly.replace(/[\t\r\n]/g,"_")}`).join("\n");
}
export function makeExperimentArtifacts(exp: Experiment, outcomes: Outcome[], parameters: Parameters, resources: Record<string,unknown> = {}) {
  const rows=experimentLinks(exp,outcomes); const track=experimentLinks(exp,outcomes,"track");
  const artifacts:Record<string,string>={
    "gel_experiment_links.tsv":rowsToTsv(rows), "gel_experiment_links.csv":rowsToCsv(rows),
    "gel_gene_summary.tsv":rowsToTsv(geneSummaries(exp,outcomes)),
    "gel_experiment_links.bedpe":experimentBedpe(rows),
    "gel_experiment_links.interact":linksToInteract(rows.map(r=>({...r,link_id:r.candidate_id}))),
    "experiment_manifest.json":JSON.stringify({...exp,gel_version:GEL_VERSION},null,2), "analysis_parameters.json":JSON.stringify(parameters,null,2),
    "contrast_status.tsv":rowsToTsv(outcomes.map(o=>({contrast_id:o.contrastId,status:o.status,findings:o.findings.join("; "),elapsed_ms:o.elapsedMs??null}))),
    "validation_report.json":JSON.stringify({schema_version:2,gel_version:GEL_VERSION,resources,outcomes:outcomes.map(({result,...o})=>({...o,validation:result?.validation??null})),dependence:"Contrasts sharing condition/sample IDs are dependent; no pooling or association p-values.",privacy:{selected_file_contents_uploaded:false}},null,2),
    "source_provenance.json":JSON.stringify({files:exp.files,samples:exp.samples,conditions:exp.conditions,contrasts:exp.contrasts,annotationProvenance:exp.annotationProvenance},null,2),
    "README.txt":"GEL experiment results: candidates for researcher review, not causal validation.\nCoordinates: 0-based half-open. Combined BEDPE columns 1-10 are BEDPE; column 11 is contrast ID; column 12 is assembly.\nStable candidate IDs include source contrast and original single-contrast link ID.\nShared control IDs refer to the same underlying samples/conditions. No independent-replicate interpretation or statistical pooling.\nTrack-only effects and model effects are separate. Empty tables may contain no data rows.\nThe saved manifest references local files; it contains no input contents.\n",
  };
  if(track.length) { artifacts["track_only_experiment_links.tsv"]=rowsToTsv(track); artifacts["track_only_experiment_links.bedpe"]=experimentBedpe(track); }
  for(const o of outcomes) if(o.status==="successful"&&o.result){
    const c=exp.contrasts.find(c=>c.id===o.contrastId)!;
    for(const [name,content] of Object.entries(makeArtifacts(o.result,parameters,{experimentId:exp.experimentId,contrast:c,assembly:exp.assembly,files:exp.files.filter(f=>Object.values(c.bindings).includes(f.id)),annotationProvenance:exp.annotationProvenance}))) artifacts[`contrasts/${encodeURIComponent(c.id)}/${name}`]=content;
  }
  return artifacts;
}
