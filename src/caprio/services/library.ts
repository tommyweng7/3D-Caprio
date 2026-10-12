import type { Database } from "@/caprio/db/database";
import type { LibraryItem } from "@/caprio/domain/types";
import { AppError } from "@/caprio/errors";
import { uuid } from "@/caprio/ids";
import { AssemblyService } from "@/caprio/services/assemblies";
import { defaultTransformFor, instanceLabel } from "@/caprio/services/layout";

export class LibraryService {
  constructor(
    private readonly db: Database,
    private readonly assemblies: AssemblyService,
  ) {}

  async save(input: {
    name: string;
    description?: string;
    componentId: string;
    versionId?: string;
    tags?: string[];
  }): Promise<LibraryItem> {
    const state = await this.db.read();
    const component = state.components.find((c) => c.id === input.componentId);
    if (!component) throw new AppError("Component not found", "not_found", 404);
    const versionId = input.versionId || component.currentVersionId;
    if (!versionId) throw new AppError("Component has no version to save", "no_version", 400);
    const version = state.componentVersions.find((v) => v.id === versionId);
    if (!version) throw new AppError("Version not found", "not_found", 404);

    const item: LibraryItem = {
      id: uuid(),
      name: input.name,
      description: input.description || component.name,
      componentId: component.id,
      savedVersionId: version.id,
      tags: input.tags || [component.role],
      createdAt: new Date().toISOString(),
    };
    await this.db.write((draft) => {
      draft.libraryItems.push(item);
      const saved = draft.components.find((c) => c.id === component.id);
      if (saved) saved.libraryStatus = "saved";
    });
    return item;
  }

  async list(query?: string): Promise<LibraryItem[]> {
    const state = await this.db.read();
    const q = (query || "").toLowerCase();
    return state.libraryItems.filter((item) => {
      if (!q) return true;
      const component = state.components.find((c) => c.id === item.componentId);
      const version = state.componentVersions.find((v) => v.id === item.savedVersionId);
      const haystack = [
        item.name,
        item.description,
        item.tags.join(" "),
        component?.name,
        component?.purpose,
        component?.style,
        component?.materials?.join(" "),
        version?.dna?.purpose,
        version?.dna?.style,
        version?.dna?.material,
        String(version?.dna?.geometry.height || ""),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  async use(libraryItemId: string, assemblyId: string) {
    const state = await this.db.read();
    const item = state.libraryItems.find((i) => i.id === libraryItemId);
    if (!item) throw new AppError("Library item not found", "not_found", 404);
    const component = state.components.find((c) => c.id === item.componentId);
    const version = state.componentVersions.find((v) => v.id === item.savedVersionId);
    if (!component || !version) throw new AppError("Saved component is missing", "not_found", 404);
    const existing = state.assemblyComponents.filter((i) => i.assemblyId === assemblyId);
    const count = existing.filter((i) => i.componentId === component.id).length;
    const planned = {
      name: component.name,
      role: component.role,
      quantity: 1,
      generation_prompt: version.generationPrompt,
    };
    const transform = defaultTransformFor(planned, count);
    const compatibility = await this.assemblies.compatibilityForInsert(component, version, assemblyId);
    const instance = await this.assemblies.addInstance({
      assemblyId,
      component,
      versionId: version.id,
      label: instanceLabel(component.name, count + 1, count),
      instanceIndex: count,
      ...transform,
    });
    return { instance, compatibility };
  }
}
