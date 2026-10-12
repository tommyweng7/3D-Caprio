import { AppError } from "@/caprio/errors";
import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readBody<{
      prompt: string;
      componentId?: string;
      instanceId?: string;
    }>(request);
    if (!body.prompt?.trim()) throw new AppError("prompt is required", "invalid_request", 400);
    const preview = await getServices().edits.preview({
      assemblyId: id,
      prompt: body.prompt.trim(),
      componentId: body.componentId,
      instanceId: body.instanceId,
    });
    return jsonOk(preview);
  } catch (error) {
    return jsonError(error);
  }
}
