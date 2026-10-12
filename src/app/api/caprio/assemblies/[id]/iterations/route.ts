import { AppError } from "@/caprio/errors";
import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readBody<{ name?: string; note?: string; activateId?: string }>(request);
    if (body.activateId) {
      await getServices().assemblies.activateIteration(id, body.activateId);
      return jsonOk(await getServices().assemblies.get(id));
    }
    if (!body.name?.trim()) throw new AppError("iteration name is required", "invalid_request", 400);
    await getServices().assemblies.saveIteration(id, body.name.trim(), body.note || "");
    return jsonOk(await getServices().assemblies.get(id), 201);
  } catch (error) {
    return jsonError(error);
  }
}
