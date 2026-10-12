import { AppError } from "@/caprio/errors";
import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readBody<{ prompt: string }>(request);
    if (!body.prompt) throw new AppError("prompt is required", "invalid_request", 400);
    const results = await getServices().edits.applyBroadChange(id, body.prompt);
    const assembly = await getServices().assemblies.get(id);
    return jsonOk({ results, assembly });
  } catch (error) {
    return jsonError(error);
  }
}
