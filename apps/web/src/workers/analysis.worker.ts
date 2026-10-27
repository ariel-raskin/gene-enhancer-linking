/// <reference lib="webworker" />
import { executeAnalysis, type AnalysisRequest } from "@/lib/execute-analysis";
const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (event: MessageEvent<AnalysisRequest>) => {
  const req = event.data;
  try {
    const result = await executeAnalysis(req, (message) => scope.postMessage({ id: req.id, type: "progress", message }));
    scope.postMessage({ id: req.id, type: "complete", result });
  } catch (error) { scope.postMessage({ id: req.id, type: "error", error: error instanceof Error ? error.message : String(error) }); }
};
export {};
