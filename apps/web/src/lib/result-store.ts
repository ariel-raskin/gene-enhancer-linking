import type { Differential, Gene, Link, Parameters } from "./analysis";
import type { Experiment, Outcome } from "./experiment";

export const RESULT_DB = "gel-results-v1";
export const STORE_SCHEMA = 2;
export const WRITE_BATCH = 1000;
export const DEFAULT_WRITE_BATCH = 500;
export const DEFAULT_DISK_BUDGET = 4 * 1024 ** 3;
export type RunState = "running" | "complete" | "cancelled" | "failed" | "partial";
export type Layer = "primary" | "track";
export type SavedRun = { id:string; schema:1|2; storageKey?:number; created:string; updated:string; state:RunState; experiment:Experiment; parameters:Parameters; outcomes:Outcome[]; rows:number; bytes:number; batches:number; budget:number; executionStarted?:boolean; batchRows?:number; writeMs?:number; resources:Record<string,unknown>; note?:string; recoveryReserve?:string };
export type StoredRow = { run:string; layer:Layer; contrast:string; id:string; row:Link; symbol:string; gene:string; distanceValue:number; magnitudeValue:number };
type IndexedRow = Omit<StoredRow,"row"> & {row:Pick<Link,"chrom"|"enhancer_start"|"enhancer_end"|"enhancer_id"|"evidence_tier"|"morphology"|"gene_padj"|"enhancer_padj">;batchKey:IDBValidKey[];position:number};
export type StoredFeature = {run:string;layer:Layer;contrast:string;kind:"gene"|"enhancer"|"promoter";id:string;value:Gene|Differential;stat?:Differential;counts:Record<string,number>};
export type ResultPartition = {genes:Gene[];geneStats:Differential[];enhancers:Differential[];secondaryGeneStats?:Differential[];chromosomeSizes?:Record<string,number>};
export interface ResultSink { partition(id:string,features:ResultPartition,rows:Iterable<Link>):Promise<number> }
const req = <T>(r:IDBRequest<T>) => new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const done = (t:IDBTransaction) => new Promise<void>((resolve,reject)=>{t.oncomplete=()=>resolve();t.onabort=()=>reject(t.error??new Error("Storage transaction aborted; no batch committed."));t.onerror=()=>{/* onabort carries transaction failure */};});
export async function openResults(databaseName=RESULT_DB) {
  const r=indexedDB.open(databaseName,STORE_SCHEMA);
  r.onupgradeneeded=()=>{
    const db=r.result;
    if(!db.objectStoreNames.contains("runs")){
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
    }
    // Additive upgrade: v0.6 records and indexes stay intact and are read through their original layout.
    const keys=db.createObjectStore("runKeys",{keyPath:"n",autoIncrement:true});keys.createIndex("id","id",{unique:true});
    const compact=db.createObjectStore("rowIndex",{keyPath:["r","ordinal"]});
    compact.createIndex("identity",["r","layer","contrast","id"],{unique:true});
    for(const [name,fields] of Object.entries({order:["row.chrom","row.enhancer_start","contrast","id"],distance:["distanceValue","row.chrom","row.enhancer_start","contrast","id"],magnitude:["magnitudeValue","row.chrom","row.enhancer_start","contrast","id"],gene:["gene","row.chrom","row.enhancer_start","contrast","id"],symbol:["symbol","row.chrom","row.enhancer_start","contrast","id"],enhancer:["row.enhancer_id","contrast","id"],contrast:["contrast","row.chrom","row.enhancer_start","id"],tier:["row.evidence_tier","row.chrom","row.enhancer_start","contrast","id"]}))compact.createIndex(name,["r","layer",...fields]);
  };
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{
    let settled=false;const timer=setTimeout(()=>{settled=true;reject(new Error("Local storage did not open within 10 seconds. Close other GEL tabs or check browser storage permissions."));},10000);
    r.onsuccess=()=>{clearTimeout(timer);if(settled)r.result.close();else{settled=true;resolve(r.result);}};
    r.onerror=()=>{clearTimeout(timer);if(!settled){settled=true;reject(r.error);}};
    r.onblocked=()=>{clearTimeout(timer);if(!settled){settled=true;reject(new Error("Local result schema upgrade is blocked by another tab. Close other GEL tabs and reload."));}};
  });db.onversionchange=()=>db.close();return db;
}
function recordBytes(value:unknown){
  const inspect=(v:unknown)=>{if(typeof v==="string"&&v.length>65536)throw new Error("A result field exceeds 64 KiB characters. Use compact stable feature identifiers; no rows were truncated.");if(v&&typeof v==="object")for(const x of Object.values(v))inspect(x);};inspect(value);
  const size=JSON.stringify(value).length*2;if(size>2*1024**2)throw new Error("A result record exceeds the 2 MiB byte budget.");return size;
}
export class ResultStore {
  readonly profile:Record<string,number>={};
  constructor(readonly db:IDBDatabase,readonly durability:IDBTransactionDurability="strict"){}
  private transaction(stores:string|string[],mode:IDBTransactionMode="readonly",options?:IDBTransactionOptions){
    this.profile.classTransactions=(this.profile.classTransactions??0)+1;const key=mode==="readwrite"?"classWriteTransactions":"classReadTransactions";this.profile[key]=(this.profile[key]??0)+1;return this.db.transaction(stores,mode,options);
  }
  static async open(){return new ResultStore(await openResults());}
  close(){this.db.close();}
  async get(id:string){const t=this.transaction("runs");return req(t.objectStore("runs").get(id)) as Promise<SavedRun|undefined>;}
  async list(){const t=this.transaction("runs");return (await req(t.objectStore("runs").getAll()) as SavedRun[]).sort((a,b)=>b.created.localeCompare(a.created));}
  async create(experiment:Experiment,parameters:Parameters,budget=DEFAULT_DISK_BUDGET,batchRows=DEFAULT_WRITE_BATCH){
    if(!Number.isInteger(batchRows)||batchRows<100||batchRows>WRITE_BATCH)throw new Error("Choose write batches of 100–1000 records.");
    if(!Number.isSafeInteger(budget)||budget<1024)throw new Error("Invalid local result byte budget.");
    const now=new Date().toISOString();const run:SavedRun={id:crypto.randomUUID(),schema:2,created:now,updated:now,state:"running",experiment,parameters,outcomes:[],rows:0,bytes:0,batches:0,budget,batchRows,executionStarted:false,resources:{},recoveryReserve:" ".repeat(65536)};
    const t=this.transaction(["runs","runKeys"],"readwrite");const complete=done(t);try{if(await req(t.objectStore("runs").count())>=50)throw new Error("At most 50 saved runs; export/delete older local results before starting another run.");run.storageKey=await req(t.objectStore("runKeys").add({id:run.id})) as number;t.objectStore("runs").add(run);await complete;return run;}catch(error){try{t.abort();}catch{}await complete.catch(()=>{});throw error;}
  }
  async claimFresh(id:string,experiment:Experiment,parameters:Parameters,files?:Record<string,File>){
    const t=this.transaction("runs","readwrite"),complete=done(t),store=t.objectStore("runs");
    try{const r=await req(store.get(id)) as SavedRun|undefined;
      if(!r||r.schema!==STORE_SCHEMA||r.state!=="running"||r.executionStarted!==false||r.rows!==0||r.batches!==0)throw new Error("This run cannot be resumed or started twice. Create a new run with selected source files.");
      if(JSON.stringify(r.experiment)!==JSON.stringify(experiment)||JSON.stringify(r.parameters)!==JSON.stringify(parameters))throw new Error("Run configuration differs from its frozen manifest; start a new run.");
      if(files)for(const f of experiment.files){const file=files[f.id];if(!file||file.size!==f.size||file.lastModified!==f.lastModified)throw new Error("Selected file metadata differ from the new run manifest. Reimport and create a new run; these checks do not establish resumable file identity.");}
      store.put({...r,executionStarted:true,updated:new Date().toISOString()});await complete;
    }catch(error){try{t.abort();}catch{}await complete.catch(()=>{});throw error;}
  }
  async update(id:string,patch:Partial<Pick<SavedRun,"state"|"outcomes"|"resources"|"note">>){
    const t=this.transaction("runs","readwrite"),complete=done(t),s=t.objectStore("runs"),r=await req(s.get(id)) as SavedRun|undefined;
    if(!r){t.abort();await complete;return;}
    s.put({...r,...patch,resources:patch.resources?{...r.resources,...patch.resources}:r.resources,recoveryReserve:patch.state&&patch.state!=="running"?undefined:r.recoveryReserve,updated:new Date().toISOString()});await complete;
  }
  /** A marker, rows, counters, and gene tier summaries commit in one short transaction. */
  async commit(run:string,layer:Layer,contrast:string,partition:string,sequence:number,rows:Link[],features?:StoredFeature[]){
    const writeStarted=performance.now();let stamp=writeStarted;
    const add=(key:string,n:number)=>{this.profile[key]=(this.profile[key]??0)+n;};
    const mark=(key:string)=>{const now=performance.now();add(key,now-stamp);stamp=now;};add("calls",1);
    if(sequence%16===0&&navigator.storage?.estimate){const e=await navigator.storage.estimate();if(e.quota&&e.usage!==undefined&&e.quota-e.usage<Math.max(256*1024**2,e.quota*0.2))throw new DOMException("Browser origin storage headroom below 20% (at least 256 MiB reserved). Export/delete saved runs or use a smaller scope.","QuotaExceededError");}
    mark("quotaWallMs");
    if(rows.length>WRITE_BATCH||(features?.length??0)>WRITE_BATCH)throw new Error("Write batch exceeds 1000 records.");
    let estimated=128;for(const value of [...rows,...features??[]]){estimated+=recordBytes(value);if(estimated>4*1024**2)throw new Error("Write batch exceeds the pre-serialization byte budget.");}
    const serialized=JSON.stringify({rows,features});if(serialized.length*2>4*1024**2)throw new Error("Write batch exceeds 4 MiB estimate; narrow oversized feature identifiers.");
    mark("validationSerializationMs");const rowBytes=new TextEncoder().encode(JSON.stringify(rows));
    const payloadHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",rowBytes)),b=>b.toString(16).padStart(2,"0")).join("");
    mark("rowEncodingHashMs");
    const codec=typeof CompressionStream!=="undefined"?"gzip":"json";
    const payload=codec==="gzip"?await new Response(new Blob([rowBytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer():rowBytes.buffer;
    mark("compressionWallMs");add("payloadBytes",payload.byteLength);add("encodedBytes",rowBytes.byteLength);this.profile.peakBuffersEstimate=Math.max(this.profile.peakBuffersEstimate??0,serialized.length*2+rowBytes.byteLength+payload.byteLength);
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(serialized));const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");mark("checkpointHashMs");
    const t=this.transaction(["runs","rowIndex","features","batches"],"readwrite",{durability:this.durability}),complete=done(t);
    mark("transactionCreateMs");add("transactions",1);
    try {
      const marker=[run,layer,contrast,partition,sequence];
      const old=await req(t.objectStore("batches").get(marker));
      if(old){if(old.hash!==hash)throw new Error("Checkpoint collision: batch content changed. Start a new run.");await complete;mark("retryWaitMs");add("commitWallMs",performance.now()-writeStarted);return false;}
      const r=await req(t.objectStore("runs").get(run)) as SavedRun|undefined;
      if(r?.schema!==2||!r.storageKey)throw new Error("Legacy v0.6 runs are retained read-only. Create a new run; source-validated resume is not supported.");
      if(!r||r.state!=="running")throw new Error("This run is not writable. Start a new run; resume is not supported.");
      const addedBytes=serialized.length*2;
      if(r.bytes+addedBytes>r.budget)throw new DOMException("Configured local result budget exceeded; saved batches remain partial.","QuotaExceededError");
      mark("checkpointRunReadWaitMs");const fs=t.objectStore("features");for(const f of features??[])fs.add(f);add("featureAdds",features?.length??0);mark("featureEnqueueMs");
      const counts=new Map<string,Record<string,number>>();let enqueueEnd=0;
      for(const [position,row] of rows.entries()){
        const record:IndexedRow={run,layer,contrast,id:row.link_id,batchKey:marker,position,row:{chrom:row.chrom,enhancer_start:row.enhancer_start,enhancer_end:row.enhancer_end,enhancer_id:row.enhancer_id,evidence_tier:row.evidence_tier,morphology:row.morphology,gene_padj:row.gene_padj,enhancer_padj:row.enhancer_padj},gene:row.gene_id.toUpperCase(),symbol:row.gene_symbol.toUpperCase(),distanceValue:row.distance_bp,magnitudeValue:row.magnitude_gap_log2fc??Number.MAX_VALUE};
        const pending=t.objectStore("rowIndex").add({...record,r:r.storageKey,ordinal:r.rows+position});if(position===rows.length-1)pending.onsuccess=()=>add("rowDrainNestedMs",performance.now()-enqueueEnd);
        const c=counts.get(row.gene_id)??{};c[row.evidence_tier]=(c[row.evidence_tier]??0)+1;c.total=(c.total??0)+1;counts.set(row.gene_id,c);
      }
      enqueueEnd=performance.now();mark("projectionEnqueueMs");add("attemptedRows",rows.length);add("rowIndexEntries",rows.length*t.objectStore("rowIndex").indexNames.length);add("summaryReads",counts.size);
      const updates=await Promise.all([...counts].map(async([id,delta])=>({id,delta,f:await req(fs.get([run,layer,contrast,"gene",id])) as StoredFeature|undefined})));
      for(const {id,delta,f} of updates){if(!f)throw new Error(`Missing persisted gene feature: ${id}`);for(const [tier,n] of Object.entries(delta))f.counts[tier]=(f.counts[tier]??0)+n;fs.put(f);}
      mark("queuedRowsAndSummaryWaitMs");add("summaryPuts",updates.length);
      t.objectStore("batches").add({run,layer,contrast,partition,sequence,hash,rows:rows.length,bytes:addedBytes,codec,payload,payloadHash,partitionComplete:sequence===Number.MAX_SAFE_INTEGER});
      t.objectStore("runs").put({...r,rows:r.rows+rows.length,bytes:r.bytes+addedBytes,batches:r.batches+1,writeMs:(r.writeMs??0)+performance.now()-writeStarted,updated:new Date().toISOString()});
      mark("metadataEnqueueMs");await complete;mark("commitWaitMs");add("commitWallMs",performance.now()-writeStarted);add("committedRows",rows.length);return true;
    }catch(error){try{t.abort();}catch{}await complete.catch(()=>{});mark("failedWaitMs");add("failedTransactions",1);add("commitWallMs",performance.now()-writeStarted);throw error;}
  }
  sink(run:string,layer:Layer,contrast:string,signal?:AbortSignal,progress?:(message:string)=>void):ResultSink {
    return {partition:async(id,features,rows)=>{
      const partitionStart=performance.now();const sized=(value:unknown)=>{const at=performance.now(),n=recordBytes(value);this.profile.packingValidationMs=(this.profile.packingValidationMs??0)+performance.now()-at;return n;};
      let sequence=0;const batchRows=(await this.get(run))?.batchRows??DEFAULT_WRITE_BATCH;
      if(!Number.isInteger(batchRows)||batchRows<100||batchRows>WRITE_BATCH)throw new Error("Saved write-batch configuration is invalid.");
      if(features.chromosomeSizes){const r=await this.get(run);if(!r)throw new Error("Run deleted before chromosome persistence.");const all=(r.resources.savedChromosomeSizes??{}) as Record<string,Record<string,number>>,key=JSON.stringify([layer,contrast]);await this.update(run,{resources:{savedChromosomeSizes:{...all,[key]:{...all[key],...features.chromosomeSizes}}}});}
      const check=()=>{if(signal?.aborted)throw new DOMException("Cancelled; committed batches retained.","AbortError");};
      const featureRows:StoredFeature[]=[];let featureBytes=0;
      const flush=async()=>{if(featureRows.length){check();await this.commit(run,layer,contrast,id,sequence++,[],featureRows.splice(0));featureBytes=0;if(sequence%16===0){await this.update(run,{resources:{storageProfile:{...this.profile}}});progress?.(`${id} · persisting feature batch ${sequence}`);}}};
      const pushFeature=async(f:StoredFeature)=>{const size=sized(f);if(featureRows.length&&featureBytes+size>2*1024**2)await flush();featureRows.push(f);featureBytes+=size;if(featureRows.length===batchRows)await flush();};
      const stats=new Map(features.geneStats.map(s=>[s.featureId,s]));
      for(const g of features.genes){await pushFeature({run,layer,contrast,kind:"gene",id:g.geneId,value:g,stat:stats.get(g.geneId),counts:{}});}await flush();
      for(const kind of ["enhancer","promoter"] as const){for(const v of kind==="enhancer"?features.enhancers:features.secondaryGeneStats??[]){await pushFeature({run,layer,contrast,kind,id:v.featureId,value:v,counts:{}});}await flush();}
      let batch:Link[]=[],total=0,batchBytes=0;
      const flushLinks=async()=>{if(!batch.length)return;check();await this.commit(run,layer,contrast,id,sequence++,batch);if(sequence%16===0){await this.update(run,{resources:{storageProfile:{...this.profile}}});progress?.(`${id} · persisted ${total.toLocaleString()} candidate rows`);}batch=[];batchBytes=0;};
      const observed=(function*(owner:ResultStore){const iterator=rows[Symbol.iterator]();while(true){const at=performance.now(),next=iterator.next();owner.profile.generationMs=(owner.profile.generationMs??0)+performance.now()-at;if(next.done)return;yield next.value;}})(this);
      for(const row of observed){check();const size=sized(row);if(batch.length&&batchBytes+size>2*1024**2)await flushLinks();batch.push(row);batchBytes+=size;total++;if(batch.length===batchRows)await flushLinks();}
      await flushLinks();
      check();await this.commit(run,layer,contrast,id,Number.MAX_SAFE_INTEGER,[],[]);
      this.profile.partitionWallMs=(this.profile.partitionWallMs??0)+performance.now()-partitionStart;await this.update(run,{resources:{storageProfile:{...this.profile}}});
      return total;
    }};
  }
  async assertSnapshot(snapshot:SavedRun){const live=await this.get(snapshot.id);if(!live||live.updated!==snapshot.updated||live.rows!==snapshot.rows||live.state!==snapshot.state)throw new Error("Saved run was deleted or changed during export; destination not finalized.");}
  async delete(id:string){
    // Range deletion is atomic and does not materialize the saved rows.
    const names=["runs","rows","features","batches","rowIndex","runKeys"],t=this.transaction(names,"readwrite"),complete=done(t);
    const r=await req(t.objectStore("runs").get(id)) as SavedRun|undefined;
    t.objectStore("runs").delete(id);for(const name of ["rows","features","batches"])t.objectStore(name).delete(IDBKeyRange.bound([id],[id,[]]));if(r?.storageKey){t.objectStore("rowIndex").delete(IDBKeyRange.bound([r.storageKey],[r.storageKey,[]]));t.objectStore("runKeys").delete(r.storageKey);}await complete;
  }
  async clear(){const t=this.transaction(["runs","rows","features","batches","rowIndex","runKeys"],"readwrite"),complete=done(t);for(const n of t.objectStoreNames)t.objectStore(n).clear();await complete;}
  async *features(run:string,layer:Layer,kind:StoredFeature["kind"],contrast?:string,stable=false){
    const frozen=stable?await this.get(run):undefined;if(stable&&(!frozen||frozen.state==="running"))throw new Error("Export requires a stable saved run.");
    const prefix=[run,layer,kind,...contrast?[contrast]:[]];let after:IDBValidKey|undefined;
    while(true){if(frozen)await this.assertSnapshot(frozen);const t=this.transaction("features"),s=t.objectStore("features").index("kind");const range=IDBKeyRange.bound(after??prefix,[...prefix,[]],!!after);const values=await req(s.getAll(range,WRITE_BATCH)) as StoredFeature[];if(!values.length)return;for(const f of values)yield f;const f=values.at(-1)!;after=[f.run,f.layer,f.kind,f.contrast,f.id];}
  }
  async *rows(run:string,layer:Layer,contrast?:string){
    const frozen=await this.get(run);if(!frozen||frozen.state==="running")throw new Error("Export requires a stable saved run.");
    const layout=layoutOf(frozen),countTx=this.transaction(layout.store),countIndex=countTx.objectStore(layout.store).index(contrast?"contrast":"order"),countPrefix=[layout.prefix,layer,...contrast?[contrast]:[]];const expected=await req(countIndex.count(IDBKeyRange.bound(countPrefix,[...countPrefix,[]])));let emitted=0;
    // Sequential payload traversal avoids re-decoding a gene batch for every enhancer coordinate.
    const prefix=[run,layer,...contrast?[contrast]:[]];let after:IDBValidKey|undefined;
    while(true){await this.assertSnapshot(frozen);const t=this.transaction("batches"),s=contrast?t.objectStore("batches"):t.objectStore("batches").index("export");
      const range=IDBKeyRange.bound(after??prefix,[...prefix,[]],!!after);
      // One batch at a time: no page of hundreds of compressed payloads is retained.
      const values=await req(s.getAll(range,1));if(!values.length){if(emitted!==expected)throw new Error("Saved row/batch count mismatch; export aborted.");return;}const b=values[0];
      if(b.rows){const rows=await decodeBatch(b);for(const row of rows){emitted++;yield {run,layer,contrast:b.contrast,id:row.link_id,row,gene:row.gene_id.toUpperCase(),symbol:row.gene_symbol.toUpperCase(),distanceValue:row.distance_bp,magnitudeValue:row.magnitude_gap_log2fc??Number.MAX_VALUE} satisfies StoredRow;}}
      after=contrast?[run,layer,b.contrast,b.partition,b.sequence]:[run,layer,b.partition,b.contrast,b.sequence];
    }
  }
}
export type Query = {run:string;layer:Layer;gene?:string;enhancer?:string;chrom?:string;start?:number;end?:number;contrast?:string;contrastIds?:string[];tier?:string;morphology?:string;statistical?:boolean;sort?:"order"|"distance"|"magnitude";after?:IDBValidKey;limit?:number};
function layoutOf(run:SavedRun){if(run.schema===1)return {store:"rows",prefix:run.id};if(run.schema===2&&run.storageKey)return {store:"rowIndex",prefix:run.storageKey};throw new Error("Unsupported saved-result schema; existing data were not changed.");}
export function rowKey(v:Pick<IndexedRow,"row"|"contrast"|"id"|"distanceValue"|"magnitudeValue">,sort:Query["sort"]="order"):IDBValidKey {return [...sort==="distance"?[v.distanceValue]:sort==="magnitude"?[v.magnitudeValue]:[],v.row.chrom,v.row.enhancer_start,v.contrast,v.id];}
export async function queryResults(db:IDBDatabase,q:Query):Promise<{rows:StoredRow[];total:number}>{
  if(q.contrastIds){
    const ids=[...new Set(q.contrastIds)];if(ids.length>24)throw new Error("At most 24 contrast filters per query.");
    if(!ids.length||(q.contrast&&!ids.includes(q.contrast)))return {rows:[],total:0};
    if(!q.contrast){let total=0;const rows:StoredRow[]=[];const limit=Math.min(100,Math.max(1,q.limit??100));for(const contrast of ids){const part=await queryResults(db,{...q,contrast,contrastIds:undefined});total+=part.total;for(const v of part.rows){const key=rowKey(v,q.sort);let at=0;while(at<rows.length&&indexedDB.cmp(rowKey(rows[at],q.sort),key)<0)at++;if(at<limit){rows.splice(at,0,v);if(rows.length>limit)rows.pop();}}}return {rows,total};}
  }
  if([q.start,q.end].some(v=>v!==undefined&&(!Number.isSafeInteger(v)||v<0))||(q.start!==undefined&&q.end!==undefined&&q.end<=q.start))throw new Error("Coordinate filters require nonnegative integer start and exclusive end greater than start.");
  const run=await req(db.transaction("runs").objectStore("runs").get(q.run)) as SavedRun|undefined;if(!run)return {rows:[],total:0};const layout=layoutOf(run);
  const limit=Math.min(100,Math.max(1,q.limit??100)),prefix:IDBValidKey[]=[layout.prefix,q.layer];
  const filtered=!!(q.gene||q.enhancer||q.chrom||q.contrast||q.tier||q.morphology||q.statistical||q.start!==undefined||q.end!==undefined);
  const tx=db.transaction(layout.store),store=tx.objectStore(layout.store),indexOf=(name:string)=>store.index(layout.store==="rowIndex"&&name==="chrom"?"order":name),rows:StoredRow[]=[];let total=0;
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
      const key=[...prefix,gene??q.enhancer??q.chrom??q.contrast??q.tier!];const index=indexOf(name),range=IDBKeyRange.bound(key,[...key,[]]);const countPromise=count===undefined?req(index.count(range)):Promise.resolve(count);
      const after=q.after as IDBValidKey[]|undefined;
      const lower=after?[...key,...name==="contrast"?[after[0],after[1],after[3]]:name==="chrom"?after.slice(1):name==="enhancer"?after.slice(2):after]:key;
      const values=await req(index.getAll(IDBKeyRange.bound(lower,[...key,[]],!!after),limit)) as IndexedRow[];
      return {rows:await hydrate(db,values),total:await countPromise};
    }
  }
  for(const index of indexes){const key=[...prefix,...gene?[gene]:q.enhancer?[q.enhancer]:q.chrom?[q.chrom]:q.contrast?[q.contrast]:q.tier?[q.tier]:[]];
    await new Promise<void>((resolve,reject)=>{const r=indexOf(index).openCursor(IDBKeyRange.bound(key,[...key,[]]));r.onerror=()=>reject(r.error);r.onsuccess=()=>{
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
 for(const v of values){if(v.batchKey[0]!==v.run||v.batchKey[1]!==v.layer||v.batchKey[2]!==v.contrast)throw new Error("Persisted batch provenance mismatch.");const key=JSON.stringify(v.batchKey);let entry=cache.get(key);
  if(!entry){const t=db.transaction("batches"),batch=await req(t.objectStore("batches").get(v.batchKey));if(!batch?.payload)throw new Error("Persisted batch payload missing. Results are incomplete/corrupt.");
   const rows=await decodeBatch(batch);entry={rows,bytes:JSON.stringify(rows).length*2};
   while(cache.size&&(cache.size>=8||[...cache.values()].reduce((n,e)=>n+e.bytes,0)+entry.bytes>8*1024**2))cache.delete(cache.keys().next().value!);
   cache.set(key,entry);
  }
  const row=entry.rows[v.position];if(!row||row.link_id!==v.id)throw new Error("Persisted candidate identity mismatch.");result.push({...v,row});
 }
 return result;
}

async function decodeBatch(batch:{codec:string;payload:ArrayBuffer;rows:number;payloadHash?:string}):Promise<Link[]>{
 const stream=batch.codec==="gzip"?new Blob([batch.payload]).stream().pipeThrough(new DecompressionStream("gzip")):new Blob([batch.payload]).stream();
 const reader=stream.getReader(),decoder=new TextDecoder();let raw="",bytes=0;
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;raw+=decoder.decode(part.value,{stream:true});if(bytes>8*1024**2||raw.length*2>4*1024**2)throw new Error("Decoded result batch exceeds its validated limit.");}raw+=decoder.decode();}catch(error){await reader.cancel(error).catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(raw.length*2>4*1024**2)throw new Error("Decoded result batch exceeds its validated limit.");
 if(batch.payloadHash){const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw))),b=>b.toString(16).padStart(2,"0")).join("");if(hash!==batch.payloadHash)throw new Error("Persisted scientific payload checksum mismatch.");}
 const rows:Link[]=JSON.parse(raw);if(rows.length!==batch.rows||rows.length>WRITE_BATCH)throw new Error("Persisted batch row count mismatch.");return rows;
}
