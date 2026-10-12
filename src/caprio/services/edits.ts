import type { Database } from "@/caprio/db/database";
import type { Component, ComponentVersion, DetailStage, EditRequest, Parameter } from "@/caprio/domain/types";
import { AppError } from "@/caprio/errors";
import { uuid } from "@/caprio/ids";
import { AssemblyService } from "@/caprio/services/assemblies";
import { ComponentService } from "@/caprio/services/components";
import { GenerationService } from "@/caprio/services/generation";
import { PlannerService } from "@/caprio/services/planner";
import { appearanceFromText, looksLikeGeometryRequest } from "@/caprio/threed/appearance";
import { meshGenerationPrompt, looksLikeSurfaceRebuild, looksLikeAdditiveEdit } from "@/caprio/threed/part-shape";
import { landmarkPrompt } from "@/caprio/threed/measure";
import {
  buildImpact,
  diffAssemblies,
  makeChangeSet,
  makeDecision,
  resolveTargetComponents,
  wantsInstanceScope,
} from "@/caprio/services/semantics";

function looksLikeParameterOnly(prompt: string): boolean {
  const appearance = appearanceFromText(prompt);
  if (appearance && !looksLikeGeometryRequest(prompt)) return true;
  return /^(change|set|make).*(color|material|roughness|metal|paint|walnut|oak|brass|wood|fabric|finish)/i.test(prompt.trim()) &&
    !looksLikeGeometryRequest(prompt);
}

function looksLikeDimensionOnly(prompt: string): boolean {
  return /(taller|shorter|wider|thinner|thicker|height|width|depth|scale)/i.test(prompt) &&
    !/(style|art deco|futur|carv|sculpt|shape|ornate|more .+ looking)/i.test(prompt);
}

export class EditService {
  constructor(
    private readonly db: Database,
    private readonly planner: PlannerService,
    private readonly components: ComponentService,
    private readonly assemblies: AssemblyService,
    private readonly generation: GenerationService,
  ) {}

  async preview(input: {
    assemblyId: string;
    prompt: string;
    componentId?: string | null;
    instanceId?: string | null;
  }) {
    const bundle = await this.assemblies.get(input.assemblyId);
    const targets = resolveTargetComponents(input.prompt, bundle.components, input.componentId);
    const impact = buildImpact({
      prompt: input.prompt,
      components: bundle.components,
      versions: bundle.versions,
      dependencies: bundle.dependencies,
      targets,
    });
    return {
      intent: {
        intent: "modify",
        target: impact.direct.map((c) => c.id),
        instruction: input.prompt,
        preserve: impact.unchanged.concat(impact.locked).map((c) => c.id),
        allowIndirectChanges: false,
      },
      impact,
    };
  }

