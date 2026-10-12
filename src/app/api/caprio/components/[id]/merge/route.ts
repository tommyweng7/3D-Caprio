import { AppError } from "@/caprio/errors";
import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readBody<{ assemblyId: string; otherComponentId: string; name?: string }>(request);
    if (!body.assemblyId || !body.otherComponentId) {
      throw new AppError("assemblyId and otherComponentId are required", "invalid_request", 400);
    }
    const result = await getServices().splitMerge.merge({
      componentIds: [id, body.otherComponentId],
      assemblyId: body.assemblyId,
      name: body.name,
    });
    const assembly = await getServices().assemblies.get(body.assemblyId);
    return jsonOk({ result, assembly });
  } catch (error) {
    return jsonError(error);
  }
}
