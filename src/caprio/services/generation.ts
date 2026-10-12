import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "@/caprio/db/database";
import type { GenerationStep, GenerationTask, PipelineStatus } from "@/caprio/domain/types";
import { AppError, ProviderError } from "@/caprio/errors";
import { uuid } from "@/caprio/ids";
import { writeGlb } from "@/caprio/threed/glb";
import { fitPartGlb, fitPartGlbSafe, glbSize, looksLikeChairMesh } from "@/caprio/threed/fit-glb";
import { inferPartKind, looksLikeWholeObject } from "@/caprio/threed/part-shape";
import type { CadSource } from "@/caprio/threed/cad";
import { LocalPrimitiveProvider } from "@/caprio/threed/local-provider";
import type { ThreeDProvider } from "@/caprio/threed/provider";
import { AssemblyService } from "@/caprio/services/assemblies";
import { ComponentService } from "@/caprio/services/components";
import {
  defaultConnectionPoints,
  defaultTransformFor,
  frameFromParts,
  instanceLabel,
  mergeMeasuredFrame,
  poseForPart,
  targetForKind,
  type AssemblyFrame,
} from "@/caprio/services/layout";
import { PlannerService } from "@/caprio/services/planner";
import type { ValidatedPlan } from "@/caprio/schemas/plan";

function isBillingFailure(error: unknown) {
  const code = error instanceof ProviderError || error instanceof AppError ? error.code : "";
  const message = error instanceof Error ? error.message : "";
  return (
    code === "insufficient_funds" ||
    code === "invalid_api_key" ||
    /insufficient funds|402|429|quota|credit|payment|invalid_api_key/i.test(message)
  );
}

export class GenerationService {
  private meshyUnavailable = false;
  private readonly localFallback = new LocalPrimitiveProvider();

  constructor(
    private readonly db: Database,
    private readonly planner: PlannerService,
    private readonly components: ComponentService,
    private readonly assemblies: AssemblyService,
    private readonly threed: ThreeDProvider,
    private readonly modelsDir: string,
  ) {}

  get providerName() {
    return this.threed.name;
  }

  async createTask(
    partial: Omit<
      GenerationTask,
      | "id"
      | "createdAt"
      | "updatedAt"
      | "progress"
      | "error"
      | "providerTaskId"
      | "currentPartName"
      | "currentPartIndex"
      | "totalParts"
      | "partProgress"
      | "message"
      | "steps"
    > &
      Partial<Pick<GenerationTask, "providerTaskId" | "currentPartName" | "currentPartIndex" | "totalParts" | "partProgress" | "message" | "steps" | "progress">>,
  ) {
    const now = new Date().toISOString();
    const task: GenerationTask = {
      id: uuid(),
      provider: partial.provider,
      status: partial.status,
      componentId: partial.componentId,
      assemblyId: partial.assemblyId,
      prompt: partial.prompt,
      providerTaskId: partial.providerTaskId ?? null,
      progress: partial.progress ?? 0,
      error: null,
      currentPartName: partial.currentPartName ?? null,
      currentPartIndex: partial.currentPartIndex ?? 0,
      totalParts: partial.totalParts ?? 0,
      partProgress: partial.partProgress ?? 0,
      message: partial.message ?? "",
      steps: partial.steps ?? [],
      createdAt: now,
      updatedAt: now,
    };
    await this.db.write((state) => state.generationTasks.push(task));
    return task;
  }

  async updateTask(id: string, patch: Partial<GenerationTask>) {
    await this.db.write((state) => {
      const task = state.generationTasks.find((t) => t.id === id);
      if (!task) throw new AppError("Generation task not found", "not_found", 404);
      Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    });
  }

  async getTask(id: string) {
    const state = await this.db.read();
    const task = state.generationTasks.find((t) => t.id === id);
    if (!task) throw new AppError("Generation task not found", "not_found", 404);
    return this.normalizeTask(task);
  }

  private normalizeTask(task: GenerationTask): GenerationTask {
    return {
      ...task,
      currentPartName: task.currentPartName ?? null,
      currentPartIndex: task.currentPartIndex ?? 0,
      totalParts: task.totalParts ?? 0,
      partProgress: task.partProgress ?? 0,
      message: task.message ?? "",
      steps: task.steps ?? [],
    };
  }

  async plan(prompt: string) {
    return this.planner.planObject(prompt);
  }

