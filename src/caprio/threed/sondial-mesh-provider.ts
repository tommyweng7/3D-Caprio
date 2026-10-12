import { readFile } from "node:fs/promises";
import path from "node:path";
import { meshProvider } from "@/providers";
import type { MeshGenerationProvider } from "@/providers/types";
import { ProviderError } from "@/caprio/errors";
import { meshGenerationPrompt } from "@/caprio/threed/part-shape";
import type {
  ThreeDGenerationRequest,
  ThreeDGenerationResult,
  ThreeDProvider,
  ThreeDTaskSnapshot,
} from "@/caprio/threed/provider";

/**
 * Caprio's per-part geometry provider, backed by Sondial's own mesh provider
 * (Meshy by default, so the glossy-finish pass and MESHY_* tuning apply here too).
 *
 * Caprio owns the prompt: one component per task, never a whole assembly. The
 * detail stage asks for the higher-resolution Meshy settings, because a Detail
 * edit is exactly the case where a low-poly blockout is the wrong answer.
 */
export class SondialMeshProvider implements ThreeDProvider {
  readonly name: string;

  constructor(private readonly provider: MeshGenerationProvider = meshProvider) {
    this.name = provider.name;
  }

  async createTask(request: ThreeDGenerationRequest): Promise<{ providerTaskId: string }> {
    const prompt = meshGenerationPrompt(request.partName, request.prompt, request.stage || "form", {
      preserve: request.preservePrompt,
    });
    const { jobId } = await this.provider.generateMesh({
      prompt,
      format: "glb",
      quality: request.stage === "detail" ? "detail" : "fast",
    });
    return { providerTaskId: jobId };
  }

  async getTask(providerTaskId: string): Promise<ThreeDTaskSnapshot> {
    const snapshot = await this.provider.checkStatus(providerTaskId);
    return {
      providerTaskId,
      status:
        snapshot.status === "complete"
          ? "succeeded"
          : snapshot.status === "failed"
            ? "failed"
            : snapshot.status === "pending"
              ? "pending"
              : "in_progress",
      progress: snapshot.progress ?? (snapshot.status === "complete" ? 100 : 0),
      modelUrl: snapshot.result?.meshFileUrl,
      error: snapshot.error,
    };
  }

  async waitForModel(
    providerTaskId: string,
    options?: { onProgress?: (snapshot: ThreeDTaskSnapshot) => void | Promise<void> },
  ): Promise<ThreeDGenerationResult> {
    const interval = Number(process.env.MESHY_POLL_INTERVAL_MS || 1500);
    const timeout = Number(process.env.MESHY_TIMEOUT_MS || 600_000);
    const started = Date.now();

    while (Date.now() - started < timeout) {
      const snapshot = await this.getTask(providerTaskId);
      await options?.onProgress?.(snapshot);

      if (snapshot.status === "failed") {
        throw new ProviderError(snapshot.error || "Mesh generation failed", "generation_failure", 502);
      }
      if (snapshot.status === "succeeded") {
        if (!snapshot.modelUrl) {
          throw new ProviderError("Mesh finished without a model URL", "missing_model_url", 502);
        }
        return {
          provider: this.name,
          providerTaskId,
          modelBytes: await this.load(snapshot.modelUrl),
          mimeType: "model/gltf-binary",
        };
      }
      await sleep(interval);
    }

    throw new ProviderError(`Mesh task ${providerTaskId} timed out`, "timeout", 504);
  }

  /** Sondial saves the finished GLB under public/, so a local path is the common case. */
  private async load(modelUrl: string): Promise<Buffer> {
    const bytes = modelUrl.startsWith("/")
      ? await readFile(path.join(process.cwd(), "public", modelUrl.replace(/^\//, "")))
      : await this.download(modelUrl);
    if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "glTF") {
      throw new ProviderError("Mesh provider returned a file that is not a GLB", "invalid_glb", 502);
    }
    return bytes;
  }

  private async download(url: string): Promise<Buffer> {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new ProviderError(
        `Failed to download mesh: ${error instanceof Error ? error.message : "unknown"}`,
        "network_failure",
        502,
      );
    }
    if (!response.ok) {
      throw new ProviderError(`Failed to download mesh (${response.status})`, "missing_model_url", 502);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
