import { AppError } from "@/caprio/errors";
import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = await readBody<{ prompt: string }>(request);
    if (!body.prompt?.trim()) {
      return jsonError(new AppError("prompt is required", "invalid_request", 400));
    }
    const result = await getServices().planner.planObject(body.prompt.trim());
    return jsonOk(result);
  } catch (error) {
    console.error("POST /api/plan failed", error);
    return jsonError(error);
  }
}
