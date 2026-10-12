import { AppError } from "@/caprio/errors";
import { HeuristicLLMProvider } from "@/caprio/llm/heuristic-provider";
import type { LLMProvider } from "@/caprio/llm/provider";
import { extractJson } from "@/caprio/llm/provider";
import {
  type EditIntent,
  editIntentSchema,
  type PlanOrClarify,
  planOrClarifySchema,
  canUseLocalChairPlan,
  promptLooksSpecified,
  sanitizePlannerPayload,
} from "@/caprio/schemas/plan";

const PLANNER_SYSTEM = `You are the component planner for 3D-Caprio.
Core principle: preserve everything unless the user explicitly asks for it to change.

Convert a natural-language object request into independently editable semantic components (identity + purpose), not mesh fragments.

Consider a part a component if it has a distinct semantic role, functional job, structural importance, independent editability, likely reuse, movement, attachment relationship, material difference, repeated geometry, or aesthetic identity.

Repeated parts MUST be one component with quantity > 1 (instances), not duplicated component types. Example: four chair legs → Leg quantity 4.

A padded seat should usually be Seat + Cushion when the cushion is independently editable.

Do NOT split tiny mesh details (screws, grain, stitching) unless the user asked. Do not emit Mesh_001 names.

Repeated parts MUST be one component with quantity > 1 (instances), not duplicated component types.

If the request is too ambiguous to choose a useful decomposition (example: "make me a chair" with no style/material), return type "clarification" with at most 3 necessary questions. Do not ask questions whose answers are already in the prompt.

role MUST be one of: structural, functional, aesthetic, connector, hardware. Use aesthetic for cushions/padding, not "comfort".

Always respond with JSON only, matching one of:
{"type":"clarification","questions":["..."]}
{"type":"plan","plan":{"object_name":"...","summary":"...","components":[{"name":"Seat","role":"structural","quantity":1,"generation_prompt":"... standalone 3D mesh of ...","parameters":[{"key":"width","value":0.5,"unit":"m","affectsGeometry":false}],"layout":{"arrangement":"single"}}],"dependencies":[{"from":"Back","to":"Seat","kind":"attachment","description":"Back attaches to rear of seat"}],"clarifications":[]}}

generation_prompt rules:
- Describe ONE isolated furniture PART with real-world proportions in centimeters.
- Seat = wide flat slab (~50×50×6cm). Cushion = wide thick pad, not a roll. Back = wide panel (~50cm wide), not a spindle. Leg = one vertical tapered leg.
- Never write "no legs" or "no back" — those words make mesh models come out as rods. Write "single part only" instead.
- Do not describe a full chair. Max 800 characters.`;

const EDIT_SYSTEM = `You classify a component edit for 3D-Caprio.
Preserve identity. Never rewrite unrelated parts.
Prefer parametric CAD edits (height, width, depth, thickness, radius, taper, angle) over regenerating a whole object.

Return JSON:
{
  "parameterOnly": boolean,
  "updatedPrompt": "full replacement generation prompt for THIS component only",
  "parameters": [{"key":"height","value":0.6,"unit":"m","affectsGeometry":true}],
  "styleNotes": "",
  "geometryMustChange": boolean
}

parameterOnly=true only for color/material/roughness that can be applied without a CAD rebuild.
If the user asks for a new style, shape, or structural change, geometryMustChange=true and parameterOnly=false.`;

export class PlannerService {
  constructor(private readonly llm: LLMProvider) {}

  async planObject(prompt: string, knownContext?: string): Promise<PlanOrClarify> {
    const messages = [
      { role: "system" as const, content: PLANNER_SYSTEM },
      {
        role: "user" as const,
        content: `User request:\n${prompt}\n\nKnown context:\n${knownContext || "none"}`,
      },
    ];
    if (canUseLocalChairPlan(prompt)) {
      return this.fallbackPlan(messages, "local chair plan");
    }
    try {
      const completion = await this.llm.complete(messages);
      const parsed = this.parsePlan(completion.text);
      if (parsed.type === "clarification" && promptLooksSpecified(prompt)) {
        return this.fallbackPlan(messages, "ignored a clarification for a specific prompt");
      }
      return parsed;
    } catch (error) {
      console.warn("planner falling back after LLM JSON failure", error);
      return this.fallbackPlan(messages, error);
    }
  }

  private async fallbackPlan(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    cause: unknown,
  ): Promise<PlanOrClarify> {
    const fallback = await new HeuristicLLMProvider().complete(messages);
    try {
      return this.parsePlan(fallback.text);
    } catch (retryError) {
      throw new AppError(
        "Planner returned malformed JSON that failed schema validation",
        "malformed_ai_response",
        502,
        {
          cause: cause instanceof Error ? cause.message : cause,
          error: retryError instanceof Error ? retryError.message : retryError,
        },
      );
    }
  }

  private parsePlan(text: string): PlanOrClarify {
    return planOrClarifySchema.parse(sanitizePlannerPayload(extractJson(text)));
  }

  async interpretEdit(args: {
    componentName: string;
    currentPrompt: string;
    userEdit: string;
    locked: boolean;
  }): Promise<EditIntent> {
    const completion = await this.llm.complete([
      { role: "system", content: EDIT_SYSTEM },
      {
        role: "user",
        content: JSON.stringify(args),
      },
    ]);
    try {
      return editIntentSchema.parse(extractJson(completion.text));
    } catch (error) {
      throw new AppError(
        "Edit interpreter returned malformed JSON",
        "malformed_ai_response",
        502,
        { raw: completion.text, error: error instanceof Error ? error.message : error },
      );
    }
  }
}
