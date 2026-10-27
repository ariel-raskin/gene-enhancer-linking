/// <reference lib="webworker" />
import JSZip from "jszip";
import { type Parameters } from "@/lib/analysis";
import { makeArtifacts, type ExportInput } from "@/lib/exports";

import { experimentBlobArtifacts } from "@/lib/bounded-exports";
import type { Experiment, Outcome } from "@/lib/experiment";

type Message = { id: string; kind: "zip" | "file"; fileKey?: string; result: ExportInput; parameters: Parameters; provenance: Record<string, unknown> };
type ExperimentMessage = { id: string; kind: "experiment"; experiment: Experiment; outcomes: Outcome[]; parameters: Parameters; resources?: Record<string, unknown>; fileKey?: string };
const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (event: MessageEvent<Message | ExperimentMessage>) => {
  const request = event.data;
  try {
    if(request.kind==="experiment"){
      const zip=new JSZip();let selected:Blob|undefined;let archiveBytes=0;
      for(const [name,blob] of experimentBlobArtifacts(request.experiment,request.outcomes,request.parameters,request.resources)){
        if(request.fileKey){if(name===request.fileKey){selected=blob;break;}}else {archiveBytes+=blob.size;if(archiveBytes>256*1024*1024)throw new Error("Experiment ZIP exceeds the 256 MiB uncompressed export budget. Download individual tables or select fewer contrasts; no incomplete ZIP is delivered.");zip.file(name,blob);}
      }
      if(request.fileKey&&!selected)throw new Error(`Unknown export file: ${request.fileKey}`);
      const blob=selected??await zip.generateAsync({type:"blob",compression:"STORE",streamFiles:true});
      scope.postMessage({id:request.id,type:"complete",name:request.fileKey??"gel-experiment.zip",blob});return;
    }
    const artifacts = makeArtifacts(request.result, request.parameters, request.provenance);
    if (request.kind === "zip") {
      const zip = new JSZip(); for (const [name, content] of Object.entries(artifacts)) zip.file(name, content);
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" }); scope.postMessage({ id: request.id, type: "complete", name: "gel-analysis.zip", blob });
    } else {
      const key = request.fileKey ?? "gel_links.tsv"; const content = artifacts[key as keyof typeof artifacts];
      if (content === undefined) throw new Error(`Unknown export file: ${key}`);
      const mime = key.endsWith(".csv") ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8";
      scope.postMessage({ id: request.id, type: "complete", name: key, blob: new Blob([content], { type: mime }) });
    }
  } catch (error) { scope.postMessage({ id: request.id, type: "error", error: error instanceof Error ? error.message : String(error) }); }
};
export {};
