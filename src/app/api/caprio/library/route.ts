import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("q") || undefined;
    const items = await getServices().library.list(query);
    const state = await getServices().db.read();
    const hydrated = items.map((item) => {
      const component = state.components.find((c) => c.id === item.componentId);
      const version = state.componentVersions.find((v) => v.id === item.savedVersionId);
      const usages = state.assemblyComponents.filter((i) => i.componentId === item.componentId);
      const assemblyIds = [...new Set(usages.map((i) => i.assemblyId))];
      return {
        ...item,
        component,
        version,
        usedIn: assemblyIds.map((id) => state.assemblies.find((a) => a.id === id)?.name || id),
      };
    });
    return jsonOk({ items: hydrated });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readBody<{
      name: string;
      componentId: string;
      versionId?: string;
      description?: string;
      tags?: string[];
    }>(request);
    const item = await getServices().library.save(body);
    return jsonOk({ item }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
