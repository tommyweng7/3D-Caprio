import type { Database } from "@/caprio/db/database";
import type {
  Component,
  ComponentVersion,
  ConnectionPoint,
  DetailStage,
  Parameter,
} from "@/caprio/domain/types";
import type { CadSource } from "@/caprio/threed/cad";
import { AppError } from "@/caprio/errors";
import { slugify, uuid } from "@/caprio/ids";
import { inferDna, overlayDna } from "@/caprio/services/semantics";
import { versionTitle } from "@/caprio/services/version-title";

export class ComponentService {
  constructor(private readonly db: Database) {}

  async createComponent(input: {
    name: string;
    role: Component["role"];
    generationPrompt: string;
    parameters?: Omit<Parameter, "id">[];
    connectionPoints?: Omit<ConnectionPoint, "id">[];
    notes?: string;
    splitFromId?: string | null;
    mergedFromIds?: string[];
    sourceEditRequestId?: string | null;
    providerTaskId?: string | null;
    geometryPath?: string | null;
    cadSource?: CadSource | null;
    purpose?: string;
    style?: string;
    material?: string;
    description?: string;
    constraints?: string[];
    rationale?: string;
    derivedFromId?: string | null;
    parentId?: string | null;
    stage?: DetailStage;
  }): Promise<{ component: Component; version: ComponentVersion }> {
    const now = new Date().toISOString();
    const componentId = slugify(input.name) + "_" + uuid().slice(0, 8);
    const versionId = uuid();
    const parameters = (input.parameters || []).map((p) => ({ ...p, id: uuid() }));
    const connectionPoints = (input.connectionPoints || []).map((c) => ({ ...c, id: uuid() }));
    const dna = inferDna({
      name: input.name,
      role: input.role,
      prompt: input.generationPrompt,
      parameters,
      connectionPoints,
      purpose: input.purpose,
      style: input.style,
      material: input.material,
      constraints: input.constraints,
      rationale: input.rationale,
    });
    const version: ComponentVersion = {
      id: versionId,
      componentId,
      versionNumber: 1,
      label: versionTitle(input.name, input.generationPrompt, 1),
      generationPrompt: input.generationPrompt,
      geometryPath: input.geometryPath ?? null,
      thumbnailUrl: null,
      parameters,
      connectionPoints,
      createdAt: now,
      sourceEditRequestId: input.sourceEditRequestId ?? null,
      providerTaskId: input.providerTaskId ?? null,
      notes: input.notes || "original",
      cadSource: input.cadSource ?? null,
      parentVersionId: null,
      branchName: "main",
      dna,
      stage: input.stage || "blockout",
    };
    const component: Component = {
      id: componentId,
      name: input.name,
      role: input.role,
      locked: false,
      currentVersionId: versionId,
      createdAt: now,
      updatedAt: now,
      splitFromId: input.splitFromId ?? null,
      mergedFromIds: input.mergedFromIds ?? [],
      description: input.description || dna.purpose,
      purpose: dna.purpose,
      style: dna.style,
      materials: dna.material && dna.material !== "unspecified" ? [dna.material] : [],
      parentId: input.parentId ?? null,
      derivedFromId: input.derivedFromId ?? null,
      libraryStatus: "none",
      rationale: input.rationale || "",
      dna,
    };

    await this.db.write((state) => {
      state.components.push(component);
      state.componentVersions.push(version);
      state.parameters.push(...version.parameters);
      state.connectionPoints.push(...version.connectionPoints);
    });
    return { component, version };
  }

  async addVersion(input: {
    componentId: string;
    generationPrompt: string;
    geometryPath?: string | null;
    parameters?: Parameter[];
    connectionPoints?: ConnectionPoint[];
    notes: string;
    sourceEditRequestId?: string | null;
    providerTaskId?: string | null;
    allowLocked?: boolean;
    cadSource?: CadSource | null;
    branchName?: string;
    stage?: DetailStage;
    label?: string;
  }): Promise<ComponentVersion> {
    const state = await this.db.read();
    const component = state.components.find((c) => c.id === input.componentId);
    if (!component) throw new AppError("Component not found", "not_found", 404);
    if (component.locked && !input.allowLocked) {
      throw new AppError("Component is locked and cannot be modified", "locked", 409);
    }
    const siblings = state.componentVersions.filter((v) => v.componentId === input.componentId);
    const parent = siblings.find((v) => v.id === component.currentVersionId) || siblings.at(-1);
    const versionNumber = Math.max(0, ...siblings.map((v) => v.versionNumber)) + 1;
    const parameters = input.parameters || parent?.parameters || [];
    const connectionPoints = input.connectionPoints || parent?.connectionPoints || [];
    const dna = {
      ...overlayDna(parent?.dna || component.dna, input.generationPrompt, parameters),
      connections: connectionPoints.map((p) => p.name),
      purpose: parent?.dna?.purpose || component.purpose || overlayDna(parent?.dna, input.generationPrompt, parameters).purpose,
    };
    const version: ComponentVersion = {
      id: uuid(),
      componentId: input.componentId,
      versionNumber,
      label: input.label || versionTitle(component.name, input.notes || input.generationPrompt, versionNumber),
      generationPrompt: input.generationPrompt,
      geometryPath: input.geometryPath ?? null,
      thumbnailUrl: null,
      parameters,
      connectionPoints,
      createdAt: new Date().toISOString(),
      sourceEditRequestId: input.sourceEditRequestId ?? null,
      providerTaskId: input.providerTaskId ?? null,
      notes: input.notes,
      cadSource: input.cadSource ?? parent?.cadSource ?? null,
      parentVersionId: parent?.id ?? null,
      branchName: input.branchName || parent?.branchName || "main",
      dna,
      stage: input.stage || parent?.stage || "form",
    };

    await this.db.write((draft) => {
      const current = draft.components.find((c) => c.id === input.componentId);
      if (!current) throw new AppError("Component not found", "not_found", 404);
      if (current.locked && !input.allowLocked) {
        throw new AppError("Component is locked and cannot be modified", "locked", 409);
      }
      draft.componentVersions.push(version);
      draft.parameters.push(...version.parameters);
      draft.connectionPoints.push(...version.connectionPoints);
      current.currentVersionId = version.id;
      current.updatedAt = version.createdAt;
      current.dna = dna;
      if (dna.style) current.style = dna.style;
      if (dna.material && dna.material !== "unspecified") {
        current.materials = [...new Set([...(current.materials || []), dna.material])];
      }
    });
    return version;
  }

