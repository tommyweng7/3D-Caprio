import { AppError } from "@/caprio/errors";
import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readBody<{ name?: string; activateId?: string }>(request);
    if (body.activateId) {
      await getServices().assemblies.activateBranch(id, body.activateId);
      return jsonOk(await getServices().assemblies.get(id));
    }
    if (!body.name?.trim()) throw new AppError("branch name is required", "invalid_request", 400);
    await getServices().assemblies.createBranch(id, body.name.trim());
    return jsonOk(await getServices().assemblies.get(id), 201);
  } catch (error) {
    return jsonError(error);
  }
}
