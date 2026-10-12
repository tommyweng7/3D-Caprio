import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readBody<{ locked?: boolean }>(request);
    const component = await getServices().components.setLocked(id, body.locked ?? true);
    return jsonOk({ component });
  } catch (error) {
    return jsonError(error);
  }
}