  async setCurrentVersion(componentId: string, versionId: string): Promise<Component> {
    let updated: Component | undefined;
    await this.db.write((state) => {
      const component = state.components.find((c) => c.id === componentId);
      if (!component) throw new AppError("Component not found", "not_found", 404);
      if (component.locked) throw new AppError("Component is locked", "locked", 409);
      const version = state.componentVersions.find((v) => v.id === versionId && v.componentId === componentId);
      if (!version) throw new AppError("Version not found for this component", "not_found", 404);
      component.currentVersionId = version.id;
      component.updatedAt = new Date().toISOString();
      updated = component;
    });
    return updated!;
  }

  async setLocked(componentId: string, locked: boolean): Promise<Component> {
    let updated: Component | undefined;
    await this.db.write((state) => {
      const component = state.components.find((c) => c.id === componentId);
      if (!component) throw new AppError("Component not found", "not_found", 404);
      component.locked = locked;
      component.updatedAt = new Date().toISOString();
      updated = component;
    });
    return updated!;
  }

  async get(componentId: string) {
    const state = await this.db.read();
    const component = state.components.find((c) => c.id === componentId);
    if (!component) throw new AppError("Component not found", "not_found", 404);
    const versions = state.componentVersions
      .filter((v) => v.componentId === componentId)
      .sort((a, b) => a.versionNumber - b.versionNumber);
    return { component, versions };
  }

  async attachCad(versionId: string, cad: CadSource) {
    await this.db.write((state) => {
      const version = state.componentVersions.find((v) => v.id === versionId);
      if (!version) throw new AppError("Version not found", "not_found", 404);
      version.cadSource = cad;
    });
  }

  async attachGeometry(versionId: string, geometryPath: string, providerTaskId?: string) {
    await this.db.write((state) => {
      const version = state.componentVersions.find((v) => v.id === versionId);
      if (!version) throw new AppError("Version not found", "not_found", 404);
      version.geometryPath = geometryPath;
      if (providerTaskId) version.providerTaskId = providerTaskId;
    });
  }

  async cloneForDetach(componentId: string): Promise<{ component: Component; versions: ComponentVersion[] }> {
    const { component, versions } = await this.get(componentId);
    const now = new Date().toISOString();
    const newId = slugify(component.name) + "_" + uuid().slice(0, 8);
    const clonedVersions: ComponentVersion[] = versions.map((version) => ({
      ...structuredClone(version),
      id: uuid(),
      componentId: newId,
      createdAt: now,
      notes: `${version.notes} (detached copy of ${version.label})`,
    }));
    const current = clonedVersions.find((v) => versions.find((o) => o.id === component.currentVersionId)?.versionNumber === v.versionNumber);
    const clone: Component = {
      ...component,
      id: newId,
      currentVersionId: current?.id || clonedVersions.at(-1)?.id || null,
      createdAt: now,
      updatedAt: now,
      derivedFromId: componentId,
      locked: false,
    };
    await this.db.write((state) => {
      state.components.push(clone);
      state.componentVersions.push(...clonedVersions);
    });
    return { component: clone, versions: clonedVersions };
  }

  async updateParametersOnCurrentVersion(componentId: string, parameters: Parameter[]) {
    await this.db.write((state) => {
      const component = state.components.find((c) => c.id === componentId);
      if (!component) throw new AppError("Component not found", "not_found", 404);
      if (component.locked) throw new AppError("Component is locked", "locked", 409);
      const version = state.componentVersions.find((v) => v.id === component.currentVersionId);
      if (!version) throw new AppError("Version not found", "not_found", 404);
      version.parameters = parameters;
      component.updatedAt = new Date().toISOString();
    });
  }
}