  async edit(input: {
    componentId: string;
    assemblyId: string;
    instanceId?: string | null;
    prompt: string;
    applyTo?: "instance" | "definition";
    stage?: DetailStage;
  }) {
    const before = await this.assemblies.get(input.assemblyId);
    const { component, versions } = await this.components.get(input.componentId);
    const current = versions.find((v) => v.id === component.currentVersionId) || versions.at(-1);
    if (!current) throw new AppError("Component has no versions", "no_version", 400);

    const request: EditRequest = {
      id: uuid(),
      componentId: component.id,
      assemblyId: input.assemblyId,
      instanceId: input.instanceId ?? null,
      prompt: input.prompt,
      status: "pending",
      createdNewVersionId: null,
      parameterOnly: false,
      createdAt: new Date().toISOString(),
      error: null,
      clarification: null,
    };
    await this.db.write((state) => state.editRequests.push(request));

    if (component.locked) {
      await this.patchRequest(request.id, { status: "blocked_locked", error: "Component is locked" });
      throw new AppError(
        `${component.name} is locked, so it will not be modified. Unlock it first, or edit other components.`,
        "locked",
        409,
      );
    }

    const applyTo =
      input.applyTo || (input.instanceId && wantsInstanceScope(input.prompt) ? "instance" : "definition");

    let targetComponentId = component.id;
    let targetCurrent = current;
    if (applyTo === "instance" && input.instanceId) {
      const state = await this.db.read();
      const siblings = state.assemblyComponents.filter(
        (i) => i.assemblyId === input.assemblyId && i.componentId === component.id,
      );
      const instance = siblings.find((i) => i.id === input.instanceId);
      if (instance && siblings.length > 1 && !instance.detached) {
        const clone = await this.components.cloneForDetach(component.id);
        const clonedCurrent =
          clone.versions.find((v) => v.versionNumber === current.versionNumber) || clone.versions.at(-1)!;
        await this.assemblies.reassignInstance(input.instanceId, clone.component.id, clonedCurrent.id, true);
        targetComponentId = clone.component.id;
        targetCurrent = clonedCurrent;
      }
    }

    const surfaceRebuild = looksLikeSurfaceRebuild(input.prompt);
    const intent = {
      parameterOnly: looksLikeParameterOnly(input.prompt) && !surfaceRebuild,
      updatedPrompt: `${targetCurrent.generationPrompt}. Edit: ${input.prompt}`,
      parameters: overlayParameters(
        targetCurrent.parameters.map((p) => ({
          key: p.key,
          value: p.value,
          unit: p.unit,
          affectsGeometry: p.affectsGeometry,
        })),
        mergePromptParameters(targetCurrent.parameters, input.prompt),
      ),
      styleNotes: input.prompt,
      geometryMustChange:
        surfaceRebuild ||
        looksLikeGeometryRequest(input.prompt) ||
        Boolean(input.stage) ||
        (!looksLikeParameterOnly(input.prompt) && !looksLikeDimensionOnly(input.prompt)),
    };

    const meshProvider = this.generation.providerName === "meshy" || this.generation.providerName === "local";
    const styleChange = /(style|art deco|futur|carv|sculpt|shape|ornate|cutout|floral|pattern|star)/i.test(input.prompt);
    const stageChange = Boolean(input.stage && input.stage !== (current.stage || "blockout"));
    const keepMesh =
      !surfaceRebuild &&
      !styleChange &&
      !stageChange &&
      (looksLikeParameterOnly(input.prompt) ||
        (meshProvider && looksLikeDimensionOnly(input.prompt)) ||
        (intent.parameterOnly && !intent.geometryMustChange));

    const result = keepMesh
      ? await this.applyParameterEdit({
          requestId: request.id,
          prompt: input.prompt,
          assemblyId: input.assemblyId,
          instanceId: applyTo === "instance" ? input.instanceId : null,
          targetComponentId,
          targetCurrent,
          intent,
        })
      : await this.applyGeometryEdit({
          requestId: request.id,
          prompt: input.prompt,
          assemblyId: input.assemblyId,
          instanceId: applyTo === "instance" ? input.instanceId : null,
          targetComponentId,
          targetCurrent,
          componentName: component.name,
          intent,
          stage: input.stage || (surfaceRebuild ? "detail" : targetCurrent.stage || "form"),
        });

    await this.assemblies.refreshActivePins(input.assemblyId);
    await this.recordHistory({
      assemblyId: input.assemblyId,
      prompt: input.prompt,
      editRequestId: request.id,
      before,
      targets: [before.components.find((c) => c.id === input.componentId) || component],
    });

    return result;
  }

  async applyBroadChange(assemblyId: string, prompt: string) {
    const before = await this.assemblies.get(assemblyId);
    const targets = resolveTargetComponents(prompt, before.components);
    const results = [];
    for (const component of targets) {
      if (component.locked) {
        results.push({
          componentId: component.id,
          skipped: true,
          reason: "locked",
          message: `${component.name} is locked, so it was preserved.`,
        });
        continue;
      }
      const result = await this.edit({
        componentId: component.id,
        assemblyId,
        prompt,
        applyTo: "definition",
      });
      results.push({ skipped: false, ...result });
    }
    return results;
  }

