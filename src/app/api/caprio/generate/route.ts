import { after } from "next/server";
import { AppError } from "@/caprio/errors";
import { jsonError, jsonOk, readBody } from "@/caprio/http";
import { componentPlanSchema } from "@/caprio/schemas/plan";
import { getServices } from "@/caprio/services/container";

export const maxDuration = 800;

export async function POST(request: Request) {
  try {
    const body = await readBody<{ prompt: string; plan?: unknown }>(request);
    if (!body.prompt?.trim()) throw new AppError("prompt is required", "invalid_request", 400);
    const services = getServices();
    const planned = body.plan
      ? { type: "plan" as const, plan: componentPlanSchema.parse(body.plan) }
      : await services.planner.planObject(body.prompt.trim());

    if (planned.type === "clarification") {
      return jsonOk(planned);
    }

    const started = await services.generation.startFromPlan(planned.plan, body.prompt.trim());
    after(() =>
      services.generation.finishFromPlan(started.assemblyId, started.taskId, planned.plan).catch((error) => {
        console.error("finishFromPlan", error);
      }),
    );
    const assembly = await services.assemblies.get(started.assemblyId);
    return jsonOk({
      assemblyId: started.assemblyId,
      taskId: started.taskId,
      assembly,
      task: started.task,
    });
  } catch (error) {
    return jsonError(error);
  }
}
