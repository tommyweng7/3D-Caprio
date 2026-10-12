import { AppError } from "@/caprio/errors";
import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readBody<{
      prompt: string;
      assemblyId: string;
      instanceId?: string;
      applyTo?: "instance" | "definition";
      stage?: "blockout" | "form" | "detail";
    }>(request);
    if (!body.prompt?.trim() || !body.assemblyId) {
      throw new AppError("prompt and assemblyId are required", "invalid_request", 400);
    }
    const result = await getServices().edits.edit({
      componentId: id,
      assemblyId: body.assemblyId,
      instanceId: body.instanceId,
      prompt: body.prompt.trim(),
      applyTo: body.applyTo,
      stage: body.stage,
    });
    const detail = await getServices().components.get(result.componentId);
    const assembly = await getServices().assemblies.get(body.assemblyId);
    return jsonOk({ result, ...detail, assembly });
  } catch (error) {
    return jsonError(error);
  }
}
