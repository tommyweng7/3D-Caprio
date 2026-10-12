import { AppError } from "@/caprio/errors";
import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readBody<{ versionId: string; assemblyId?: string; instanceId?: string }>(request);
    if (!body.versionId) throw new AppError("versionId is required", "invalid_request", 400);
    const component = await getServices().components.setCurrentVersion(id, body.versionId);
    if (body.instanceId) {
      await getServices().assemblies.replaceInstanceVersion(body.instanceId, body.versionId);
    } else if (body.assemblyId) {
      const bundle = await getServices().assemblies.get(body.assemblyId);
      for (const instance of bundle.instances.filter((i) => i.componentId === id)) {
        await getServices().assemblies.replaceInstanceVersion(instance.id, body.versionId);
      }
    }
    const detail = await getServices().components.get(id);
    return jsonOk({ switched: component, ...detail });
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return jsonOk(await getServices().components.get(id));
  } catch (error) {
    return jsonError(error);
  }
}
