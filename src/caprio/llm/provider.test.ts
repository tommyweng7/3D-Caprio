import { describe, expect, it } from "vitest";
import { HeuristicLLMProvider } from "@/caprio/llm/heuristic-provider";
import { extractJson, type LLMProvider } from "@/caprio/llm/provider";
import { createLLMProvider } from "@/caprio/llm/factory";
import { PlannerService } from "@/caprio/services/planner";

describe("LLM provider interface", () => {
  it("extracts JSON from fenced completions", () => {
    expect(extractJson("```json\n{\"ok\":true}\n```")).toEqual({ ok: true });
  });

  it("repairs trailing commas in LLM JSON", () => {
    expect(extractJson('{"ok":true,}')).toEqual({ ok: true });
  });

  it("heuristic provider implements LLMProvider", async () => {
    const llm: LLMProvider = new HeuristicLLMProvider();
    expect(llm.name).toBe("heuristic");
    const result = await llm.complete([{ role: "user", content: "Create a modern wooden chair with a curved back" }]);
    expect(result.text).toContain('"type":"plan"');
  });

  it("asks only necessary questions for an ambiguous chair", async () => {
    const planner = new PlannerService(new HeuristicLLMProvider());
    const result = await planner.planObject("Make me a chair.");
    expect(result.type).toBe("clarification");
    if (result.type === "clarification") {
      expect(result.questions.length).toBeLessThanOrEqual(3);
    }
  });

  it("plans a modern wooden chair locally without waiting on Grok", async () => {
    let called = 0;
    const planner = new PlannerService({
      name: "broken",
      async complete() {
        called += 1;
        throw new Error("should not call Grok for a simple chair");
      },
    });
    const result = await planner.planObject("make a modern wooden chair");
    expect(called).toBe(0);
    expect(result.type).toBe("plan");
    if (result.type === "plan") {
      expect(result.plan.components.map((c) => c.name).sort()).toEqual(["Back", "Cushion", "Leg", "Seat"]);
    }
  });

  it("createLLMProvider can use heuristic", () => {
    const prev = process.env.LLM_PROVIDER;
    process.env.LLM_PROVIDER = "heuristic";
    expect(createLLMProvider().name).toBe("heuristic");
    process.env.LLM_PROVIDER = prev;
  });
});
