import { AppError } from "@/caprio/errors";
import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readBody<{
      instanceIds?: string[];
      x?: number;
      y?: number;
      z?: number;
      unit?: "cm" | "m";
    }>(request);
    const instanceIds = (body.instanceIds || []).filter(Boolean);
    if (!instanceIds.length) {
      throw new AppError("instanceIds are required", "invalid_request", 400);
    }
    const scale = body.unit === "m" ? 1 : 0.01;
    const delta = {
      x: (Number(body.x) || 0) * scale,
      y: (Number(body.y) || 0) * scale,
      z: (Number(body.z) || 0) * scale,
    };
    if (!delta.x && !delta.y && !delta.z) {
      throw new AppError("Provide a non-zero X, Y, or Z offset", "invalid_request", 400);
    }
    const assembly = await getServices().assemblies.nudgeInstances(id, instanceIds, delta);
    return jsonOk(assembly);
  } catch (error) {
    return jsonError(error);
  }
}