  private async applyParameterEdit(input: {
    requestId: string;
    prompt: string;
    assemblyId: string;
    instanceId?: string | null;
    targetComponentId: string;
    targetCurrent: ComponentVersion;
    intent: { updatedPrompt: string; parameters: Array<{ key: string; value: number | string; unit?: string; affectsGeometry: boolean }> };
  }) {
    const mergedKeys = new Map(input.targetCurrent.parameters.map((p) => [p.key, p]));
    for (const p of input.intent.parameters) {
      mergedKeys.set(p.key, {
        id: uuid(),
        key: p.key,
        value: p.value,
        unit: p.unit,
        affectsGeometry: p.affectsGeometry,
      });
    }
    const parameters: Parameter[] = [...mergedKeys.values()];
    const version = await this.components.addVersion({
      componentId: input.targetComponentId,
      generationPrompt: input.intent.updatedPrompt,
      geometryPath: input.targetCurrent.geometryPath,
      notes: input.prompt,
      sourceEditRequestId: input.requestId,
      parameters,
      connectionPoints: input.targetCurrent.connectionPoints,
      providerTaskId: input.targetCurrent.providerTaskId,
      cadSource: input.targetCurrent.cadSource,
    });
    await this.retargetInstances(input.assemblyId, input.targetComponentId, input.instanceId, version.id, parameters);
    await this.patchRequest(input.requestId, {
      status: "complete",
      parameterOnly: true,
      createdNewVersionId: version.id,
    });
    return {
      requestId: input.requestId,
      parameterOnly: true,
      componentId: input.targetComponentId,
      versionId: version.id,
      previousVersionId: input.targetCurrent.id,
    };
  }

  private async applyGeometryEdit(input: {
    requestId: string;
    prompt: string;
    assemblyId: string;
    instanceId?: string | null;
    targetComponentId: string;
    targetCurrent: ComponentVersion;
    componentName: string;
    intent: { updatedPrompt: string };
    stage?: DetailStage;
  }) {
    await this.patchRequest(input.requestId, { status: "running" });
    const bundle = await this.assemblies.get(input.assemblyId);
    const located = landmarkPrompt(input.prompt, input.componentName, bundle.markers || []);
    const additive = looksLikeAdditiveEdit(input.prompt);
    const surface = looksLikeSurfaceRebuild(input.prompt);
    const stage =
      input.stage ||
      (additive || surface ? "detail" : input.targetCurrent.stage || "form");
    const preserve = additive
      ? [input.targetCurrent.notes, input.targetCurrent.generationPrompt].filter(Boolean).join(". ")
      : undefined;
    const meshPrompt =
      stage === "detail" || surface
        ? `${input.componentName}. ${located}. This feature must be clearly visible in the sculpted mesh.`
        : located;
    const version = await this.components.addVersion({
      componentId: input.targetComponentId,
      generationPrompt: meshGenerationPrompt(input.componentName, meshPrompt, stage, { preserve }),
      notes: input.prompt,
      sourceEditRequestId: input.requestId,
      parameters: input.targetCurrent.parameters,
      connectionPoints: input.targetCurrent.connectionPoints,
      cadSource: input.targetCurrent.cadSource,
      stage,
    });

    try {
      await this.generation.generateGeometry(version.id, meshPrompt, undefined, {
        partName: input.componentName,
        currentFiles: input.targetCurrent.cadSource?.files,
        parameters: input.targetCurrent.parameters,
        stage,
        assemblyId: input.assemblyId,
        preservePrompt: preserve,
        retryWrongSilhouette: stage !== "detail",
      });
    } catch (error) {
      await this.components.setCurrentVersion(input.targetComponentId, input.targetCurrent.id);
      throw error;
    }

    await this.retargetInstances(input.assemblyId, input.targetComponentId, input.instanceId, version.id);

    await this.patchRequest(input.requestId, {
      status: "complete",
      createdNewVersionId: version.id,
      parameterOnly: false,
    });
    return {
      requestId: input.requestId,
      parameterOnly: false,
      componentId: input.targetComponentId,
      versionId: version.id,
      previousVersionId: input.targetCurrent.id,
    };
  }

  private async retargetInstances(
    assemblyId: string,
    componentId: string,
    instanceId: string | null | undefined,
    versionId: string,
    parameters?: Parameter[],
  ) {
    if (instanceId) {
      await this.assemblies.replaceInstanceVersion(instanceId, versionId);
      if (parameters) await this.assemblies.applyParameterScale(instanceId, parameters);
      return;
    }
    const state = await this.db.read();
    const instances = state.assemblyComponents.filter(
      (i) => i.assemblyId === assemblyId && i.componentId === componentId,
    );
    for (const instance of instances) {
      await this.assemblies.replaceInstanceVersion(instance.id, versionId);
      if (parameters) await this.assemblies.applyParameterScale(instance.id, parameters);
    }
  }

