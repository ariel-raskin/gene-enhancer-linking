import { test,expect,chromium } from "@playwright/test";
import {readFile,mkdtemp} from "node:fs/promises";
import ts from "typescript";
import {tmpdir} from "node:os";
import {join} from "node:path";

test("local storage benchmarks, atomic batches, indexed paging, idempotence and quota recovery",async({},info)=>{
 test.setTimeout(180000);
 const profile=await mkdtemp(join(tmpdir(),"gel-storage-benchmark-"));const context=await chromium.launchPersistentContext(profile,{headless:true,baseURL:process.env.GEL_BASE_URL??"http://127.0.0.1:3000"});const page=await context.newPage();await page.goto("/workspace");
 const js=ts.transpileModule(await readFile("src/lib/result-store.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
 const data=JSON.parse(await readFile("../../examples/regression/v03-single-contrast.json","utf8"));
 const report=await page.evaluate(async({js,data})=>{
  const api=await import(URL.createObjectURL(new Blob([js],{type:"text/javascript"})));
  const store=await api.ResultStore.open();
  const sample=(Object.values(data) as {links?:unknown[]}[]).find(x=>x.links?.length)?.links?.[0];
  if(!sample)throw new Error("No fixture row");
  const row=sample as Record<string,unknown>;
  const run=await store.create({experimentId:"storage-benchmark",contrasts:[],files:[]},{},256*1024**2);
  const gene={geneId:row.gene_id,symbol:row.gene_symbol,chrom:row.chrom,start:row.gene_start,end:row.gene_end,strand:row.gene_strand};
  await store.commit(run.id,"primary","c","f",0,[],[{run:run.id,layer:"primary",contrast:"c",kind:"gene",id:row.gene_id,value:gene,counts:{}}]);
  const claimed=await store.create({experimentId:"claim",contrasts:[],files:[]},{},1024**2);let changedConfig=false;try{await store.claimFresh(claimed.id,{experimentId:"different",contrasts:[],files:[]},{},{});}catch{changedConfig=true;}await store.claimFresh(claimed.id,{experimentId:"claim",contrasts:[],files:[]},{},{});let doubleStart=false;try{await store.claimFresh(claimed.id,{experimentId:"claim",contrasts:[],files:[]},{},{});}catch{doubleStart=true;}await store.delete(claimed.id);
  const started=performance.now(),count=20000;
  for(let i=0;i<count;i+=500){const batch=Array.from({length:500},(_,j)=>({...row,link_id:`link${String(i+j).padStart(8,"0")}`,enhancer_start:i+j}));await store.commit(run.id,"primary","c","p",i/500,batch);}
  const writeMs=performance.now()-started;
  const relaxed=new api.ResultStore(store.db,"relaxed"),alternative=await relaxed.create({experimentId:"relaxed-benchmark",contrasts:[],files:[]},{},256*1024**2);
  await relaxed.commit(alternative.id,"primary","c","f",0,[],[{run:alternative.id,layer:"primary",contrast:"c",kind:"gene",id:row.gene_id,value:gene,counts:{}}]);const altStart=performance.now();
  for(let i=0;i<count;i+=500){await relaxed.commit(alternative.id,"primary","c","p",i/500,Array.from({length:500},(_,j)=>({...row,link_id:`link${String(i+j).padStart(8,"0")}`,enhancer_start:i+j})));}const relaxedWriteMs=performance.now()-altStart;
  await relaxed.delete(alternative.id);
  const t=performance.now();const first=await api.queryResults(store.db,{run:run.id,layer:"primary"});const second=await api.queryResults(store.db,{run:run.id,layer:"primary",after:api.rowKey(first.rows.at(-1))});const queryMs=performance.now()-t;
  const same=Array.from({length:500},(_,j)=>({...row,link_id:`link${String(j).padStart(8,"0")}`,enhancer_start:j}));const repeat=await store.commit(run.id,"primary","c","p",0,same);
  let collision=false;try{await store.commit(run.id,"primary","c","p",0,[row]);}catch{collision=true;}
  let duplicate=false;try{await store.commit(run.id,"primary","c","p",100,same);}catch{duplicate=true;}
  const saved=await store.get(run.id);
  // Deliberately corrupt a decoded payload checksum and verify reads refuse it.
  const corrupt=await store.create({experimentId:"corrupt",contrasts:[],files:[]},{},1024**2);
  await store.commit(corrupt.id,"primary","c","f",0,[],[{run:corrupt.id,layer:"primary",contrast:"c",kind:"gene",id:row.gene_id,value:gene,counts:{}}]);await store.commit(corrupt.id,"primary","c","p",0,[{...row,link_id:"corrupt"}]);
  await new Promise<void>((resolve,reject)=>{const t=store.db.transaction("batches","readwrite"),s=t.objectStore("batches"),r=s.get([corrupt.id,"primary","c","p",0]);r.onsuccess=()=>s.put({...r.result,payloadHash:"incorrect"});t.oncomplete=()=>resolve();t.onabort=()=>reject(t.error);});let corruption=false;try{await api.queryResults(store.db,{run:corrupt.id,layer:"primary"});}catch{corruption=true;}await store.delete(corrupt.id);
  const genePage=await api.queryResults(store.db,{run:run.id,layer:"primary",gene:String(row.gene_symbol)});
  const union=await api.queryResults(store.db,{run:run.id,layer:"primary",contrastIds:["c","other","c"]});
  const sorted=await api.queryResults(store.db,{run:run.id,layer:"primary",gene:String(row.gene_symbol),sort:"distance"});
  const morphology=await api.queryResults(store.db,{run:run.id,layer:"primary",morphology:row.morphology,chrom:row.chrom,start:1,end:20});
  let allPages=0;let after:IDBValidKey|undefined;do{const q:{rows:{id:string}[];total:number}=await api.queryResults(store.db,{run:run.id,layer:"primary",after});allPages+=q.rows.length;after=q.rows.length?api.rowKey(q.rows.at(-1)):undefined;if(!q.rows.length)break;}while(allPages<count);
  // A transaction containing a new row and a duplicate must roll back both its row and checkpoint.
  let atomic=false;try{await store.commit(run.id,"primary","c","atomic",0,[{...row,link_id:"must-roll-back"},same[0]]);}catch{const q=await api.queryResults(store.db,{run:run.id,layer:"primary"});atomic=q.total===count;}
  // Browser quota headroom has a separate failure path from the configured payload budget.
  const estimate=navigator.storage.estimate.bind(navigator.storage);navigator.storage.estimate=async()=>({usage:900*1024**2,quota:1024**3});let headroom=false;try{await store.commit(run.id,"primary","c","headroom",16,[row]);}catch(e){headroom=(e as DOMException).name==="QuotaExceededError";}navigator.storage.estimate=estimate;
  await store.update(run.id,{state:"cancelled"});let cancelled=false;try{await store.commit(run.id,"primary","c","p",101,[{...row,link_id:"cancelled"}]);}catch{cancelled=true;}
  const changing=await store.create({experimentId:"delete-during-export",contrasts:[],files:[]},{},1024**2);
  await store.commit(changing.id,"primary","c","f",0,[],[{run:changing.id,layer:"primary",contrast:"c",kind:"gene",id:row.gene_id,value:gene,counts:{}}]);await store.commit(changing.id,"primary","c","p",0,same);await store.update(changing.id,{state:"complete"});const stream=store.rows(changing.id,"primary");await stream.next();await store.delete(changing.id);let deletedDuringExport=false;try{while(!(await stream.next()).done){/* bounded cached batch may drain before deletion is detected */}}catch{deletedDuringExport=true;}
  const small=await store.create({experimentId:"quota",contrasts:[],files:[]},{},1024);let quota=false;try{await store.commit(small.id,"primary","c","p",0,[row]);}catch(e){quota=(e as DOMException).name==="QuotaExceededError";}
  const bytes=new TextEncoder().encode(JSON.stringify(Array.from({length:500},(_,j)=>({...row,link_id:`opfs${j}`}))));
  let opfs:Record<string,unknown>={supported:false};
  if(navigator.storage.getDirectory){const root=await navigator.storage.getDirectory();const f=await root.getFileHandle("gel-storage-benchmark.tmp",{create:true});const t=performance.now(),w=await f.createWritable();for(let i=0;i<40;i++)await w.write(bytes);await w.close();const file=await f.getFile();opfs={supported:true,writeMs:performance.now()-t,size:file.size};await root.removeEntry("gel-storage-benchmark.tmp");}
  const result={profileMode:"normal persistent browser profile",rows:saved.rows,batches:saved.batches,writeMs,relaxedWriteMs,queryMs,estimatedBytes:saved.bytes,first:first.rows.length,second:second.rows.length,total:first.total,distinct:first.rows.at(-1).id!==second.rows[0].id,repeat,collision,duplicate,cancelled,quota,headroom,atomic,corruption,deletedDuringExport,doubleStart,changedConfig,allPages,geneCount:genePage.total,unionCount:union.total,sortedCount:sorted.total,rangeCount:morphology.total,opfs,fileSystemAccess:"showSaveFilePicker" in window,storage:await navigator.storage.estimate(),browser:navigator.userAgent};
  await store.delete(run.id);await store.delete(small.id);store.close();return result;
 },{js,data});
 console.log("STORAGE_BENCHMARK",JSON.stringify(report));await info.attach("storage-benchmark.json",{body:JSON.stringify(report,null,2),contentType:"application/json"});
 expect(report.allPages).toBe(20000);expect(report.geneCount).toBe(20000);expect(report.sortedCount).toBe(20000);expect(report.unionCount).toBe(20000);expect(report.rangeCount).toBe(20);expect(report.rows).toBe(20000);expect(report.total).toBe(20000);expect(report.first).toBe(100);expect(report.second).toBe(100);expect(report.distinct).toBe(true);expect(report.repeat).toBe(false);expect(report.collision&&report.duplicate&&report.cancelled&&report.quota&&report.headroom&&report.atomic&&report.corruption&&report.deletedDuringExport&&report.doubleStart&&report.changedConfig).toBe(true);await context.close();
});
