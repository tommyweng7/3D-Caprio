import { AppError } from "@/caprio/errors";
import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readBody<{
      x?: number;
      y?: number;
      z?: number;
      name?: string;
      unit?: "cm" | "m";
    }>(request);
    const scale = body.unit === "m" ? 1 : 0.01;
    const position = {
      x: (Number(body.x) || 0) * scale,
      y: (Number(body.y) || 0) * scale,
      z: (Number(body.z) || 0) * scale,
    };
    const assembly = await getServices().assemblies.addMarker(id, position, body.name);
    return jsonOk(assembly);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readBody<{ markerId?: string; name?: string }>(request);
    if (!body.markerId?.trim()) throw new AppError("markerId is required", "invalid_request", 400);
    if (!body.name?.trim()) throw new AppError("name is required", "invalid_request", 400);
    const assembly = await getServices().assemblies.renameMarker(id, body.markerId.trim(), body.name);
    return jsonOk(assembly);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const markerId = url.searchParams.get("markerId") || "";
    if (!markerId) throw new AppError("markerId is required", "invalid_request", 400);
    const assembly = await getServices().assemblies.removeMarker(id, markerId);
    return jsonOk(assembly);
  } catch (error) {
    return jsonError(error);
  }
}
