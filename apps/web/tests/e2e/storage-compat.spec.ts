import {test,expect} from "@playwright/test";
import {execFileSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import ts from "typescript";

test("additive schema upgrade preserves v0.6 runs and rolls back a terminated writer",async({page})=>{
 test.setTimeout(90000);await page.goto("/workspace");
 const baseline=execFileSync("git",["show","945f75d60f99e19bcc7aabdf4da6dbb3f7c8ac19:apps/web/src/lib/result-store.ts"],{encoding:"utf8"});
 const compile=(source:string)=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
 const old=compile(baseline.replace('"gel-results-v1"','"gel-legacy-compatibility"')),current=compile(await readFile("src/lib/result-store.ts","utf8"));
 const fixture=JSON.parse(await readFile("../../examples/regression/v03-single-contrast.json","utf8"));
 const result=await page.evaluate(async({old,current,fixture})=>{
  const loadModule=async(source:string)=>import(URL.createObjectURL(new Blob([source],{type:"text/javascript"}))),legacy=await loadModule(old),api=await loadModule(current);
  const row=(Object.values(fixture) as {links?:Record<string,unknown>[]}[]).find(x=>x.links?.length)!.links![0],gene={geneId:row.gene_id,symbol:row.gene_symbol,chrom:row.chrom,start:row.gene_start,end:row.gene_end,strand:row.gene_strand};
  const exp={experimentId:"compatibility",contrasts:[],files:[]},params={},store=await legacy.ResultStore.open(),r=await store.create(exp,params,16*1024**2);
  const values=Array.from({length:20},(_,i)=>({...row,link_id:`legacy${i}`}));const features=(run:string)=>[{run,layer:"primary",contrast:"c",kind:"gene",id:row.gene_id,value:gene,counts:{}}];
  await store.commit(r.id,"primary","c","f",0,[],features(r.id));await store.commit(r.id,"primary","c","p",0,values);await store.update(r.id,{state:"complete"});const before=await store.get(r.id),expected=(await legacy.queryResults(store.db,{run:r.id,layer:"primary"})).rows.map((v:{row:unknown})=>v.row);store.close();
  const s=new api.ResultStore(await api.openResults("gel-legacy-compatibility"));const unchanged=JSON.stringify(await s.get(r.id))===JSON.stringify(before),loaded=await api.queryResults(s.db,{run:r.id,layer:"primary"});
  const exported=[];for await(const v of s.rows(r.id,"primary"))exported.push(v.row);
  let readOnly=false;try{await s.commit(r.id,"primary","c","new",0,[{...row,link_id:"forbidden"}]);}catch(e){readOnly=String(e).includes("read-only");}
  const next=await s.create(exp,params,16*1024**2);await s.claimFresh(next.id,exp,params,{});await s.commit(next.id,"primary","c","f",0,[],features(next.id));await s.commit(next.id,"primary","c","p",0,values);
  // Keep a real transaction live while the worker is terminated. All queued row/checkpoint/count writes must roll back.
  const workerSource=`const moduleUrl=URL.createObjectURL(new Blob([${JSON.stringify(current)}],{type:'text/javascript'}));const api=await import(moduleUrl);const s=new api.ResultStore(await api.openResults('gel-legacy-compatibility'));const t=s.db.transaction(['runs','rowIndex','batches'],'readwrite');const rr=t.objectStore('runs').get(${JSON.stringify(next.id)});rr.onsuccess=()=>{const r=rr.result;t.objectStore('rowIndex').add({r:r.storageKey,ordinal:999999,run:r.id,layer:'primary',contrast:'c',id:'interrupted'});t.objectStore('batches').add({run:r.id,layer:'primary',contrast:'c',partition:'interrupted',sequence:0,rows:1});t.objectStore('runs').put({...r,rows:21});const keep=()=>{const q=t.objectStore('runs').get(r.id);q.onsuccess=keep;};keep();postMessage('queued');};`;
  const worker=new Worker(URL.createObjectURL(new Blob([workerSource],{type:"text/javascript"})),{type:"module"});await new Promise<void>((resolve,reject)=>{worker.onmessage=()=>resolve();worker.onerror=e=>reject(new Error(e.message));});worker.terminate();
  const afterCrash=await s.get(next.id),q=await api.queryResults(s.db,{run:next.id,layer:"primary"});let restartRejected=false;try{await s.claimFresh(next.id,exp,params,{});}catch{restartRejected=true;}
  await s.update(next.id,{state:"partial",note:"Explicit recovery after terminated writer; no resume."});
  await s.delete(r.id);const retained=(await api.queryResults(s.db,{run:next.id,layer:"primary"})).total;const oldGone=(await api.queryResults(s.db,{run:r.id,layer:"primary"})).total===0;await s.delete(next.id);s.close();
  return {unchanged,readOnly,schema:afterCrash.schema,oldRows:loaded.rows.map((v:{row:unknown})=>v.row),expected,exported,afterRows:afterCrash.rows,indexRows:q.total,retained,oldGone,restartRejected};
 },{old,current,fixture});
 expect(result.unchanged&&result.readOnly&&result.oldGone&&result.restartRejected).toBe(true);expect(result.schema).toBe(2);expect(result.oldRows).toEqual(result.expected);const order=(a:unknown,b:unknown)=>String((a as {link_id:string}).link_id).localeCompare(String((b as {link_id:string}).link_id));expect(result.exported.sort(order)).toEqual(result.expected.sort(order));expect(result.afterRows).toBe(20);expect(result.indexRows).toBe(20);expect(result.retained).toBe(20);
});
