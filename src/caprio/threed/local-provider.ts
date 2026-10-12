import { ProviderError } from "@/caprio/errors";
import { uuid } from "@/caprio/ids";
import { parametricKcl } from "@/caprio/threed/cad";
import { buildBoxGlb, buildCylinderGlb } from "@/caprio/threed/glb";
import { inferPartKind, primitiveForKind } from "@/caprio/threed/part-shape";
import type {
  ThreeDGenerationRequest,
  ThreeDGenerationResult,
  ThreeDProvider,
  ThreeDTaskSnapshot,
} from "@/caprio/threed/provider";

/**
 * Honest offline stand-in. Shape is chosen from the component name, never from
 * words like "no legs" inside the prompt (that previously turned seats into rods).
 */
export class LocalPrimitiveProvider implements ThreeDProvider {
  readonly name = "local";
  private tasks = new Map<string, { request: ThreeDGenerationRequest; snapshot: ThreeDTaskSnapshot; bytes?: Buffer }>();

  async createTask(request: ThreeDGenerationRequest): Promise<{ providerTaskId: string }> {
    const id = `local_${uuid()}`;
    this.tasks.set(id, {
      request,
      snapshot: { providerTaskId: id, status: "pending", progress: 0 },
    });
    return { providerTaskId: id };
  }

  async getTask(providerTaskId: string): Promise<ThreeDTaskSnapshot> {
    const task = this.tasks.get(providerTaskId);
    if (!task) throw new ProviderError("Unknown local 3D task", "generation_failure", 404);
    return task.snapshot;
  }

  async waitForModel(
    providerTaskId: string,
    options?: { onProgress?: (snapshot: ThreeDTaskSnapshot) => void | Promise<void> },
  ): Promise<ThreeDGenerationResult> {
    const task = this.tasks.get(providerTaskId);
    if (!task) throw new ProviderError("Unknown local 3D task", "generation_failure", 404);
    task.snapshot = { ...task.snapshot, status: "in_progress", progress: 40 };
    await options?.onProgress?.(task.snapshot);
    const kind = inferPartKind(task.request.partName, task.request.prompt);
    const spec = primitiveForKind(kind);
    const taller = /taller/.test(task.request.prompt.toLowerCase());
    const bytes =
      spec.type === "cylinder"
        ? buildCylinderGlb(spec.radius, taller ? (spec.height || 0.45) * 1.2 : spec.height)
        : buildBoxGlb(spec.sx, spec.sy, spec.sz, spec.color);
    if (bytes.toString("ascii", 0, 4) !== "glTF") {
      throw new ProviderError("Local provider produced an invalid GLB", "invalid_glb", 500);
    }
    const files = {
      ...(task.request.currentFiles || {}),
      "main.kcl":
        task.request.currentFiles?.["main.kcl"] && /taller|shorter|art deco|style/.test(task.request.prompt.toLowerCase())
          ? `${task.request.currentFiles["main.kcl"]}\n// edit: ${task.request.prompt}`
          : parametricKcl({
              name: task.request.partName || "Part",
              prompt: task.request.prompt,
              parameters: task.request.parameters,
            }),
    };
    task.snapshot = {
      providerTaskId,
      status: "succeeded",
      progress: 100,
      modelUrl: `local://${providerTaskId}.glb`,
    };
    await options?.onProgress?.(task.snapshot);
    task.bytes = bytes;
    return {
      provider: this.name,
      providerTaskId,
      modelBytes: bytes,
      mimeType: "model/gltf-binary",
      cad: { provider: this.name, format: "kcl", files },
    };
  }
}
