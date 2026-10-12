import type { ChatMessage, LLMCompletion, LLMProvider } from "@/caprio/llm/provider";

/**
 * Deterministic offline planner. Not Grok or Claude — used for tests and
 * local demos when LLM_PROVIDER=heuristic.
 */
export class HeuristicLLMProvider implements LLMProvider {
  readonly name = "heuristic";

  async complete(messages: ChatMessage[]): Promise<LLMCompletion> {
    const last = messages.at(-1)?.content || "";
    if (last.includes("currentPrompt") || last.includes("userEdit")) {
      const parsed = safeJson(last);
      const userEdit = String(parsed.userEdit || "");
      const current = String(parsed.currentPrompt || "component");
      const parameterOnly = /color|roughness|material|walnut|oak|brass|paint/i.test(userEdit) && !/taller|style|shape|deco/i.test(userEdit);
      const appearance = /walnut|oak|brass|wood|fabric|steel|#/.test(userEdit.toLowerCase());
      return {
        provider: this.name,
        model: "heuristic",
        text: JSON.stringify({
          parameterOnly,
          updatedPrompt: `${current}. ${userEdit}`,
          parameters: parameterOnly
            ? [
                { key: "color", value: appearance ? userEdit : "updated", affectsGeometry: false },
                { key: "material", value: userEdit, affectsGeometry: false },
              ]
            : [],
          styleNotes: userEdit,
          geometryMustChange: !parameterOnly,
        }),
      };
    }

    const prompt = last.toLowerCase();
    if (/^user request:\nmake me a chair\s*$/m.test(last) || prompt.includes("make me a chair") && !/wood|style|modern|padded/.test(prompt)) {
      return {
        provider: this.name,
        model: "heuristic",
        text: JSON.stringify({
          type: "clarification",
          questions: ["What style and material should the chair use?"],
        }),
      };
    }

    return {
      provider: this.name,
      model: "heuristic",
      text: JSON.stringify({
        type: "plan",
        plan: {
          object_name: "Chair",
          summary: "Modern wooden chair with independently editable seat, back, and repeated legs.",
          components: [
            {
              name: "Seat",
              role: "structural",
              quantity: 1,
              purpose: "provide a sitting surface",
              style: "modern",
              material: "wood",
              generation_prompt:
                "Wide flat rectangular wooden chair seat, 50cm wide, 50cm deep, 6cm thick, light oak, single part only.",
              parameters: [
                { key: "width", value: 0.5, unit: "m", affectsGeometry: false },
                { key: "depth", value: 0.48, unit: "m", affectsGeometry: false },
              ],
              layout: { arrangement: "single" },
            },
            {
              name: "Back",
              role: "structural",
              quantity: 1,
              purpose: "provide lumbar and back support",
              style: "modern",
              material: "wood",
              generation_prompt:
                "Wide wooden chair backrest panel, 50cm wide, 50cm tall, 4cm thick, gentle curve, light oak, single part only.",
              layout: { arrangement: "single" },
            },
            {
              name: "Cushion",
              role: "aesthetic",
              quantity: 1,
              purpose: "pad the sitting surface",
              style: "modern",
              material: "fabric",
              generation_prompt:
                "Wide thick rectangular fabric chair cushion, 48cm wide, 46cm deep, 8cm thick, upholstered pad, single part only.",
              layout: { arrangement: "single" },
            },
            {
              name: "Leg",
              role: "structural",
              quantity: 4,
              purpose: "support the chair seat",
              style: "modern",
              material: "wood",
              generation_prompt:
                "One vertical tapered wooden chair leg, 45cm tall, 4cm thick, light oak, single part only.",
              parameters: [{ key: "height", value: 0.45, unit: "m", affectsGeometry: true }],
              layout: { arrangement: "corners" },
            },
          ],
          dependencies: [
            { from: "Back", to: "Seat", kind: "attachment", description: "Back attaches to rear of seat" },
            { from: "Leg", to: "Seat", kind: "structural", description: "Legs support the seat" },
            { from: "Cushion", to: "Seat", kind: "attachment", description: "Cushion rests on the seat" },
          ],
          clarifications: [],
        },
      }),
    };
  }
}

function safeJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
