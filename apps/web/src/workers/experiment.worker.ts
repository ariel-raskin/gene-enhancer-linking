/// <reference lib="webworker" />
import { runExperiment } from "@/lib/run-experiment";
import type { Experiment } from "@/lib/experiment";
import type { Parameters } from "@/lib/analysis";
const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (event: MessageEvent<{experiment:Experiment;files:Record<string,File>;parameters:Parameters}>) => {
  try { const result = await runExperiment(event.data.experiment,event.data.files,event.data.parameters,(message)=>scope.postMessage(message)); scope.postMessage({type:"complete",resources:result.resources,summary:{successful:result.outcomes.filter(o=>o.status==="successful").length,failed:result.outcomes.filter(o=>o.status==="failed").length}}); }
  catch(error){scope.postMessage({type:"error",error:error instanceof Error?error.message:String(error)});}
};
export {};
