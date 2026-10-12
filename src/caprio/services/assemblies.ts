import type { Database } from "@/caprio/db/database";
import type { Assembly, AssemblyComponent, Component, ComponentVersion, Dependency, DetailStage, SceneMarker, Vec3 } from "@/caprio/domain/types";
import { AppError } from "@/caprio/errors";
import { uuid } from "@/caprio/ids";
import {
  checkCompatibility,
  componentUsages,
  makeBranch,
  snapshotPins,
} from "@/caprio/services/semantics";
import { nextPinName } from "@/caprio/threed/measure";

export class AssemblyService {
  constructor(private readonly db: Database) {}

  async list(): Promise<Assembly[]> {
    const state = await this.db.read();
    return [...state.assemblies].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(name: string, prompt: string): Promise<Assembly> {
    const now = new Date().toISOString();
    const assembly: Assembly = {
      id: uuid(),
      name,
      prompt,
      createdAt: now,
      updatedAt: now,
      status: "planning",
      error: null,
    };
    await this.db.write((state) => {
      state.assemblies.push(assembly);
    });
    return assembly;
  }

  async get(id: string) {
    const state = await this.db.read();
    const assembly = state.assemblies.find((a) => a.id === id);
    if (!assembly) throw new AppError("Assembly not found", "not_found", 404);
    const instances = (state.assemblyComponents || []).filter((i) => i.assemblyId === id);
    const componentIds = [...new Set(instances.map((i) => i.componentId))];
    const components = (state.components || []).filter((c) => componentIds.includes(c.id));
    const versions = (state.componentVersions || []).filter((v) => componentIds.includes(v.componentId));
    const dependencies = (state.dependencies || []).filter(
      (d) => componentIds.includes(d.fromComponentId) || componentIds.includes(d.toComponentId),
    );
    const branches = (state.designBranches || []).filter((b) => b.assemblyId === id);
    const changeSets = (state.changeSets || []).filter((c) => c.assemblyId === id).slice(-8);
    const decisions = (state.designDecisions || []).filter((d) => d.assemblyId === id).slice(-20);
    const graph = components.map((component) => {
      const kids = instances.filter((i) => i.componentId === component.id);
      const version = versions.find((v) => v.id === (kids[0]?.versionId || component.currentVersionId));
      return {
        componentId: component.id,
        name: component.name,
        role: component.role,
        locked: component.locked,
        instances: kids.length,
        currentVersion: version?.label || null,
        lineage: version ? `${component.id}:${version.label}` : component.id,
        purpose: component.purpose || component.dna?.purpose || "",
        style: component.style || component.dna?.style || "",
        children: [],
        dependents: dependencies
          .filter((d) => d.toComponentId === component.id)
          .map((d) => d.fromComponentId),
        dependencies: dependencies
          .filter((d) => d.fromComponentId === component.id)
          .map((d) => ({ to: d.toComponentId, kind: d.kind, description: d.description })),
      };
    });
    return {
      assembly,
      instances,
      components,
      versions,
      dependencies,
      branches,
      iterations: (state.designIterations || []).filter((i) => i.assemblyId === id),
      markers: (state.markers || []).filter((marker) => marker.assemblyId === id),
      changeSets,
      decisions,
      graph,
    };
  }

  async setStatus(id: string, status: Assembly["status"], error?: string | null) {
    await this.db.write((state) => {
      const assembly = state.assemblies.find((a) => a.id === id);
      if (!assembly) throw new AppError("Assembly not found", "not_found", 404);
      assembly.status = status;
      assembly.error = error ?? null;
      assembly.updatedAt = new Date().toISOString();
    });
  }

  async addInstance(input: {
    assemblyId: string;
    component: Component;
    versionId: string;
    label: string;
    instanceIndex: number;
    position: Vec3;
    rotation: Vec3;
    scale: Vec3;
  }): Promise<AssemblyComponent> {
    const instance: AssemblyComponent = {
      id: uuid(),
      assemblyId: input.assemblyId,
      componentId: input.component.id,
      versionId: input.versionId,
      label: input.label,
      instanceIndex: input.instanceIndex,
      position: input.position,
      rotation: input.rotation,
      scale: input.scale,
      detached: false,
    };
    await this.db.write((state) => {
      state.assemblyComponents.push(instance);
      const assembly = state.assemblies.find((a) => a.id === input.assemblyId);
      const branch = state.designBranches.find((b) => b.id === assembly?.activeBranchId);
      if (branch) {
        branch.pins.push({
          instanceId: instance.id,
          componentId: instance.componentId,
          versionId: instance.versionId,
        });
      }
    });
    return instance;
  }

  async applyTransforms(
    updates: Array<{ id: string; position: Vec3; rotation: Vec3; scale: Vec3 }>,
  ) {
    await this.db.write((state) => {
      for (const update of updates) {
        const instance = state.assemblyComponents.find((item) => item.id === update.id);
        if (!instance) continue;
        instance.position = update.position;
        instance.rotation = update.rotation;
        instance.scale = update.scale;
      }
    });
  }

  async nudgeInstances(assemblyId: string, instanceIds: string[], delta: Vec3) {
    const owned = new Set(
      (await this.db.read()).assemblyComponents
        .filter((item) => item.assemblyId === assemblyId && instanceIds.includes(item.id))
        .map((item) => item.id),
    );
    if (!owned.size) throw new AppError("No matching instances in this assembly", "not_found", 404);
    await this.db.write((state) => {
      for (const instance of state.assemblyComponents) {
        if (!owned.has(instance.id)) continue;
        instance.position = {
          x: instance.position.x + delta.x,
          y: instance.position.y + delta.y,
          z: instance.position.z + delta.z,
        };
      }
      const assembly = state.assemblies.find((item) => item.id === assemblyId);
      if (assembly) assembly.updatedAt = new Date().toISOString();
    });
    return this.get(assemblyId);
  }

  async addMarker(assemblyId: string, position: Vec3, name?: string) {
    const state = await this.db.read();
    const assembly = state.assemblies.find((item) => item.id === assemblyId);
    if (!assembly) throw new AppError("Assembly not found", "not_found", 404);
    const existing = (state.markers || []).filter((marker) => marker.assemblyId === assemblyId);
    const marker: SceneMarker = {
      id: uuid(),
      assemblyId,
      name: name?.trim() || nextPinName(existing.map((item) => item.name)),
      position: { x: position.x, y: position.y, z: position.z },
      createdAt: new Date().toISOString(),
    };
    await this.db.write((state) => {
      state.markers = state.markers || [];
      state.markers.push(marker);
    });
    return this.get(assemblyId);
  }

  async renameMarker(assemblyId: string, markerId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new AppError("Pin name is required", "invalid_request", 400);
    await this.db.write((state) => {
      const marker = (state.markers || []).find((item) => item.assemblyId === assemblyId && item.id === markerId);
      if (!marker) throw new AppError("Pin not found", "not_found", 404);
      marker.name = trimmed;
    });
    return this.get(assemblyId);
  }

  async removeMarker(assemblyId: string, markerId: string) {
    await this.db.write((state) => {
      state.markers = (state.markers || []).filter((marker) => !(marker.assemblyId === assemblyId && marker.id === markerId));
    });
    return this.get(assemblyId);
  }

  async replaceInstanceVersion(instanceId: string, versionId: string) {
    await this.db.write((state) => {
      const instance = state.assemblyComponents.find((i) => i.id === instanceId);
      if (!instance) throw new AppError("Assembly instance not found", "not_found", 404);
      const version = state.componentVersions.find((v) => v.id === versionId);
      if (!version || version.componentId !== instance.componentId) {
        throw new AppError("Version does not belong to this component", "invalid_version", 400);
      }
      instance.versionId = versionId;
      const assembly = state.assemblies.find((a) => a.id === instance.assemblyId);
      const branch = state.designBranches.find((b) => b.id === assembly?.activeBranchId);
      if (branch) {
        const pin = branch.pins.find((p) => p.instanceId === instanceId);
        if (pin) pin.versionId = versionId;
      }
    });
  }

  async replaceComponentInAssembly(assemblyId: string, fromComponentId: string, toComponentId: string, versionId: string) {
    await this.db.write((state) => {
      const instances = state.assemblyComponents.filter(
        (i) => i.assemblyId === assemblyId && i.componentId === fromComponentId,
      );
      if (!instances.length) throw new AppError("No matching instances", "not_found", 404);
      for (const instance of instances) {
        instance.componentId = toComponentId;
        instance.versionId = versionId;
      }
    });
  }

  async addDependency(dep: Omit<Dependency, "id">) {
    const full: Dependency = { ...dep, id: uuid() };
    await this.db.write((state) => state.dependencies.push(full));
    return full;
  }

  async relatedComponentIds(componentId: string): Promise<Set<string>> {
    const state = await this.db.read();
    const related = new Set<string>([componentId]);
    for (const dep of state.dependencies) {
      if (dep.fromComponentId === componentId) related.add(dep.toComponentId);
      if (dep.toComponentId === componentId) related.add(dep.fromComponentId);
    }
    return related;
  }

  async applyParameterScale(instanceId: string, parameters: { key: string; value: number | string }[]) {
    await this.db.write((state) => {
      const instance = state.assemblyComponents.find((i) => i.id === instanceId);
      if (!instance) throw new AppError("Assembly instance not found", "not_found", 404);
      const num = (key: string) => {
        const found = parameters.find((p) => p.key === key);
        return typeof found?.value === "number" ? found.value : null;
      };
      const height = num("height");
      const width = num("width");
      const depth = num("depth");
      if (height && height > 0) instance.scale.y = height / 0.45;
      if (width && width > 0) instance.scale.x = width / 0.5;
      if (depth && depth > 0) instance.scale.z = depth / 0.5;
    });
  }

  async reassignInstance(instanceId: string, componentId: string, versionId: string, detached = true) {
    await this.db.write((state) => {
      const instance = state.assemblyComponents.find((i) => i.id === instanceId);
      if (!instance) throw new AppError("Assembly instance not found", "not_found", 404);
      instance.componentId = componentId;
      instance.versionId = versionId;
      instance.detached = detached;
      const assembly = state.assemblies.find((a) => a.id === instance.assemblyId);
      const branch = state.designBranches.find((b) => b.id === assembly?.activeBranchId);
      if (branch) {
        const pin = branch.pins.find((p) => p.instanceId === instanceId);
        if (pin) {
          pin.componentId = componentId;
          pin.versionId = versionId;
        }
      }
    });
  }

  async ensureMainBranch(assemblyId: string) {
    const state = await this.db.read();
    const existing = state.designBranches.find((b) => b.assemblyId === assemblyId);
    if (existing) return existing;
    const instances = state.assemblyComponents.filter((i) => i.assemblyId === assemblyId);
    const branch = makeBranch({
      assemblyId,
      name: "Original",
      parentBranchId: null,
      instances,
    });
    await this.db.write((draft) => {
      draft.designBranches.push(branch);
      const assembly = draft.assemblies.find((a) => a.id === assemblyId);
      if (assembly) assembly.activeBranchId = branch.id;
    });
    return branch;
  }

  async saveIteration(assemblyId: string, name: string, note = "") {
    const state = await this.db.read();
    const assembly = state.assemblies.find((a) => a.id === assemblyId);
    if (!assembly) throw new AppError("Assembly not found", "not_found", 404);
    const instances = state.assemblyComponents.filter((i) => i.assemblyId === assemblyId);
    const stages = instances
      .map((instance) => state.componentVersions.find((v) => v.id === instance.versionId)?.stage)
      .filter(Boolean);
    const stage: DetailStage = stages.includes("detail")
      ? "detail"
      : stages.includes("form")
        ? "form"
        : "blockout";
    const iteration = {
      id: uuid(),
      assemblyId,
      name,
      note,
      parentIterationId: assembly.activeIterationId || null,
      createdAt: new Date().toISOString(),
      stage,
      pins: instances.map((instance) => {
        const component = state.components.find((c) => c.id === instance.componentId);
        const version = state.componentVersions.find((v) => v.id === instance.versionId);
        return {
          instanceId: instance.id,
          componentId: instance.componentId,
          versionId: instance.versionId,
          name: component?.name || instance.label,
          versionLabel: version?.label || "v?",
        };
      }),
    };
    await this.db.write((draft) => {
      draft.designIterations.push(iteration);
      const current = draft.assemblies.find((a) => a.id === assemblyId);
      if (current) {
        current.activeIterationId = iteration.id;
        current.updatedAt = iteration.createdAt;
      }
    });
    return iteration;
  }

  async activateIteration(assemblyId: string, iterationId: string) {
    await this.db.write((state) => {
      const assembly = state.assemblies.find((a) => a.id === assemblyId);
      if (!assembly) throw new AppError("Assembly not found", "not_found", 404);
      const iteration = state.designIterations.find((i) => i.id === iterationId && i.assemblyId === assemblyId);
      if (!iteration) throw new AppError("Iteration not found", "not_found", 404);
      for (const pin of iteration.pins) {
        const instance = state.assemblyComponents.find((i) => i.id === pin.instanceId);
        if (!instance) continue;
        instance.componentId = pin.componentId;
        instance.versionId = pin.versionId;
      }
      assembly.activeIterationId = iteration.id;
      assembly.updatedAt = new Date().toISOString();
    });
  }

  async createBranch(assemblyId: string, name: string) {
    const state = await this.db.read();
    const assembly = state.assemblies.find((a) => a.id === assemblyId);
    if (!assembly) throw new AppError("Assembly not found", "not_found", 404);
    const instances = state.assemblyComponents.filter((i) => i.assemblyId === assemblyId);
    const branch = makeBranch({
      assemblyId,
      name,
      parentBranchId: assembly.activeBranchId || null,
      instances,
    });
    await this.db.write((draft) => {
      draft.designBranches.push(branch);
      const current = draft.assemblies.find((a) => a.id === assemblyId);
      if (current) {
        current.activeBranchId = branch.id;
        current.updatedAt = branch.createdAt;
      }
    });
    return branch;
  }

  async activateBranch(assemblyId: string, branchId: string) {
    await this.db.write((state) => {
      const assembly = state.assemblies.find((a) => a.id === assemblyId);
      if (!assembly) throw new AppError("Assembly not found", "not_found", 404);
      const branch = state.designBranches.find((b) => b.id === branchId && b.assemblyId === assemblyId);
      if (!branch) throw new AppError("Branch not found", "not_found", 404);
      for (const pin of branch.pins) {
        const instance = state.assemblyComponents.find((i) => i.id === pin.instanceId);
        if (!instance) continue;
        instance.componentId = pin.componentId;
        instance.versionId = pin.versionId;
      }
      assembly.activeBranchId = branch.id;
      assembly.updatedAt = new Date().toISOString();
    });
  }

  async refreshActivePins(assemblyId: string) {
    await this.db.write((state) => {
      const assembly = state.assemblies.find((a) => a.id === assemblyId);
      const branch = state.designBranches.find((b) => b.id === assembly?.activeBranchId);
      if (!branch) return;
      const instances = state.assemblyComponents.filter((i) => i.assemblyId === assemblyId);
      branch.pins = snapshotPins(instances);
    });
  }

  usagesFor(componentId: string) {
    return this.db.read().then((state) =>
      componentUsages(componentId, state.assemblies, state.assemblyComponents),
    );
  }

  compatibilityForInsert(incomingComponent: Component, incomingVersion: ComponentVersion, assemblyId: string) {
    return this.db.read().then((state) => {
      const instances = state.assemblyComponents.filter((i) => i.assemblyId === assemblyId);
      const componentIds = [...new Set(instances.map((i) => i.componentId))];
      return checkCompatibility(incomingVersion, incomingComponent, {
        components: state.components.filter((c) => componentIds.includes(c.id)),
        versions: state.componentVersions.filter((v) => componentIds.includes(v.componentId)),
        dependencies: state.dependencies.filter(
          (d) => componentIds.includes(d.fromComponentId) || componentIds.includes(d.toComponentId),
        ),
      });
    });
  }

  async removeInstancesForComponent(assemblyId: string, componentId: string) {
    await this.db.write((state) => {
      state.assemblyComponents = state.assemblyComponents.filter(
        (i) => !(i.assemblyId === assemblyId && i.componentId === componentId),
      );
      const assembly = state.assemblies.find((a) => a.id === assemblyId);
      const branch = state.designBranches.find((b) => b.id === assembly?.activeBranchId);
      if (branch) {
        branch.pins = branch.pins.filter((p) => p.componentId !== componentId);
      }
    });
  }
}
