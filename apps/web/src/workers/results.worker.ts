/// <reference lib="webworker" />
import {ResultStore,queryResults,type Query} from "@/lib/result-store";
import {featureSummary,persistentArtifacts} from "@/lib/persistent-exports";
import {streamZip,type ByteSink} from "@/lib/streaming-zip";
const scope=self as unknown as DedicatedWorkerGlobalScope;
let cancelled=false;
scope.onmessage=async(e:MessageEvent<{action:string;runId:string;query?:Query;fileKey?:string;handle?:FileSystemFileHandle}>)=>{
 if(e.data.action==="cancel"){cancelled=true;return;}
 let store:ResultStore|undefined;
 try{
  store=await ResultStore.open();
  const {action,runId}=e.data,run=await store.get(runId);if(!run)throw new Error("Saved run no longer exists.");
  if(action==="query"){
   const q=e.data.query!;const result=await queryResults(store.db,q);const summaries:ReturnType<typeof featureSummary>[]=[];let summaryTotal=0;
   for await(const f of store.features(runId,q.layer,"gene",q.contrast)){const g=featureSummary(f);if((!q.contrastIds||q.contrastIds.includes(f.contrast))&&(!q.gene||[g.gene_id,g.gene_symbol].some(s=>s.toUpperCase()===q.gene!.toUpperCase()))&&(!q.chrom||(f.value as {chrom:string}).chrom===q.chrom)){summaryTotal++;if(summaries.length<100)summaries.push(g);}}
   scope.postMessage({type:"page",...result,run,summaries,summaryTotal});
  }else if(action==="export"){
   if(run.state==="running")throw new Error("Finish or mark the run interrupted before exporting.");cancelled=false;
   const buffers:Uint8Array<ArrayBuffer>[]=[];let size=0;const handle=e.data.handle;const file=handle?await handle.createWritable():undefined;
   const check=()=>{if(cancelled)throw new DOMException("Export cancelled; destination not finalized.","AbortError");};
   const sink:ByteSink={write:async(bytes)=>{check();size+=bytes.byteLength;if(file)await file.write(bytes as Uint8Array<ArrayBuffer>);else{if(size>64*1024**2)throw new Error("Download fallback exceeds 64 MiB. Use Save ZIP directly to disk, or export a smaller individual table.");buffers.push(new Uint8Array(bytes));}},close:async()=>{check();await store!.assertSnapshot(run);await file?.close();},abort:async(reason)=>{buffers.length=0;await file?.abort(reason);}};
   let written=0;
   if(e.data.fileKey){try{let found=false;for await(const item of persistentArtifacts(store,run))if(item.name===e.data.fileKey){found=true;for await(const bytes of item.data){await sink.write(bytes);written+=bytes.length;}break;}if(!found)throw new Error("Requested export not found.");await sink.close();}catch(error){await sink.abort(error);throw error;}}
   else written=await streamZip(persistentArtifacts(store,run),sink,(bytes,name)=>scope.postMessage({type:"progress",message:`Exported ${name} · ${(bytes/1024**2).toFixed(1)} MiB`}));
   scope.postMessage({type:"exported",name:e.data.fileKey?.split("/").at(-1)??"gel-experiment.zip",bytes:written,strategy:handle?"direct filesystem stream":"bounded whole-Blob fallback (64 MiB)",blob:handle?undefined:new Blob(buffers)});
  }
 }catch(error){scope.postMessage({type:"error",error:error instanceof Error?error.message:String(error)});}finally{store?.close();}
};
export {};
