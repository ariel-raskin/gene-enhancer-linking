import type { Differential, Gene, Link, Parameters } from "./analysis";
import type { Experiment, Outcome } from "./experiment";

export const RESULT_DB = "gel-results-v1";
export const STORE_SCHEMA = 1;
export const WRITE_BATCH = 500;
export const DEFAULT_DISK_BUDGET = 4 * 1024 ** 3;
export type RunState = "running" | "complete" | "cancelled" | "failed" | "partial";
export type Layer = "primary" | "track";
export type SavedRun = { id:string; schema:1; created:string; updated:string; state:RunState; experiment:Experiment; parameters:Parameters; outcomes:Outcome[]; rows:number; bytes:number; batches:number; budget:number; writeMs?:number; resources:Record<string,unknown>; note?:string; recoveryReserve?:string };
export type StoredRow = { run:string; layer:Layer; contrast:string; id:string; row:Link; symbol:string; gene:string; distanceValue:number; magnitudeValue:number };
type IndexedRow = Omit<StoredRow,"row"> & {row:Pick<Link,"chrom"|"enhancer_start"|"enhancer_end"|"enhancer_id"|"evidence_tier"|"morphology"|"gene_padj"|"enhancer_padj">;batchKey:IDBValidKey[];position:number};
export type StoredFeature = {run:string;layer:Layer;contrast:string;kind:"gene"|"enhancer"|"promoter";id:string;value:Gene|Differential;stat?:Differential;counts:Record<string,number>};
export type ResultPartition = {genes:Gene[];geneStats:Differential[];enhancers:Differential[];secondaryGeneStats?:Differential[];chromosomeSizes?:Record<string,number>};
export interface ResultSink { partition(id:string,features:ResultPartition,rows:Iterable<Link>):Promise<number> }
const req = <T>(r:IDBRequest<T>) => new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const done = (t:IDBTransaction) => new Promise<void>((resolve,reject)=>{t.oncomplete=()=>resolve();t.onabort=()=>reject(t.error??new Error("Storage transaction aborted; no batch committed."));t.onerror=()=>{/* onabort carries transaction failure */};});
export async function openResults() {
  const r=indexedDB.open(RESULT_DB,STORE_SCHEMA);
  r.onupgradeneeded=()=>{
    const db=r.result;
    db.createObjectStore("runs",{keyPath:"id"});
    const rows=db.createObjectStore("rows",{keyPath:["run","layer","contrast","id"]});
    rows.createIndex("order",["run","layer","row.chrom","row.enhancer_start","contrast","id"]); rows.createIndex("distance",["run","layer","distanceValue","row.chrom","row.enhancer_start","contrast","id"]); rows.createIndex("magnitude",["run","layer","magnitudeValue","row.chrom","row.enhancer_start","contrast","id"]);
    rows.createIndex("gene",["run","layer","gene","row.chrom","row.enhancer_start","contrast","id"]);
    rows.createIndex("symbol",["run","layer","symbol","row.chrom","row.enhancer_start","contrast","id"]);
    rows.createIndex("enhancer",["run","layer","row.enhancer_id","contrast","id"]);
    rows.createIndex("contrast",["run","layer","contrast","row.chrom","row.enhancer_start","id"]);
    rows.createIndex("chrom",["run","layer","row.chrom","row.enhancer_start","contrast","id"]);
    rows.createIndex("tier",["run","layer","row.evidence_tier","row.chrom","row.enhancer_start","contrast","id"]);
    db.createObjectStore("batches",{keyPath:["run","layer","contrast","partition","sequence"]}).createIndex("export",["run","layer","partition","contrast","sequence"]);
    const f=db.createObjectStore("features",{keyPath:["run","layer","contrast","kind","id"]});
    f.createIndex("kind",["run","layer","kind","contrast","id"]);
  };
  r.onblocked=()=>{ /* another tab's older connection must close before upgrade */ };
  const db=await req(r);db.onversionchange=()=>db.close();return db;
}
export class ResultStore {
  constructor(readonly db:IDBDatabase,readonly durability:IDBTransactionDurability="strict"){}
  static async open(){return new ResultStore(await openResults());}
  close(){this.db.close();}
  async get(id:string){const t=this.db.transaction("runs");return req(t.objectStore("runs").get(id)) as Promise<SavedRun|undefined>;}
  async list(){const t=this.db.transaction("runs");return (await req(t.objectStore("runs").getAll()) as SavedRun[]).sort((a,b)=>b.created.localeCompare(a.created));}
  async create(experiment:Experiment,parameters:Parameters,budget=DEFAULT_DISK_BUDGET){
    if(!Number.isSafeInteger(budget)||budget<1024)throw new Error("Invalid local result byte budget.");
    const now=new Date().toISOString();const run:SavedRun={id:crypto.randomUUID(),schema:1,created:now,updated:now,state:"running",experiment,parameters,outcomes:[],rows:0,bytes:0,batches:0,budget,resources:{},recoveryReserve:" ".repeat(65536)};
    const t=this.db.transaction("runs","readwrite");const complete=done(t);if(await req(t.objectStore("runs").count())>=50){t.abort();await complete.catch(()=>{});throw new Error("At most 50 saved runs; export/delete older local results before starting another run.");}t.objectStore("runs").add(run);await complete;return run;
  }
  async update(id:string,patch:Partial<Pick<SavedRun,"state"|"outcomes"|"resources"|"note">>){
    const t=this.db.transaction("runs","readwrite"),complete=done(t),s=t.objectStore("runs"),r=await req(s.get(id)) as SavedRun|undefined;
    if(!r){t.abort();await complete;return;}
    s.put({...r,...patch,resources:patch.resources?{...r.resources,...patch.resources}:r.resources,recoveryReserve:patch.state&&patch.state!=="running"?undefined:r.recoveryReserve,updated:new Date().toISOString()});await complete;
  }
  /** A marker, rows, counters, and gene tier summaries commit in one short transaction. */
  async commit(run:string,layer:Layer,contrast:string,partition:string,sequence:number,rows:Link[],features?:StoredFeature[]){
    const writeStarted=performance.now();
    if(sequence%16===0&&navigator.storage?.estimate){const e=await navigator.storage.estimate();if(e.quota&&e.usage!==undefined&&e.quota-e.usage<Math.max(256*1024**2,e.quota*0.2))throw new DOMException("Browser origin storage headroom below 20% (at least 256 MiB reserved). Export/delete saved runs or use a smaller scope.","QuotaExceededError");}
    if(rows.length>WRITE_BATCH||(features?.length??0)>WRITE_BATCH)throw new Error("Write batch exceeds 500 records.");
    const serialized=JSON.stringify({rows,features});if(serialized.length*2>4*1024**2)throw new Error("Write batch exceeds 4 MiB estimate; narrow oversized feature identifiers.");
    const rowBytes=new TextEncoder().encode(JSON.stringify(rows));
    const codec=typeof CompressionStream!=="undefined"?"gzip":"json";
    const payload=codec==="gzip"?await new Response(new Blob([rowBytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer():rowBytes.buffer;
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(serialized));const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
    const t=this.db.transaction(["runs","rows","features","batches"],"readwrite",{durability:this.durability}),complete=done(t);
    try {
      const marker=[run,layer,contrast,partition,sequence];
      const old=await req(t.objectStore("batches").get(marker));
      if(old){if(old.hash!==hash)throw new Error("Checkpoint collision: batch content changed. Start a new run.");await complete;return false;}
      const r=await req(t.objectStore("runs").get(run)) as SavedRun|undefined;
      if(!r||r.state!=="running")throw new Error("This run is not writable. Start a new run; resume is not supported.");
      const addedBytes=serialized.length*2;
      if(r.bytes+addedBytes>r.budget)throw new DOMException("Configured local result budget exceeded; saved batches remain partial.","QuotaExceededError");
      const fs=t.objectStore("features");for(const f of features??[])fs.add(f);
      const counts=new Map<string,Record<string,number>>();
      for(const [position,row] of rows.entries()){
        const record:IndexedRow={run,layer,contrast,id:row.link_id,batchKey:marker,position,row:{chrom:row.chrom,enhancer_start:row.enhancer_start,enhancer_end:row.enhancer_end,enhancer_id:row.enhancer_id,evidence_tier:row.evidence_tier,morphology:row.morphology,gene_padj:row.gene_padj,enhancer_padj:row.enhancer_padj},gene:row.gene_id.toUpperCase(),symbol:row.gene_symbol.toUpperCase(),distanceValue:row.distance_bp,magnitudeValue:row.magnitude_gap_log2fc??Number.MAX_VALUE};
        t.objectStore("rows").add(record);
        const c=counts.get(row.gene_id)??{};c[row.evidence_tier]=(c[row.evidence_tier]??0)+1;c.total=(c.total??0)+1;counts.set(row.gene_id,c);
      }
      for(const [id,countsAdded] of counts){const key=[run,layer,contrast,"gene",id];const f=await req(fs.get(key)) as StoredFeature|undefined;if(!f)throw new Error(`Missing persisted gene feature: ${id}`);for(const [tier,n] of Object.entries(countsAdded))f.counts[tier]=(f.counts[tier]??0)+n;fs.put(f);}
      t.objectStore("batches").add({run,layer,contrast,partition,sequence,hash,rows:rows.length,bytes:addedBytes,codec,payload});
      t.objectStore("runs").put({...r,rows:r.rows+rows.length,bytes:r.bytes+addedBytes,batches:r.batches+1,writeMs:(r.writeMs??0)+performance.now()-writeStarted,updated:new Date().toISOString()});
      await complete;return true;
    }catch(error){try{t.abort();}catch{}await complete.catch(()=>{});throw error;}
  }
  sink(run:string,layer:Layer,contrast:string,signal?:AbortSignal,progress?:(message:string)=>void):ResultSink {
    return {partition:async(id,features,rows)=>{
      let sequence=0;
      if(features.chromosomeSizes){const r=await this.get(run);if(!r)throw new Error("Run deleted before chromosome persistence.");const all=(r.resources.savedChromosomeSizes??{}) as Record<string,Record<string,number>>,key=JSON.stringify([layer,contrast]);await this.update(run,{resources:{savedChromosomeSizes:{...all,[key]:{...all[key],...features.chromosomeSizes}}}});}
      const check=()=>{if(signal?.aborted)throw new DOMException("Cancelled; committed batches retained.","AbortError");};
      const featureRows:StoredFeature[]=[];
      const flush=async()=>{if(featureRows.length){check();await this.commit(run,layer,contrast,id,sequence++,[],featureRows.splice(0));if(sequence%16===0)progress?.(`${id} · persisting feature batch ${sequence}`);}};
      const stats=new Map(features.geneStats.map(s=>[s.featureId,s]));
      for(const g of features.genes){featureRows.push({run,layer,contrast,kind:"gene",id:g.geneId,value:g,stat:stats.get(g.geneId),counts:{}});if(featureRows.length===WRITE_BATCH)await flush();}await flush();
      for(const kind of ["enhancer","promoter"] as const){for(const v of kind==="enhancer"?features.enhancers:features.secondaryGeneStats??[]){featureRows.push({run,layer,contrast,kind,id:v.featureId,value:v,counts:{}});if(featureRows.length===WRITE_BATCH)await flush();}await flush();}
      let batch:Link[]=[],total=0;
      for(const row of rows){check();batch.push(row);total++;if(batch.length===WRITE_BATCH){await this.commit(run,layer,contrast,id,sequence++,batch);if(sequence%16===0)progress?.(`${id} · persisted ${total.toLocaleString()} candidate rows`);batch=[];}}
      if(batch.length){check();await this.commit(run,layer,contrast,id,sequence++,batch);}
      return total;
    }};
  }
  async delete(id:string){
    // Range deletion is atomic and does not materialize the saved rows.
    const names=["runs","rows","features","batches"],t=this.db.transaction(names,"readwrite"),complete=done(t);
    t.objectStore("runs").delete(id);for(const name of names.slice(1))t.objectStore(name).delete(IDBKeyRange.bound([id],[id,[]]));await complete;
  }
  async clear(){const t=this.db.transaction(["runs","rows","features","batches"],"readwrite"),complete=done(t);for(const n of t.objectStoreNames)t.objectStore(n).clear();await complete;}
  async *features(run:string,layer:Layer,kind:StoredFeature["kind"],contrast?:string){
    const prefix=[run,layer,kind,...contrast?[contrast]:[]];let after:IDBValidKey|undefined;
    while(true){const t=this.db.transaction("features"),s=t.objectStore("features").index("kind");const range=IDBKeyRange.bound(after??prefix,[...prefix,[]],!!after);const values=await req(s.getAll(range,WRITE_BATCH)) as StoredFeature[];if(!values.length)return;for(const f of values)yield f;const f=values.at(-1)!;after=[f.run,f.layer,f.kind,f.contrast,f.id];}
  }
  async *rows(run:string,layer:Layer,contrast?:string){
    // Sequential payload traversal avoids re-decoding a gene batch for every enhancer coordinate.
    const prefix=[run,layer,...contrast?[contrast]:[]];let after:IDBValidKey|undefined;
    while(true){const t=this.db.transaction("batches"),s=contrast?t.objectStore("batches"):t.objectStore("batches").index("export");
      const range=IDBKeyRange.bound(after??prefix,[...prefix,[]],!!after);
      // One batch at a time: no page of hundreds of compressed payloads is retained.
      const values=await req(s.getAll(range,1));if(!values.length)return;const b=values[0];
      if(b.rows){const rows=await decodeBatch(b);for(const row of rows)yield {run,layer,contrast:b.contrast,id:row.link_id,row,gene:row.gene_id.toUpperCase(),symbol:row.gene_symbol.toUpperCase(),distanceValue:row.distance_bp,magnitudeValue:row.magnitude_gap_log2fc??Number.MAX_VALUE} satisfies StoredRow;}
      after=contrast?[run,layer,b.contrast,b.partition,b.sequence]:[run,layer,b.partition,b.contrast,b.sequence];
    }
  }
}
export type Query = {run:string;layer:Layer;gene?:string;enhancer?:string;chrom?:string;start?:number;end?:number;contrast?:string;tier?:string;morphology?:string;statistical?:boolean;sort?:"order"|"distance"|"magnitude";after?:IDBValidKey;limit?:number};
export function rowKey(v:Pick<IndexedRow,"row"|"contrast"|"id"|"distanceValue"|"magnitudeValue">,sort:Query["sort"]="order"):IDBValidKey {return [...sort==="distance"?[v.distanceValue]:sort==="magnitude"?[v.magnitudeValue]:[],v.row.chrom,v.row.enhancer_start,v.contrast,v.id];}
export async function queryResults(db:IDBDatabase,q:Query){
  if([q.start,q.end].some(v=>v!==undefined&&(!Number.isSafeInteger(v)||v<0))||(q.start!==undefined&&q.end!==undefined&&q.end<=q.start))throw new Error("Coordinate filters require nonnegative integer start and exclusive end greater than start.");
  const limit=Math.min(100,Math.max(1,q.limit??100)),prefix:IDBValidKey[]=[q.run,q.layer];
  const filtered=!!(q.gene||q.enhancer||q.chrom||q.contrast||q.tier||q.morphology||q.statistical||q.start!==undefined||q.end!==undefined);
  const tx=db.transaction("rows"),store=tx.objectStore("rows"),rows:StoredRow[]=[];let total=0;
  if(!filtered){
    const index=store.index(q.sort??"order"),range=IDBKeyRange.bound(prefix,[...prefix,[]]);
    const count=req(index.count(range));const values=req(index.getAll(IDBKeyRange.bound(q.after?[...prefix,...q.after as IDBValidKey[]]:prefix,[...prefix,[]],!!q.after),limit)) as Promise<StoredRow[]>;
    return {rows:await hydrate(db,await values as unknown as IndexedRow[]),total:await count};
  }
  const gene=q.gene?.toUpperCase();const indexes=gene?["gene","symbol"]:[q.enhancer?"enhancer":q.chrom?"chrom":q.contrast?"contrast":q.tier?"tier":q.sort??"order"];
  const selectedFilters=[q.gene,q.enhancer,q.chrom,q.contrast,q.tier].filter(Boolean).length;
  if(selectedFilters===1&&!q.morphology&&!q.statistical&&q.start===undefined&&q.end===undefined&&(!q.sort||q.sort==="order")){
    let name=indexes[0],count:number|undefined;
    if(gene){const key=[...prefix,gene];const range=IDBKeyRange.bound(key,[...key,[]]);const a=await req(store.index("gene").count(range)),b=await req(store.index("symbol").count(range));if(a===0){name="symbol";count=b;}else if(b===0){name="gene";count=a;}}
    if(!gene||count!==undefined){
      const key=[...prefix,gene??q.enhancer??q.chrom??q.contrast??q.tier!];const index=store.index(name),range=IDBKeyRange.bound(key,[...key,[]]);const countPromise=count===undefined?req(index.count(range)):Promise.resolve(count);
      const after=q.after as IDBValidKey[]|undefined;
      const lower=after?[...key,...name==="contrast"?[after[0],after[1],after[3]]:name==="chrom"?after.slice(1):name==="enhancer"?after.slice(2):after]:key;
      const values=await req(index.getAll(IDBKeyRange.bound(lower,[...key,[]],!!after),limit)) as IndexedRow[];
      return {rows:await hydrate(db,values),total:await countPromise};
    }
  }
  for(const index of indexes){const key=[...prefix,...gene?[gene]:q.enhancer?[q.enhancer]:q.chrom?[q.chrom]:q.contrast?[q.contrast]:q.tier?[q.tier]:[]];
    await new Promise<void>((resolve,reject)=>{const r=store.index(index).openCursor(IDBKeyRange.bound(key,[...key,[]]));r.onerror=()=>reject(r.error);r.onsuccess=()=>{
      const c=r.result;if(!c){resolve();return;}const v=c.value as StoredRow;
      if(!(index==="symbol"&&v.gene===gene)&&matches(v,q)){total++;const key=rowKey(v,q.sort);if(!q.after||indexedDB.cmp(key,q.after)>0){let pos=0;while(pos<rows.length&&indexedDB.cmp(rowKey(rows[pos],q.sort),key)<0)pos++;if(pos<limit){rows.splice(pos,0,v);if(rows.length>limit)rows.pop();}}}
      c.continue();};});
  }
  return {rows:await hydrate(db,rows as unknown as IndexedRow[]),total};
}
function matches(v:Pick<IndexedRow,"row"|"contrast">,q:Query){const r=v.row;return (!q.chrom||r.chrom===q.chrom)&&(!q.contrast||v.contrast===q.contrast)&&(!q.tier||r.evidence_tier===q.tier)&&(!q.enhancer||r.enhancer_id===q.enhancer)&&(!q.morphology||r.morphology===q.morphology)&&(q.start===undefined||r.enhancer_end>q.start)&&(q.end===undefined||r.enhancer_start<q.end)&&(!q.statistical||(r.gene_padj!==null&&r.enhancer_padj!==null));}

/** At most 8 decoded batches (and <=8 MiB estimated UTF-16) cached per connection. */
const decoded=new WeakMap<IDBDatabase,Map<string,{rows:Link[];bytes:number}>>();
async function hydrate(db:IDBDatabase,values:IndexedRow[]):Promise<StoredRow[]>{
 let cache=decoded.get(db);if(!cache){cache=new Map();decoded.set(db,cache);}
 const result:StoredRow[]=[];
 for(const v of values){const key=JSON.stringify(v.batchKey);let entry=cache.get(key);
  if(!entry){const t=db.transaction("batches"),batch=await req(t.objectStore("batches").get(v.batchKey));if(!batch?.payload)throw new Error("Persisted batch payload missing. Results are incomplete/corrupt.");
   const rows=await decodeBatch(batch);entry={rows,bytes:JSON.stringify(rows).length*2};
   while(cache.size&&(cache.size>=8||[...cache.values()].reduce((n,e)=>n+e.bytes,0)+entry.bytes>8*1024**2))cache.delete(cache.keys().next().value!);
   cache.set(key,entry);
  }
  const row=entry.rows[v.position];if(!row||row.link_id!==v.id)throw new Error("Persisted candidate identity mismatch.");result.push({...v,row});
 }
 return result;
}

async function decodeBatch(batch:{codec:string;payload:ArrayBuffer;rows:number}):Promise<Link[]>{
 const raw=batch.codec==="gzip"?await new Response(new Blob([batch.payload]).stream().pipeThrough(new DecompressionStream("gzip"))).text():new TextDecoder().decode(batch.payload);
 if(raw.length*2>4*1024**2)throw new Error("Decoded result batch exceeds its validated limit.");
 const rows:Link[]=JSON.parse(raw);if(rows.length!==batch.rows||rows.length>WRITE_BATCH)throw new Error("Persisted batch row count mismatch.");return rows;
}