  private async recordHistory(input: {
    assemblyId: string;
    prompt: string;
    editRequestId: string | null;
    before: Awaited<ReturnType<AssemblyService["get"]>>;
    targets: Component[];
  }) {
    const after = await this.assemblies.get(input.assemblyId);
    const impact = buildImpact({
      prompt: input.prompt,
      components: input.before.components,
      versions: input.before.versions,
      dependencies: input.before.dependencies,
      targets: input.targets,
    });
    const diff = diffAssemblies({
      fromLabel: "before",
      toLabel: "after",
      before: input.before.components.map((component) => ({
        component,
        version: pinnedVersion(input.before, component),
      })),
      after: after.components.map((component) => ({
        component,
        version: pinnedVersion(after, component),
      })),
    });
    const explanation =
      impact.explanation +
      (diff.modified.length
        ? ` Created ${diff.modified.map((m) => `${m.name} ${impact.plannedVersions.find((p) => p.componentId === m.componentId)?.toLabel || "new version"}`).join(", ")}.`
        : "");
    const changeSet = makeChangeSet({
      assemblyId: input.assemblyId,
      prompt: input.prompt,
      editRequestId: input.editRequestId,
      impact: { ...impact, explanation },
      diff,
      explanation,
    });
    const decision = makeDecision({
      assemblyId: input.assemblyId,
      request: input.prompt,
      result: explanation,
      affectedComponentIds: impact.direct.map((c) => c.id),
      resultingVersionIds: after.versions
        .filter((v) => impact.direct.some((d) => d.id === v.componentId))
        .map((v) => v.id),
    });
    await this.db.write((state) => {
      state.changeSets.push(changeSet);
      state.designDecisions.push(decision);
    });
  }

  private async patchRequest(id: string, patch: Partial<EditRequest>) {
    await this.db.write((state) => {
      const request = state.editRequests.find((r) => r.id === id);
      if (request) Object.assign(request, patch);
    });
  }
}

function pinnedVersion(
  bundle: { instances: Array<{ componentId: string; versionId: string }>; versions: ComponentVersion[] },
  component: Component,
) {
  const instance = bundle.instances.find((i) => i.componentId === component.id);
  return bundle.versions.find((v) => v.id === (instance?.versionId || component.currentVersionId));
}

function overlayParameters(
  base: Array<{ key: string; value: number | string; unit?: string; affectsGeometry: boolean }>,
  extra: Parameter[],
) {
  const map = new Map(base.map((p) => [p.key, p]));
  for (const p of extra) map.set(p.key, { key: p.key, value: p.value, unit: p.unit, affectsGeometry: p.affectsGeometry });
  return [...map.values()];
}

function mergePromptParameters(current: Parameter[], prompt: string): Parameter[] {
  const appearance = appearanceFromText(prompt);
  const next = [...current];
  const set = (key: string, value: number | string, affectsGeometry: boolean, unit?: string) => {
    const existing = next.find((p) => p.key === key);
    if (existing) {
      existing.value = value;
      existing.affectsGeometry = affectsGeometry;
    } else {
      next.push({ id: key, key, value, unit, affectsGeometry });
    }
  };
  if (appearance) {
    set("color", appearance.color, false);
    set("material", appearance.label, false);
    set("roughness", appearance.roughness, false);
    set("metalness", appearance.metalness, false);
  }
  const height = current.find((p) => p.key === "height");
  const currentHeight = typeof height?.value === "number" ? height.value : 0.45;
  if (/taller/i.test(prompt)) set("height", Number((currentHeight * 1.2).toFixed(3)), true, height?.unit || "m");
  if (/shorter/i.test(prompt)) set("height", Number((currentHeight * 0.85).toFixed(3)), true, height?.unit || "m");
  if (/wider/i.test(prompt)) {
    const width = current.find((p) => p.key === "width");
    const currentWidth = typeof width?.value === "number" ? width.value : 0.5;
    set("width", Number((currentWidth * 1.15).toFixed(3)), true, width?.unit || "m");
  }
  return next;
}
