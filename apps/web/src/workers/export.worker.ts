/// <reference lib="webworker" />
import JSZip from "jszip";
import { type Parameters } from "@/lib/analysis";
import { makeArtifacts, type ExportInput } from "@/lib/exports";

import { makeExperimentArtifacts } from "@/lib/experiment-exports";
import type { Experiment, Outcome } from "@/lib/experiment";

type Message = { id: string; kind: "zip" | "file"; fileKey?: string; result: ExportInput; parameters: Parameters; provenance: Record<string, unknown> };
type ExperimentMessage = { id: string; kind: "experiment"; experiment: Experiment; outcomes: Outcome[]; parameters: Parameters; resources?: Record<string, unknown>; fileKey?: string };
const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (event: MessageEvent<Message | ExperimentMessage>) => {
  const request = event.data;
  try {
    const artifacts = request.kind === "experiment" ? makeExperimentArtifacts(request.experiment, request.outcomes, request.parameters, request.resources) : makeArtifacts(request.result, request.parameters, request.provenance);
    if (request.kind === "zip" || (request.kind === "experiment" && !request.fileKey)) {
      const zip = new JSZip(); for (const [name, content] of Object.entries(artifacts)) zip.file(name, content);
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" }); scope.postMessage({ id: request.id, type: "complete", name: request.kind === "experiment" ? "gel-experiment.zip" : "gel-analysis.zip", blob });
    } else {
      const key = request.fileKey ?? "gel_links.tsv"; const content = artifacts[key as keyof typeof artifacts];
      if (content === undefined) throw new Error(`Unknown export file: ${key}`);
      const mime = key.endsWith(".csv") ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8";
      scope.postMessage({ id: request.id, type: "complete", name: key, blob: new Blob([content], { type: mime }) });
    }
  } catch (error) { scope.postMessage({ id: request.id, type: "error", error: error instanceof Error ? error.message : String(error) }); }
};
export {};