  async startFromPlan(plan: ValidatedPlan, userPrompt: string) {
    const assembly = await this.assemblies.create(plan.object_name, userPrompt);
    const steps: GenerationStep[] = plan.components.map((planned) => ({
      name: planned.name,
      quantity: planned.quantity,
      status: "pending",
    }));
    const parentTask = await this.createTask({
      provider: this.threed.name,
      status: "generating",
      componentId: null,
      assemblyId: assembly.id,
      prompt: userPrompt,
      totalParts: plan.components.length,
      message: `Queued ${plan.components.length} Meshy jobs`,
      steps,
    });
    await this.assemblies.setStatus(assembly.id, "generating");
    return { assemblyId: assembly.id, taskId: parentTask.id, assembly, task: parentTask };
  }

  async generateFromPlan(plan: ValidatedPlan, userPrompt: string) {
    const started = await this.startFromPlan(plan, userPrompt);
    return this.finishFromPlan(started.assemblyId, started.taskId, plan);
  }

  async finishFromPlan(assemblyId: string, taskId: string, plan: ValidatedPlan) {
    const parentTask = await this.getTask(taskId);
    const total = plan.components.length;
    const frame = frameFromParts(plan.components);
    const steps: GenerationStep[] = plan.components.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      status: "running" as const,
    }));
    try {
      await this.updateTask(parentTask.id, {
        status: "generating",
        totalParts: total,
        currentPartIndex: 0,
        currentPartName: plan.components.map((item) => item.name).join(", "),
        message: `Meshing ${total} parts together`,
        steps,
        progress: 1,
      });
      parentTask.steps = steps;

      const buildComponent = async (planned: ValidatedPlan["components"][number], index: number) => {
        const { component, version } = await this.components.createComponent({
          name: planned.name,
          role: planned.role,
          generationPrompt: planned.generation_prompt,
          purpose: planned.purpose,
          style: planned.style,
          material: planned.material,
          constraints: planned.constraints,
          parameters: (planned.parameters || []).map((p) => ({
            key: p.key,
            value: p.value,
            unit: p.unit,
            affectsGeometry: p.affectsGeometry,
          })),
          stage: "form",
        });
        const generated = await this.generateGeometry(version.id, planned.generation_prompt, parentTask.id, {
          partName: planned.name,
          parameters: planned.parameters,
          stage: "form",
          partIndex: index,
          totalParts: total,
          targetSize: targetForKind(frame, inferPartKind(planned.name)),
        });
        for (let i = 0; i < planned.quantity; i += 1) {
          const transform = defaultTransformFor(planned, i, frame);
          const label = instanceLabel(planned.name, planned.quantity, i);
          await this.assemblies.addInstance({
            assemblyId,
            component,
            versionId: version.id,
            label,
            instanceIndex: i,
            ...transform,
          });
          const points = defaultConnectionPoints(label, transform.position);
          await this.db.write((state) => {
            const v = state.componentVersions.find((item) => item.id === version.id);
            if (!v || v.connectionPoints.length) return;
            v.connectionPoints = points.map((p) => ({ ...p, id: uuid() }));
            state.connectionPoints.push(...v.connectionPoints);
          });
        }
        await this.db.write((state) => {
          const task = state.generationTasks.find((item) => item.id === parentTask.id);
          if (!task) return;
          task.steps = (task.steps || []).map((step, stepIndex) =>
            stepIndex === index ? { ...step, status: "done" as const } : step,
          );
          const done = task.steps.filter((step) => step.status === "done").length;
          task.progress = Math.round((done / Math.max(total, 1)) * 100);
          task.message = `Finished ${planned.name} (${done} of ${total})`;
          task.updatedAt = new Date().toISOString();
        });
        return { component, version, planned, geometry: generated };
      };

      const created = [
        await buildComponent(plan.components[0], 0),
        ...(await Promise.all(plan.components.slice(1).map((planned, offset) => buildComponent(planned, offset + 1)))),
      ];

      await this.snapAssembly(assemblyId, frame);

      for (const dep of plan.dependencies) {
        const from = created.find((c) => c.component.name.toLowerCase() === dep.from.toLowerCase());
        const to = created.find((c) => c.component.name.toLowerCase() === dep.to.toLowerCase());
        if (from && to) {
          await this.assemblies.addDependency({
            fromComponentId: from.component.id,
            toComponentId: to.component.id,
            kind: dep.kind,
            description: dep.description,
          });
        }
      }

      await this.assemblies.ensureMainBranch(assemblyId);
      await this.assemblies.saveIteration(assemblyId, "Blockout 1", "First low-poly combo of all parts");
      await this.harmonizeAssembly(assemblyId, frame);
      await this.assemblies.setStatus(assemblyId, "complete");
      await this.updateTask(parentTask.id, {
        status: "complete",
        progress: 100,
        partProgress: 100,
        currentPartName: null,
        error: null,
        message: this.meshyUnavailable
          ? "Assembly ready with local parts. Meshy is out of credits — refill to get sculpted meshes."
          : "Assembly ready",
        steps: parentTask.steps.map((step) => ({ ...step, status: "done" as const })),
      });
      return { assemblyId, taskId: parentTask.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Generation failed";
      await this.assemblies.setStatus(assemblyId, "failed", message);
      await this.updateTask(parentTask.id, {
        status: "failed",
        error: message,
        message,
        steps: parentTask.steps.map((step) =>
          step.status === "running" ? { ...step, status: "failed" as const } : step,
        ),
      });
      throw error;
    }
  }

  async generateGeometry(
    versionId: string,
    prompt: string,
    parentTaskId?: string,
    options?: {
      partName?: string;
      currentFiles?: Record<string, string>;
      parameters?: Array<{ key: string; value: number | string; unit?: string }>;
      stage?: import("@/caprio/domain/types").DetailStage;
      preservePrompt?: string;
      partIndex?: number;
      totalParts?: number;
      targetSize?: { x: number; y: number; z: number };
      assemblyId?: string;
      snap?: boolean;
      retryWrongSilhouette?: boolean;
    },
  ) {
    const kind = inferPartKind(options?.partName, prompt);
    let targetSize = options?.targetSize;
    if (!targetSize && options?.assemblyId) {
      const frame = await this.frameFromAssembly(options.assemblyId);
      targetSize = targetForKind(frame, kind);
    }

    const attach = async (modelBytes: Buffer, providerTaskId: string, cad?: CadSource | null) => {
      if (cad) await this.components.attachCad(versionId, cad);
      const fitted = fitPartGlbSafe(modelBytes, options?.partName, prompt, options?.parameters, targetSize);
      const fileName = `${versionId}.glb`;
      const filePath = path.join(this.modelsDir, fileName);
      await writeGlb(filePath, fitted);
      if (cad?.files["main.kcl"]) {
        await writeGlb(path.join(this.modelsDir, `${versionId}.kcl`), Buffer.from(cad.files["main.kcl"], "utf8"));
      }
      const publicPath = `/api/caprio/models/${fileName}`;
      await this.components.attachGeometry(versionId, publicPath, providerTaskId);
      if (parentTaskId) {
        await this.updateTask(parentTaskId, { status: "assembling", message: `Placing ${options?.partName || "part"}` });
      }
      if (options?.snap && options.assemblyId) {
        await this.snapAssembly(options.assemblyId);
      }
      return { publicPath, providerTaskId };
    };

    const silhouetteWrong = (bytes: Buffer) => {
      try {
        return looksLikeWholeObject(kind, glbSize(bytes)) || looksLikeChairMesh(bytes);
      } catch {
        return false;
      }
    };

    const meshOnce = async (provider: ThreeDProvider, taskPrompt: string) => {
      if (parentTaskId) await this.updateTask(parentTaskId, { status: "generating", prompt: taskPrompt });
      const created = await provider.createTask({
        prompt: taskPrompt,
        partName: options?.partName,
        currentFiles: options?.currentFiles,
        parameters: options?.parameters,
        stage: options?.stage || "form",
        preservePrompt: options?.preservePrompt,
      });
      if (parentTaskId) {
        await this.updateTask(parentTaskId, { providerTaskId: created.providerTaskId, status: "generating" });
      }
      let lastReported = -1;
      let lastWrite = 0;
      const result = await provider.waitForModel(created.providerTaskId, {
        onProgress: async (snapshot) => {
          if (!parentTaskId) return;
          const now = Date.now();
          if (snapshot.status === "in_progress" && snapshot.progress < lastReported + 15 && now - lastWrite < 8000) {
            return;
          }
          lastReported = snapshot.progress;
          lastWrite = now;
          const index = options?.partIndex ?? 0;
          const total = Math.max(options?.totalParts ?? 1, 1);
          const blended = Math.round(((index + snapshot.progress / 100) / total) * 100);
          await this.updateTask(parentTaskId, {
            partProgress: snapshot.progress,
            progress: Math.min(99, blended),
            status: "generating",
            message: `${options?.partName || "Part"} — ${provider.name} ${snapshot.progress}%`,
          });
        },
      });
      if (parentTaskId) {
        await this.updateTask(parentTaskId, { status: "downloading", message: `Downloading ${options?.partName || "part"}` });
      }
      return result;
    };

    const detailNeedsMeshy = options?.stage === "detail";
    const skipCloud = this.threed.name === "meshy" && this.meshyUnavailable;
    if (skipCloud && detailNeedsMeshy) {
      throw new AppError(
        "Meshy is out of credits, so Detail cannot remesh this part. Add credits at meshy.ai, then Apply again.",
        "insufficient_funds",
        402,
      );
    }

    try {
      let result = skipCloud ? await meshOnce(this.localFallback, prompt) : await meshOnce(this.threed, prompt);
      const allowRetry = !skipCloud && options?.retryWrongSilhouette !== false && options?.stage !== "detail";
      if (allowRetry && silhouetteWrong(result.modelBytes)) {
        result = await meshOnce(
          this.threed,
          `Isolated ${kind} only. ${prompt}. Not a complete chair. One ${options?.partName || kind} only.`,
        );
      }
      return attach(result.modelBytes, result.providerTaskId, result.cad);
    } catch (error) {
      if (!isBillingFailure(error) || this.threed.name !== "meshy") throw error;
      this.meshyUnavailable = true;
      if (detailNeedsMeshy) {
        throw new AppError(
          "Meshy is out of credits, so Detail cannot remesh this part. Add credits at meshy.ai, then Apply again.",
          "insufficient_funds",
          402,
        );
      }
      if (parentTaskId) {
        await this.updateTask(parentTaskId, {
          message: `${options?.partName || "Part"} — Meshy has no credits, using local geometry`,
        });
      }
      const local = await meshOnce(this.localFallback, prompt);
      return attach(local.modelBytes, local.providerTaskId, local.cad);
    }
  }

  async frameFromAssembly(assemblyId: string): Promise<AssemblyFrame> {
    const bundle = await this.assemblies.get(assemblyId);
    const fallback = frameFromParts(
      bundle.components.map((component) => ({
        name: component.name,
        parameters: bundle.versions.find((version) => version.id === component.currentVersionId)?.parameters,
      })),
    );
    const measured = await this.measureParts(bundle);
    return mergeMeasuredFrame(fallback, measured);
  }

  async snapAssembly(assemblyId: string, fallback?: AssemblyFrame) {
    const bundle = await this.assemblies.get(assemblyId);
    if (!bundle.instances.length) return;
    const frame = fallback
      ? mergeMeasuredFrame(fallback, await this.measureParts(bundle))
      : await this.frameFromAssembly(assemblyId);
    const updates = bundle.instances.map((instance) => {
      const component = bundle.components.find((item) => item.id === instance.componentId);
      const kind = inferPartKind(component?.name || instance.label);
      const pose = poseForPart(kind, instance.instanceIndex, frame);
      return { id: instance.id, ...pose };
    });
    await this.assemblies.applyTransforms(updates);
  }

  async harmonizeAssembly(assemblyId: string, fallback?: AssemblyFrame) {
    const bundle = await this.assemblies.get(assemblyId);
    if (!bundle.instances.length) return;
    const frame = fallback || (await this.frameFromAssembly(assemblyId));
    const measured = await this.measureParts(bundle);
    const seat = measured.seat || frame.seat;
    const together: AssemblyFrame = {
      seat,
      leg: measured.leg || frame.leg,
      cushion: {
        x: seat.x * 0.96,
        y: (measured.cushion || frame.cushion).y,
        z: seat.z * 0.92,
      },
      back: { x: seat.x, y: (measured.back || frame.back).y, z: (measured.back || frame.back).z },
      arm: { x: frame.arm.x, y: frame.arm.y, z: seat.z * 0.85 },
    };
    for (const component of bundle.components) {
      const kind = inferPartKind(component.name);
      if (kind === "generic") continue;
      const version =
        bundle.versions.find((item) => item.id === component.currentVersionId) ||
        bundle.versions.find((item) => item.componentId === component.id && item.geometryPath);
      if (!version?.geometryPath) continue;
      const filePath = path.join(this.modelsDir, path.basename(version.geometryPath));
      try {
        const bytes = await readFile(filePath);
        const fitted = fitPartGlb(bytes, kind, version.parameters, targetForKind(together, kind));
        await writeGlb(filePath, fitted);
      } catch {
        // Skip parts that failed to read; snap still uses the shared frame.
      }
    }
    await this.snapAssembly(assemblyId, together);
  }

  private async measureParts(bundle: Awaited<ReturnType<AssemblyService["get"]>>) {
    const measured: Partial<Record<ReturnType<typeof inferPartKind>, { x: number; y: number; z: number }>> = {};
    for (const component of bundle.components) {
      const kind = inferPartKind(component.name);
      const version =
        bundle.versions.find((item) => item.id === component.currentVersionId) ||
        bundle.versions.find((item) => item.componentId === component.id && item.geometryPath);
      if (!version?.geometryPath) continue;
      try {
        const bytes = await readFile(path.join(this.modelsDir, path.basename(version.geometryPath)));
        measured[kind] = glbSize(bytes);
      } catch {
        // Keep the planned frame if a mesh is still downloading.
      }
    }
    return measured;
  }

  async setPipeline(assemblyId: string, status: PipelineStatus, error?: string) {
    await this.assemblies.setStatus(assemblyId, status, error);
  }
}
