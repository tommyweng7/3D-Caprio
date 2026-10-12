import { jsonError, jsonOk } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const task = await getServices().generation.getTask(id);
    return jsonOk({ task });
  } catch (error) {
    return jsonError(error);
  }
}
