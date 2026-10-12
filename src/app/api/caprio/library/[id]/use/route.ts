import { AppError } from "@/caprio/errors";
import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readBody<{ assemblyId: string }>(request);
    if (!body.assemblyId) throw new AppError("assemblyId is required", "invalid_request", 400);
    const { instance, compatibility } = await getServices().library.use(id, body.assemblyId);
    const assembly = await getServices().assemblies.get(body.assemblyId);
    return jsonOk({ instance, assembly, compatibility });
  } catch (error) {
    return jsonError(error);
  }
}
