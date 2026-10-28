/// <reference lib="webworker" />
import { ResultStore } from "@/lib/result-store";
import { runExperiment } from "@/lib/run-experiment";
import type { Experiment } from "@/lib/experiment";
import type { Parameters } from "@/lib/analysis";
const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (event: MessageEvent<{experiment:Experiment;files:Record<string,File>;parameters:Parameters;runId?:string}>) => {
  let store:ResultStore|undefined;let claimed=false;
  try {
    const {experiment,files,parameters,runId}=event.data;
    if(runId){store=await ResultStore.open();await store.claimFresh(runId,experiment,parameters,files);claimed=true;}
    const result=await runExperiment(experiment,files,parameters,message=>scope.postMessage(message),undefined,undefined,store&&runId?{sink:(c,l)=>store!.sink(runId,l,c,undefined,message=>scope.postMessage({type:"progress",contrastId:c,message})),record:async(outcomes)=>{await store!.update(runId,{outcomes});},snapshot:async()=>{const r=await store!.get(runId);if(!r)throw new Error("Saved run was deleted during analysis.");return r;}}:undefined);
    if(store&&runId){const successes=result.outcomes.filter(o=>o.status==="successful").length;await store.update(runId,{outcomes:result.outcomes,resources:result.resources,state:result.outcomes.some(o=>["failed","cancelled","incomplete"].includes(o.status))?(successes?"partial":"failed"):"complete"});}
    scope.postMessage({type:"complete",resources:result.resources,summary:{successful:result.outcomes.filter(o=>o.status==="successful").length,failed:result.outcomes.filter(o=>o.status==="failed").length}});
  }catch(error){if(claimed&&store&&event.data.runId)await store.update(event.data.runId,{state:"failed",note:"Worker failed; committed rows may be incomplete."}).catch(()=>{});scope.postMessage({type:"error",error:error instanceof Error?error.message:String(error)});}
  finally{store?.close();}
};
export {};
