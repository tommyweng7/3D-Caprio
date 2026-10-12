import { jsonError, jsonOk } from "@/caprio/http";
import { getServices } from "@/caprio/services/container";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return jsonOk(await getServices().assemblies.get(id));
  } catch (error) {
    return jsonError(error);
  }
}
