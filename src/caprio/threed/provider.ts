import type { CadSource } from "@/caprio/threed/cad";
import type { DetailStage } from "@/caprio/domain/types";

export interface ThreeDGenerationRequest {
  prompt: string;
  artNotes?: string;
  partName?: string;
  currentFiles?: Record<string, string>;
  parameters?: Array<{ key: string; value: number | string; unit?: string }>;
  stage?: DetailStage;
  preservePrompt?: string;
}

export interface ThreeDTaskSnapshot {
  providerTaskId: string;
  status: "pending" | "in_progress" | "succeeded" | "failed";
  progress: number;
  modelUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}

export interface ThreeDGenerationResult {
  provider: string;
  providerTaskId: string;
  modelBytes: Buffer;
  mimeType: string;
  thumbnailUrl?: string;
  cad?: CadSource;
}

export interface ThreeDProvider {
  readonly name: string;
  createTask(request: ThreeDGenerationRequest): Promise<{ providerTaskId: string }>;
  getTask(providerTaskId: string): Promise<ThreeDTaskSnapshot>;
  waitForModel(
    providerTaskId: string,
    options?: { onProgress?: (snapshot: ThreeDTaskSnapshot) => void | Promise<void> },
  ): Promise<ThreeDGenerationResult>;
}
