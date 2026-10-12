import { describe, expect, it } from "vitest";
import { formatCm, landmarkPrompt, nextPinName, parseCmTriple } from "@/caprio/threed/measure";

describe("viewport measure and pins", () => {
  it("parses centimeter triples from a hole prompt", () => {
    const point = parseCmTriple("put a hole at 9, 3, 4");
    expect(point).toEqual({ x: 0.09, y: 0.03, z: 0.04 });
    expect(formatCm(point!)).toBe("9.0, 3.0, 4.0");
  });

  it("names pins A then B", () => {
    expect(nextPinName([])).toBe("A");
    expect(nextPinName(["A"])).toBe("B");
  });

  it("attaches saved landmarks to a feature edit", () => {
    const prompt = landmarkPrompt("extend this faceplate by 3cm", "Back", [
      { name: "A", position: { x: 0.09, y: 0.03, z: 0.04 } },
    ]);
    expect(prompt.toLowerCase()).toContain("back");
    expect(prompt).toContain("9.0, 3.0, 4.0");
    expect(prompt.toLowerCase()).toContain("extend this faceplate");
  });
});
