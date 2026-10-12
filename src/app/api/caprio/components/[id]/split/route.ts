import { AppError } from "@/caprio/errors";
import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readBody<{
      assemblyId: string;
      prompt: string;
      parts?: Array<{ name: string; generation_prompt: string }>;
    }>(request);
    if (!body.assemblyId || !body.prompt) {
      throw new AppError("assemblyId and prompt are required", "invalid_request", 400);
    }
    const result = await getServices().splitMerge.split({
      componentId: id,
      assemblyId: body.assemblyId,
      prompt: body.prompt,
      parts: body.parts,
    });
    const assembly = await getServices().assemblies.get(body.assemblyId);
    return jsonOk({ result, assembly });
  } catch (error) {
    return jsonError(error);
  }
}
