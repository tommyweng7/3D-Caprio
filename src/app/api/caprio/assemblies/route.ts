import { AppError } from "@/caprio/errors";
import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export async function GET() {
  try {
    return jsonOk({ assemblies: await getServices().assemblies.list() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readBody<{ name: string; prompt?: string }>(request);
    if (!body.name) throw new AppError("name is required", "invalid_request", 400);
    const assembly = await getServices().assemblies.create(body.name, body.prompt || "");
    return jsonOk({ assembly }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
