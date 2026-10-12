import type { Database } from "@/caprio/db/database";
import { AppError } from "@/caprio/errors";
import { AssemblyService } from "@/caprio/services/assemblies";
import { ComponentService } from "@/caprio/services/components";
import { defaultTransformFor, instanceLabel } from "@/caprio/services/layout";
import { GenerationService } from "@/caprio/services/generation";
import { inspectGlbMeshes } from "@/caprio/threed/inspect-glb";

export class SplitMergeService {
  constructor(
    private readonly db: Database,
    private readonly components: ComponentService,
    private readonly assemblies: AssemblyService,
    private readonly generation: GenerationService,
  ) {}

  async split(input: {
    componentId: string;
    assemblyId: string;
    prompt: string;
    parts?: Array<{ name: string; generation_prompt: string }>;
  }) {
    const { component, versions } = await this.components.get(input.componentId);
    if (component.locked) throw new AppError("Locked components cannot be split", "locked", 409);
    const current = versions.find((v) => v.id === component.currentVersionId);
    if (!current?.geometryPath) throw new AppError("Component has no geometry to inspect", "no_geometry", 400);

    const meshInfo = await inspectGlbMeshes(current.geometryPath);
    const proposed =
      input.parts && input.parts.length >= 2
        ? input.parts
        : parseSplitPrompt(input.prompt, component.name);

    if (meshInfo.meshCount <= 1 && meshInfo.nodeCount <= 1) {
      // fall through to semantic regenerate
    }

    const created = [];
    for (const part of proposed) {
      const { component: child, version } = await this.components.createComponent({
        name: part.name,
        role: component.role,
        generationPrompt: part.generation_prompt,
        splitFromId: component.id,
        notes: `Split from ${component.name}: ${part.name}`,
      });
      await this.generation.generateGeometry(version.id, part.generation_prompt);
      created.push({ component: child, version });
    }

    await this.assemblies.removeInstancesForComponent(input.assemblyId, component.id);
    for (const [index, child] of created.entries()) {
      const planned = {
        name: child.component.name,
        role: child.component.role,
        quantity: 1,
        generation_prompt: child.version.generationPrompt,
      };
      const transform = defaultTransformFor(planned, index);
      await this.assemblies.addInstance({
        assemblyId: input.assemblyId,
        component: child.component,
        versionId: child.version.id,
        label: instanceLabel(child.component.name, created.length, index),
        instanceIndex: index,
        ...transform,
      });
    }

    return {
      mode: meshInfo.meshCount <= 1 ? ("semantic_regenerate" as const) : ("mesh_groups" as const),
      honesty:
        meshInfo.meshCount <= 1
          ? "Meshy/local GLBs are usually a single mesh. Caprio does not slice surfaces. It created new component identities and generated each requested part separately, leaving the original component versions intact."
          : "Multiple meshes were detected. Caprio still does not cut the original GLB in place; it created independently editable components for the requested parts.",
      meshInfo,
      created: created.map((c) => ({ id: c.component.id, name: c.component.name, versionId: c.version.id })),
    };
  }

  async merge(input: { componentIds: string[]; assemblyId: string; name?: string }) {
    if (input.componentIds.length < 2) {
      throw new AppError("Merge requires at least two components", "invalid_merge", 400);
    }
    const state = await this.db.read();
    const comps = input.componentIds.map((id) => {
      const component = state.components.find((c) => c.id === id);
      if (!component) throw new AppError(`Component ${id} not found`, "not_found", 404);
      if (component.locked) throw new AppError(`Component ${component.name} is locked`, "locked", 409);
      const version = state.componentVersions.find((v) => v.id === component.currentVersionId);
      if (!version) throw new AppError("Missing version", "no_version", 400);
      return { component, version };
    });

    const prompt = `Combined object made of: ${comps
      .map((c) => `${c.component.name} (${c.version.generationPrompt})`)
      .join(" AND ")}. Generate as one isolated 3D mesh.`;

    const { component, version } = await this.components.createComponent({
      name: input.name || comps.map((c) => c.component.name).join(" + "),
      role: "structural",
      generationPrompt: prompt,
      mergedFromIds: comps.map((c) => c.component.id),
      notes: "merged",
    });
    await this.generation.generateGeometry(version.id, prompt);

    for (const source of comps) {
      await this.assemblies.removeInstancesForComponent(input.assemblyId, source.component.id);
    }
    await this.assemblies.addInstance({
      assemblyId: input.assemblyId,
      component,
      versionId: version.id,
      label: component.name,
      instanceIndex: 0,
      position: { x: 0, y: 0.4, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    await this.assemblies.addDependency({
      fromComponentId: component.id,
      toComponentId: comps[0].component.id,
      kind: "structural",
      description: `Merged from ${comps.map((c) => c.component.name).join(", ")}`,
    });

    return {
      componentId: component.id,
      versionId: version.id,
      preservedSourceIds: comps.map((c) => c.component.id),
    };
  }
}

function parseSplitPrompt(prompt: string, originalName: string) {
  const match = prompt.match(/separate (the )?(.+) from (the )?(.+)/i);
  if (match) {
    return [
      { name: title(match[2]), generation_prompt: `Standalone 3D mesh of ${match[2]} from a ${originalName}, centered, no other parts.` },
      { name: title(match[4]), generation_prompt: `Standalone 3D mesh of ${match[4]} from a ${originalName}, centered, no other parts.` },
    ];
  }
  return [
    { name: `${originalName} A`, generation_prompt: `First part split from ${originalName}. ${prompt}` },
    { name: `${originalName} B`, generation_prompt: `Second part split from ${originalName}. ${prompt}` },
  ];
}

function title(value: string) {
  return value.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40);
}
