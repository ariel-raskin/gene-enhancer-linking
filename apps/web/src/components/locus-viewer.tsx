"use client";
import {useEffect,useMemo,useState} from "react";
import type {ExperimentLink} from "@/lib/experiment";
import {fileKey} from "@/lib/experiment";
import type {ImportedFile,InputRole} from "@/lib/smart-importer";
import type {SavedRun,Layer} from "@/lib/result-store";
import type {Link} from "@/lib/analysis";
import {anchorForLink,clipLocus,evidenceColors,locusForLink} from "@/lib/locus-viewer";

type Track={values:number[];positive:number;negative:number};
const roles=["controlPlus","controlMinus","treatmentPlus","treatmentMinus"] as const;
const labels=["Control +","Control −","Treatment +","Treatment −"];
const fileIds=new WeakMap<File,number>();let fileSerial=0;
function fileIdentity(file:File){let id=fileIds.get(file);if(!id){id=++fileSerial;fileIds.set(file,id);}return id;}
export default function LocusViewer({run,selection,layer,inventory,onClose}:{run:SavedRun;selection:ExperimentLink;layer:Layer;inventory:ImportedFile[];onClose:()=>void}){
 const savedSizes=(run.resources.savedChromosomeSizes??{}) as Record<string,Record<string,number>>;
 const initialLength=savedSizes[JSON.stringify([layer,selection.contrast_id])]?.[selection.chrom];
 const [contrastId,setContrastId]=useState(selection.contrast_id),[region,setRegion]=useState(()=>{const locus=locusForLink(selection,initialLength);return {...locus,...clipLocus(locus.start,locus.end,initialLength)};}),[height,setHeight]=useState(70),[linked,setLinked]=useState<Partial<Record<InputRole,File>>>({}),[confirmed,setConfirmed]=useState(false),[loadedLinks,setLoadedLinks]=useState<{key:string;rows:Link[];total:number}>(),[signal,setSignal]=useState<{key:string;tracks:Track[];length:number}>(),[message,setMessage]=useState(""),[queryError,setQueryError]=useState("");
 const contrast=run.experiment.contrasts.find(c=>c.id===contrastId);
 const files=useMemo(()=>roles.map(role=>{const id=contrast?.bindings[role];return inventory.find(f=>fileKey(f)===id)?.file??linked[role];}),[contrast,inventory,linked]);
 const expected=roles.map(role=>run.experiment.files.find(f=>f.id===contrast?.bindings[role]));
 const manual=roles.some((role,i)=>!!linked[role]&&!inventory.some(f=>fileKey(f)===contrast?.bindings[role])&&!!files[i]);
 const queryKey=`${run.id}:${selection.gene_id}:${contrastId}:${layer}`;
 const signalKey=`${queryKey}:${region.chrom}:${region.start}:${region.end}:${files.map(f=>f?`${fileIdentity(f)}`:"missing").join("|")}:${confirmed}`;
 const links=loadedLinks?.key===queryKey?loadedLinks.rows:[];const total=loadedLinks?.key===queryKey?loadedLinks.total:0;const tracks=signal?.key===signalKey?signal.tracks:[];const length=signal?.key===signalKey?signal.length:savedSizes[JSON.stringify([layer,contrastId])]?.[region.chrom];
 const assembly=contrast?.trackAssembly||contrast?.assembly||run.experiment.assembly;
 const incompatible=assembly!==run.experiment.assembly;
 useEffect(()=>{const w=new Worker(new URL("../workers/locus-query.worker.ts",import.meta.url),{type:"module"});w.onmessage=e=>{if(e.data.error){setQueryError(e.data.error);setLoadedLinks(undefined);}else{setQueryError("");setLoadedLinks({key:queryKey,rows:e.data.rows,total:e.data.total});}};w.postMessage({run:run.id,gene:selection.gene_id,contrast:contrastId,layer});return()=>w.terminate();},[run.id,selection.gene_id,contrastId,layer,queryKey]);
 useEffect(()=>{if(files.some(f=>!f)||incompatible||(manual&&!confirmed))return;const w=new Worker(new URL("../workers/locus-signal.worker.ts",import.meta.url),{type:"module"});w.onmessage=e=>{if(e.data.error){setSignal(undefined);setMessage(e.data.error);}else{setSignal({key:signalKey,tracks:e.data.tracks,length:e.data.chromLength});setMessage("");}};w.postMessage({files,chrom:region.chrom,start:region.start,end:region.end});return()=>w.terminate();},[files,region,incompatible,manual,confirmed,signalKey]);
 const displayedLinks=contrastId===selection.contrast_id&&!links.some(r=>r.link_id===selection.link_id)?[selection,...links]:links;
 const relevant=displayedLinks.filter(r=>r.chrom===region.chrom&&(r.enhancer_end>region.start&&r.enhancer_start<region.end||r.tss>=region.start&&r.tss<region.end));
 const displayedGene=links[0]??selection;
 const visibleArcs=relevant.filter(r=>{const a=anchorForLink(r,length), e=(r.enhancer_start+r.enhancer_end)/2, p=(a.start+a.end)/2;return e>=region.start&&e<region.end&&p>=region.start&&p<region.end;});
 const x=(p:number)=>Math.max(0,Math.min(1000,1000*(p-region.start)/(region.end-region.start)));
 const navigate=(start:number,end:number)=>setRegion(r=>({...r,...clipLocus(start,end,length)}));
 const changedContrast=(id:string)=>{setContrastId(id);setLinked({});setConfirmed(false);setSignal(undefined);};
 const relink=(role:InputRole,file:File|undefined,i:number)=>{if(!file)return;const source=expected[i];if(!source||file.size!==source.size||file.name!==source.path.split(/[\\/]/).at(-1)){setMessage("File name or size differs from the saved source. Select the original file.");return;}setMessage("Confirm the selected files are the original sources; name and size do not prove identity.");setLinked(v=>({...v,[role]:file}));setConfirmed(false);};
 const max=Math.max(1e-12,...tracks.flatMap(t=>t.values.map(Math.abs)));
 return <section className="panel" aria-label="Genomic locus viewer"><div className="smart-actions"><h3>Genomic locus viewer</h3><button className="button button-light" onClick={onClose}>Close viewer</button></div>
 <p>{run.experiment.assembly} (declared) · {selection.gene_symbol} ({selection.gene_id}) · {region.chrom}:{region.start.toLocaleString()}–{region.end.toLocaleString()} (0-based, end exclusive)</p>
 <label>Viewer contrast <select aria-label="Viewer contrast" value={contrastId} onChange={e=>changedContrast(e.target.value)}>{run.experiment.contrasts.filter(c=>!c.excluded).map(c=><option key={c.id} value={c.id}>{c.label} · {c.timePoint}</option>)}</select></label>
 <p>Evidence layer: {layer}. Compatibility for initial selection: {selection.compatibility_status}. Gene and enhancer response estimates remain attached to their exact saved features; BigWig tracks show descriptive coverage. Gene bodies are shown from the saved annotation; transcript exons are not available in the saved representation.</p>
 <div className="smart-actions"><button onClick={()=>navigate(region.start-(region.end-region.start)/2,region.end-(region.end-region.start)/2)}>← Pan</button><button onClick={()=>navigate(region.start+(region.end-region.start)/4,region.end-(region.end-region.start)/4)}>Zoom in</button><button onClick={()=>navigate(region.start-(region.end-region.start)/2,region.end+(region.end-region.start)/2)}>Zoom out</button><button onClick={()=>navigate(region.start+(region.end-region.start)/2,region.end+(region.end-region.start)/2)}>Pan →</button><label>Track height <input aria-label="Viewer track height" type="range" min="40" max="150" value={height} onChange={e=>setHeight(Number(e.target.value))}/></label></div>
 {incompatible&&<p className="error-box">Track and experiment assembly declarations conflict. Signal display is blocked.</p>}
 <details open><summary>Original local signal files</summary><p>Source files are not saved with results. Reselect each original BigWig after a restart. Automatic matching uses recorded path, size and modification time; neither it nor name/size matching proves file identity.</p>{roles.map((role,i)=><label key={role}>{labels[i]}: {files[i]?.name??"missing"} {expected[i]?`(expected ${expected[i]!.path}, ${expected[i]!.size} bytes)`:"(not assigned for this contrast)"}<input aria-label={`Relink ${labels[i]}`} type="file" accept=".bw,.bigwig" disabled={!expected[i]} onChange={e=>relink(role,e.target.files?.[0],i)}/></label>)}{manual&&<label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I confirm these are the original tracks for the displayed contrast.</label>}</details>
 {message&&<p role="alert">{message}</p>}{queryError&&<p role="alert">{queryError}</p>}
 <p>{total} saved candidates for this gene and contrast; {Math.min(total,100)} loaded from the index; the selected candidate is also retained when needed. {total>100?"Viewer is limited to the first 100 candidates; use the results explorer for the remainder.":""}</p>
 <p>{relevant.length-visibleArcs.length} candidate arcs have an anchor outside this view and are omitted from the drawing. Pan or zoom to inspect them.</p>
 <p>Arc colors: {Object.entries(evidenceColors).map(([tier,color])=><span key={tier} style={{color,marginRight:12}}>● {tier}</span>)}</p>
 <svg role="img" aria-label="Gene, enhancer and candidate arcs" viewBox="0 0 1000 150" width="100%" height="150" style={{background:"#f8faf9",border:"1px solid #d6dedb"}}>
 <line x1="0" x2="1000" y1="20" y2="20" stroke="#555"/><text x="0" y="14" fontSize="14">{region.start}</text><text x="990" y="14" textAnchor="end" fontSize="14">{region.end}</text>
 {visibleArcs.map(r=>{const a=anchorForLink(r,length),x1=x((r.enhancer_start+r.enhancer_end)/2),x2=x((a.start+a.end)/2);return <g key={r.link_id}><path data-enhancer-start={r.enhancer_start} data-enhancer-end={r.enhancer_end} data-promoter-start={a.start} data-promoter-end={a.end} d={`M ${x1} 120 Q ${(x1+x2)/2} ${Math.max(32,110-Math.abs(x2-x1)*0.35)} ${x2} 120`} fill="none" stroke={evidenceColors[r.evidence_tier]??evidenceColors.insufficient} strokeWidth="2"><title>{`${r.enhancer_id} → ${r.gene_symbol}: ${r.evidence_tier}; gene ${r.gene_log2fc??"NA"}, enhancer ${r.enhancer_log2fc??"NA"}`}</title></path><rect x={x(r.enhancer_start)} y="123" width={Math.max(2,x(r.enhancer_end)-x(r.enhancer_start))} height="8" fill={evidenceColors[r.evidence_tier]??evidenceColors.insufficient}/></g>;})}
 <line x1={x(displayedGene.gene_start)} x2={x(displayedGene.gene_end)} y1="143" y2="143" stroke="#233d57" strokeWidth="5"/><text x={x(displayedGene.tss)} y="140" fontSize="12" fill="#233d57">{displayedGene.gene_strand=== "+"?"→":"←"} {selection.gene_symbol}</text></svg>
 {tracks.length===4&&<>{tracks.some(t=>t.positive&&t.negative)&&<p>At least one track contains mixed signs; minus display uses negative absolute values.</p>}<p>Shared absolute scale ±{max.toPrecision(3)}; minus tracks are displayed below zero, including positive-valued minus inputs. Each pixel bin shows mean signal across its bases.</p>{tracks.map((t,i)=><div key={roles[i]}><strong>{labels[i]} · {files[i]?.name}</strong><svg role="img" aria-label={`${labels[i]} signal`} viewBox="0 0 1000 100" width="100%" height={height} preserveAspectRatio="none" style={{background:"#f8faf9",border:"1px solid #d6dedb"}}><line x1="0" x2="1000" y1="50" y2="50" stroke="#aaa"/>{t.values.map((v,j)=>v!==0?<line key={j} x1={j*1.25} x2={j*1.25} y1="50" y2={50-v/max*45} stroke={i%2?"#a84a59":"#246c92"} strokeWidth="1.3"/>:null)}</svg></div>)}</>}
 <ul>{relevant.map(r=><li key={r.link_id}>{r.enhancer_id} · {r.enhancer_start}–{r.enhancer_end} · {r.evidence_tier} · gene log₂FC {r.gene_log2fc??"NA"}; enhancer log₂FC {r.enhancer_log2fc??"NA"}; padj {r.gene_padj??"NA"} / {r.enhancer_padj??"NA"} · {r.evidence_source}</li>)}</ul>
 </section>;
}
