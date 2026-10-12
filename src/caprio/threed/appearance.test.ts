import { describe, expect, it } from "vitest";
import { appearanceFromText, looksLikeGeometryRequest } from "@/caprio/threed/appearance";
import { versionTitle } from "@/caprio/services/version-title";
import { looksLikeSurfaceRebuild, looksLikeWholeObject, looksLikeChairProfile, looksLikeAdditiveEdit, meshGenerationPrompt } from "@/caprio/threed/part-shape";

describe("natural-language materials and version titles", () => {
  it("maps worn brown leather without a preset button", () => {
    const look = appearanceFromText("Change the material to worn brown leather.");
    expect(look?.label.toLowerCase()).toContain("leather");
    expect(look?.color).toMatch(/#|hsl/);
    expect(look?.roughness).toBeGreaterThan(0.4);
  });

  it("names a regenerated backrest from the prompt", () => {
    expect(versionTitle("Back", "add an ornate floral pattern on the back of a chair", 2).toLowerCase()).toMatch(
      /floral|ornate/,
    );
    expect(versionTitle("Back", "simple star-cutout in the middle", 3).toLowerCase()).toMatch(/star/);
  });

  it("treats a cube-like mesh as a whole chair rather than a backrest", () => {
    expect(looksLikeWholeObject("back", { x: 1.9, y: 1.7, z: 1.6 })).toBe(true);
    expect(looksLikeWholeObject("back", { x: 0.48, y: 0.46, z: 0.03 })).toBe(false);
    expect(looksLikeWholeObject("back", { x: 0.62, y: 0.58, z: 0.28 })).toBe(false);
  });

  it("puts the part edit first and allows floral cutouts and tufting", () => {
    expect(looksLikeSurfaceRebuild("floral cutout")).toBe(true);
    expect(looksLikeSurfaceRebuild("tuck and roll upholstery")).toBe(true);
    expect(looksLikeGeometryRequest("make it from tuck and roll upholstery")).toBe(true);
    const back = meshGenerationPrompt("Back", "floral cutouts", "form");
    expect(back.toLowerCase()).toContain("isolated");
    expect(back.toLowerCase()).toContain("floral");
    expect(back.toLowerCase()).toMatch(/splat|panel/);
    expect(back).toContain("DETAIL PASS");
    expect(back).not.toMatch(/no cutouts/i);
    expect(back.toLowerCase()).toMatch(/leg/);
    const seat = meshGenerationPrompt("Seat", "make it from tuck and roll upholstery", "form");
    expect(seat.toLowerCase()).toMatch(/tuck and roll/);
    expect(seat.toLowerCase()).toContain("seat");
    expect(seat).not.toMatch(/no decorative pattern/i);
    const detailed = meshGenerationPrompt("Cushion", "tuck and roll upholstery", "detail");
    expect(detailed).toContain("DETAIL PASS");
    expect(detailed.toLowerCase()).toMatch(/tuft|channel|high-resolution|high-detail/);
    expect(detailed.toLowerCase()).not.toContain("keep this existing");
    expect(detailed).not.toMatch(/LOW POLY BLOCKOUT/i);
  });

  it("keeps the current backrest when adding a handle", () => {
    expect(looksLikeAdditiveEdit("add a carry handle to the back")).toBe(true);
    const prompt = meshGenerationPrompt("Back", "add a carry handle", "detail", {
      preserve: "Isolated backrest. Curved oak backrest panel 50cm wide with a lumbar curve.",
    });
    expect(prompt.toLowerCase()).toContain("keep");
    expect(prompt.toLowerCase()).toContain("handle");
    expect(prompt.toLowerCase()).toContain("curved oak");
    expect(prompt).not.toMatch(/One thin upright wooden SPLAT PANEL only/i);
    expect(prompt.toLowerCase()).toContain("do not redesign");
  });

  it("detects a chair silhouette with legs, not a solid backrest panel", () => {
    const panel: Array<[number, number, number]> = [];
    for (let x = 0; x <= 10; x += 1) {
      for (let y = 0; y <= 10; y += 1) {
        panel.push([x * 0.05, y * 0.045, 0]);
      }
    }
    expect(looksLikeChairProfile(panel)).toBe(false);

    const chair: Array<[number, number, number]> = [];
    for (let i = 0; i < 40; i += 1) {
      for (let j = 0; j < 8; j += 1) {
        chair.push([-0.22 + j * 0.004, i * 0.005, 0]);
        chair.push([0.22 - j * 0.004, i * 0.005, 0]);
      }
    }
    for (let x = -5; x <= 5; x += 1) {
      chair.push([x * 0.04, 0.28, 0]);
      chair.push([x * 0.04, 0.5, 0]);
    }
    expect(looksLikeChairProfile(chair)).toBe(true);
  });
});
