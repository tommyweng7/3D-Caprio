import { describe, expect, it } from "vitest";
import {
  componentPlanSchema,
  normalizeComponentRole,
  planOrClarifySchema,
  sanitizePlannerPayload,
} from "@/caprio/schemas/plan";

describe("planner JSON validation", () => {
  it("accepts a chair decomposition with repeated legs as instances", () => {
    const parsed = componentPlanSchema.parse({
      object_name: "Chair",
      summary: "Modern wooden chair",
      components: [
        {
          name: "Seat",
          role: "structural",
          quantity: 1,
          generation_prompt: "Standalone padded wooden seat, isolated mesh.",
        },
        {
          name: "Back",
          role: "structural",
          quantity: 1,
          generation_prompt: "Standalone curved wooden backrest, isolated mesh.",
        },
        {
          name: "Leg",
          role: "structural",
          quantity: 4,
          generation_prompt: "Standalone tapered wooden chair leg, isolated mesh.",
          layout: { arrangement: "corners" },
        },
      ],
      dependencies: [
        { from: "Leg", to: "Seat", kind: "structural", description: "Legs support seat" },
      ],
    });
    expect(parsed.components).toHaveLength(3);
    expect(parsed.components.find((c) => c.name === "Leg")?.quantity).toBe(4);
  });

  it("rejects malformed planner JSON", () => {
    expect(() =>
      planOrClarifySchema.parse({
        type: "plan",
        plan: { object_name: "X", summary: "Y", components: [] },
      }),
    ).toThrow();
  });

  it("maps LLM roles like comfort onto allowed roles", () => {
    expect(normalizeComponentRole("comfort")).toBe("aesthetic");
    const parsed = planOrClarifySchema.parse({
      type: "plan",
      plan: {
        object_name: "Chair",
        summary: "Modern wooden chair",
        components: [
          {
            name: "Cushion",
            role: "comfort",
            quantity: 1,
            generation_prompt: "Standalone padded seat cushion, isolated mesh.",
          },
        ],
      },
    });
    expect(parsed.type).toBe("plan");
    if (parsed.type === "plan") {
      expect(parsed.plan.components[0].role).toBe("aesthetic");
    }
  });

  it("sanitizes component maps, missing prompts, and nested quantities", () => {
    const parsed = planOrClarifySchema.parse(
      sanitizePlannerPayload({
        object_name: "Chair",
        components: {
          seat: { name: "Seat", quantity: { value: 1 }, prompt: "wide seat" },
          legs: { name: "Leg", count: 4, arrangement: "four_corners" },
        },
      }),
    );
    expect(parsed.type).toBe("plan");
    if (parsed.type === "plan") {
      expect(parsed.plan.summary).toBe("Chair");
      expect(parsed.plan.components).toHaveLength(2);
      expect(parsed.plan.components[1].quantity).toBe(4);
      expect(parsed.plan.components[1].generation_prompt.length).toBeGreaterThan(8);
    }
  });

  it("coerces messy planner fields instead of 502ing", () => {
    const parsed = planOrClarifySchema.parse({
      type: "plan",
      plan: {
        object_name: "Chair",
        summary: "Wooden chair",
        components: [
          {
            name: "Leg",
            role: "support",
            quantity: "4",
            generation_prompt: `${"Standalone tapered wooden chair leg, isolated mesh. ".repeat(40)}`,
            layout: { arrangement: "four_corners" },
          },
        ],
        dependencies: [{ from: "Leg", to: "Seat", kind: "sits_on" }],
      },
    });
    expect(parsed.type).toBe("plan");
    if (parsed.type === "plan") {
      expect(parsed.plan.components[0].quantity).toBe(4);
      expect(parsed.plan.components[0].generation_prompt.length).toBeLessThanOrEqual(800);
      expect(parsed.plan.components[0].layout?.arrangement).toBe("corners");
      expect(parsed.plan.dependencies[0].description).toBe("");
    }
  });

  it("accepts a bounded clarification instead of guessing", () => {
    const parsed = planOrClarifySchema.parse({
      type: "clarification",
      questions: ["What style?"],
    });
    expect(parsed.type).toBe("clarification");
  });
});
