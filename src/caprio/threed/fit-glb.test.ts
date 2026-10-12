import { describe, expect, it } from "vitest";
import { fitPartGlb, glbSize } from "@/caprio/threed/fit-glb";
import { buildBoxGlb } from "@/caprio/threed/glb";
import { defaultTransformFor, frameFromParts, poseForPart } from "@/caprio/services/layout";
import { CANONICAL_SIZE } from "@/caprio/threed/part-shape";

describe("canonical furniture fit and layout", () => {
  it("squashes a huge Meshy-like cube into a thin seat slab", () => {
    const fitted = fitPartGlb(buildBoxGlb(1.9, 1.6, 1.3), "seat");
    const size = glbSize(fitted);
    expect(size.x).toBeCloseTo(CANONICAL_SIZE.seat.x, 2);
    expect(size.y).toBeCloseTo(CANONICAL_SIZE.seat.y, 2);
    expect(size.z).toBeCloseTo(CANONICAL_SIZE.seat.z, 2);
    expect(size.y).toBeLessThan(0.08);
  });

  it("turns a thick block into a thin backrest panel", () => {
    const fitted = fitPartGlb(buildBoxGlb(1.9, 1.7, 1.6), "back");
    const size = glbSize(fitted);
    expect(size.z).toBeLessThan(0.04);
    expect(size.x).toBeGreaterThan(size.z * 8);
    expect(size.y).toBeGreaterThan(0.35);
  });

  it("inflates a tiny blob into a chair-scale leg", () => {
    const fitted = fitPartGlb(buildBoxGlb(0.04, 0.05, 0.03), "leg");
    const size = glbSize(fitted);
    expect(size.y).toBeCloseTo(CANONICAL_SIZE.leg.y, 2);
    expect(size.x).toBeGreaterThan(0.03);
    expect(size.x).toBeLessThan(0.07);
  });

  it("plumps a pancake into a thick cushion", () => {
    const fitted = fitPartGlb(buildBoxGlb(1.9, 0.12, 1.5), "cushion");
    const size = glbSize(fitted);
    expect(size.y).toBeGreaterThanOrEqual(0.08);
    expect(size.x).toBeGreaterThan(size.y);
  });

  it("places four legs at the seat corners instead of the center", () => {
    const planned = {
      name: "Leg",
      role: "structural" as const,
      quantity: 4,
      generation_prompt: "leg",
      layout: { arrangement: "corners" as const },
    };
    const frame = frameFromParts([
      { name: "Seat", parameters: [{ key: "width", value: 0.5, unit: "m" }] },
      planned,
    ]);
    const corners = [0, 1, 2, 3].map((i) => defaultTransformFor(planned, i, frame).position);
    const xs = corners.map((p) => p.x);
    const zs = corners.map((p) => p.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.35);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.3);
    expect(Math.min(...xs.map(Math.abs))).toBeGreaterThan(0.15);
    expect(Math.max(...xs.map(Math.abs))).toBeLessThan(frame.seat.x / 2 + 0.001);
  });

  it("scales back and cushion to the same seat, then parks legs under that seat", () => {
    const frame = frameFromParts([
      {
        name: "Seat",
        parameters: [
          { key: "width", value: 0.5, unit: "m" },
          { key: "depth", value: 0.46, unit: "m" },
        ],
      },
      { name: "Cushion" },
      { name: "Back" },
      { name: "Leg" },
    ]);
    expect(frame.back.x).toBeCloseTo(frame.seat.x, 4);
    expect(frame.cushion.x).toBeCloseTo(frame.seat.x * 0.96, 4);
    const seat = poseForPart("seat", 0, frame);
    const cushion = poseForPart("cushion", 0, frame);
    const back = poseForPart("back", 0, frame);
    const leg = poseForPart("leg", 0, frame);
    expect(cushion.position.y).toBeGreaterThan(seat.position.y);
    expect(back.position.z).toBeLessThan(-frame.seat.z / 4);
    expect(Math.abs(leg.position.x)).toBeCloseTo(frame.seat.x / 2 - frame.leg.x / 2, 4);
    expect(seat.position.y - frame.seat.y / 2).toBeCloseTo(frame.leg.y, 4);
  });

  it("fits every part to one shared frame so a back matches the seat width", () => {
    const frame = frameFromParts([{ name: "Seat" }, { name: "Back" }, { name: "Cushion" }, { name: "Leg" }]);
    const back = glbSize(fitPartGlb(buildBoxGlb(1.9, 1.7, 1.6), "back", undefined, frame.back));
    const seat = glbSize(fitPartGlb(buildBoxGlb(1.9, 1.6, 1.3), "seat", undefined, frame.seat));
    const cushion = glbSize(fitPartGlb(buildBoxGlb(1.2, 0.2, 1.1), "cushion", undefined, frame.cushion));
    expect(back.x).toBeCloseTo(seat.x, 2);
    expect(cushion.x).toBeCloseTo(seat.x * 0.96, 2);
    expect(back.z).toBeLessThan(seat.y);
  });
});
