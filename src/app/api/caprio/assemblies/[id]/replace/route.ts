import { AppError } from "@/caprio/errors";
import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readBody<{ instanceId: string; versionId: string }>(request);
    if (!body.instanceId || !body.versionId) {
      throw new AppError("instanceId and versionId are required", "invalid_request", 400);
    }
    await getServices().assemblies.replaceInstanceVersion(body.instanceId, body.versionId);
    return jsonOk(await getServices().assemblies.get(id));
  } catch (error) {
    return jsonError(error);
  }
}
