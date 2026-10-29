/// <reference lib="webworker" />
import {ResultStore,queryResults} from "@/lib/result-store";
const scope=self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage=async(e:MessageEvent<{run:string;gene:string;contrast:string;layer:"primary"|"track"}>)=>{
 let s:ResultStore|undefined;try{s=await ResultStore.open();const result=await queryResults(s.db,{...e.data,limit:100,sort:"order"});scope.postMessage({rows:result.rows.map(v=>v.row),total:result.total});}catch(error){scope.postMessage({error:error instanceof Error?error.message:String(error)});}finally{s?.close();}
};
export {};
