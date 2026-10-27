/** Browser export path: format at most 500 rows into JS strings at once, retain native Blobs. */
import { linksToBedpe, linksToInteract, rowsToCsv, rowsToTsv, type Link, type Parameters } from "./analysis";
import { decorateExperimentLink, experimentLinkRefs, geneSummaries, type Experiment, type Outcome } from "./experiment";
import { makeExperimentArtifacts, experimentBedpe, exportChromosomeSizes } from "./experiment-exports";

type Row = Record<string,unknown>;
function tabular(rows:Iterable<Row>,csv=false){
  const parts:BlobPart[]=[];let batch:Row[]=[];let first=true;
  function flush(){if(!batch.length)return;const text=(csv?rowsToCsv:rowsToTsv)(batch);parts.push((first?"":"\n")+(first?text:text.slice(text.indexOf("\n")+1)));first=false;batch=[];}
  for(const row of rows){batch.push(row);if(batch.length===500)flush();}flush();return new Blob(parts,{type:"text/plain;charset=utf-8"});
}
function lines<T>(rows:Iterable<T>,format:(row:T)=>string,header?:string){const parts:BlobPart[]=header?[header]:[];let batch:string[]=[];let first=!header;for(const row of rows){batch.push(format(row));if(batch.length===500){parts.push((first?"":"\n")+batch.join("\n"));first=false;batch=[];}}if(batch.length)parts.push((first?"":"\n")+batch.join("\n"));return new Blob(parts);}
function* filterLinks(rows:Link[],tier?:string){for(const r of rows)if(!tier||r.evidence_tier===tier)yield r;}
function interact(rows:Iterable<Link>,sizes:Record<string,number>={}){return lines(rows,r=>linksToInteract([r],sizes).split("\n").slice(1).join("\n"),linksToInteract([]));}
export function* experimentBlobArtifacts(exp:Experiment,outcomes:Outcome[],parameters:Parameters,resources:Record<string,unknown>={}) : Generator<[string,Blob]> {
  // Metadata/status is small. Do not call the legacy all-at-once formatter on actual pair tables.
  const metadata=makeExperimentArtifacts(exp,outcomes.map(o=>({...o,result:undefined})),parameters,resources);
  const validations=outcomes.map(({result,...o})=>({...o,validation:result?.validation??null}));
  metadata["validation_report.json"]=JSON.stringify({...JSON.parse(metadata["validation_report.json"]),outcomes:validations,exportStrategy:"500-row formatting batches; native Blob files; STORE ZIP"},null,2);
  for(const [name,text] of Object.entries(metadata))if(!name.startsWith("gel_"))yield [name,new Blob([text])];
  for(const layer of ["primary","track"] as const){
    const sizes=exportChromosomeSizes(outcomes,layer);
    const refs=experimentLinkRefs(exp,outcomes,layer);if(layer==="track"&&!refs.length)continue;
    const rows=function*(){for(const {row,contrast} of refs)yield decorateExperimentLink(exp,row,contrast,layer);};
    const stem=layer==="primary"?"gel_experiment_links":"track_only_experiment_links";
    yield [stem+".tsv",tabular(rows())];
    yield [stem+".bedpe",lines(rows(),r=>experimentBedpe([r],sizes))];
    if(layer==="primary"){
      yield [stem+".csv",tabular(rows(),true)];
      yield [stem+".interact",interact((function*(){for(const r of rows())yield {...r,link_id:r.candidate_id};})(),sizes)];
    }
  }
  yield ["gel_gene_summary.tsv",tabular(geneSummaries(exp,outcomes))];
  for(const o of outcomes)if(o.status==="successful"&&o.result){
    const c=exp.contrasts.find(c=>c.id===o.contrastId)!,result=o.result,base=`contrasts/${encodeURIComponent(c.id)}/`;
    yield [base+"gel_links.tsv",tabular(result.links)];yield [base+"gel_links.csv",tabular(result.links,true)];
    yield [base+"gel_links.bedpe",lines(result.links,r=>linksToBedpe([r],(result.validation.chromosomeSizes??{}) as Record<string,number>))];yield [base+"gel_links.interact",interact(result.links,(result.validation.chromosomeSizes??{}) as Record<string,number>)];
    for(const tier of ["high","moderate","weak","discordant","insufficient"])yield [base+`gel_links_${tier}.interact`,interact(filterLinks(result.links,tier),(result.validation.chromosomeSizes??{}) as Record<string,number>)];
    const genes=new Map<string,Link>();for(const r of result.links)if(!genes.has(r.gene_id))genes.set(r.gene_id,r);
    yield [base+"gel_genes.bed",lines(genes.values(),r=>`${r.gene_chrom}\t${r.gene_start}\t${r.gene_end}\t${r.gene_symbol||r.gene_id}\t0\t${r.gene_strand}`)];
    yield [base+"gel_enhancers.bed",lines(result.enhancers,r=>`${r.chrom}\t${r.start}\t${r.end}\t${r.featureId}\t0\t.`)];
    for(const [name,value] of Object.entries({"analysis_parameters.json":parameters,"validation_report.json":result.validation,"input_provenance.json":{experimentId:exp.experimentId,contrast:c,assembly:exp.assembly,files:exp.files.filter(f=>Object.values(c.bindings).includes(f.id)),annotationProvenance:exp.annotationProvenance}}))yield [base+name,new Blob([JSON.stringify(value,null,2)])];
    if(result.trackEvidence){yield [base+"track_only_links.tsv",tabular(result.trackEvidence.links)];yield [base+"track_only_enhancers.bed",lines(result.trackEvidence.enhancers,r=>`${r.chrom}\t${r.start}\t${r.end}\t${r.featureId}\t0\t.`)];}
    if(result.secondaryGeneStats?.length)yield [base+"promoter_proximal_effects.tsv",tabular(result.secondaryGeneStats as Row[])];
  }
}
