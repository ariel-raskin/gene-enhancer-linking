/// <reference lib="webworker" />
import { inspectBigWigScope } from "@/lib/chunked-bigwig";
import type { BigWigRequest } from "@/lib/bigwig";
const scope:DedicatedWorkerGlobalScope=self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage=async(event:MessageEvent<BigWigRequest>)=>{try{scope.postMessage({result:await inspectBigWigScope(event.data)});}catch(e){scope.postMessage({error:e instanceof Error?e.message:String(e)});}};
export {};
