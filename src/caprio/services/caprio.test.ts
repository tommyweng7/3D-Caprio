import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryDatabase } from "@/caprio/db/memory-database";
import { HeuristicLLMProvider } from "@/caprio/llm/heuristic-provider";
import { createServices } from "@/caprio/services/container";
import { LocalPrimitiveProvider } from "@/caprio/threed/local-provider";
import { AppError } from "@/caprio/errors";

const PROMPT = "Create a modern wooden chair with a curved back, padded seat, and four tapered legs.";

describe("3D-Caprio component system", () => {
  let services: ReturnType<typeof createServices>;

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "caprio-"));
    process.env.DATA_DIR = dir;
    services = createServices({
      db: new MemoryDatabase(),
      llm: new HeuristicLLMProvider(),
      threed: new LocalPrimitiveProvider(),
    });
  });

  async function generateChair() {
    const planned = await services.planner.planObject(PROMPT);
    expect(planned.type).toBe("plan");
    if (planned.type !== "plan") throw new Error("expected plan");
    const started = await services.generation.generateFromPlan(planned.plan, PROMPT);
    return services.assemblies.get(started.assemblyId);
  }

  it("records per-part generation steps on the task", async () => {
    const planned = await services.planner.planObject(PROMPT);
    expect(planned.type).toBe("plan");
    if (planned.type !== "plan") throw new Error("expected plan");
    const queued = await services.generation.startFromPlan(planned.plan, PROMPT);
    const waiting = await services.generation.getTask(queued.taskId);
    expect(waiting.steps.length).toBeGreaterThan(0);
    expect(waiting.steps.every((step) => step.status === "pending")).toBe(true);
    await services.generation.finishFromPlan(queued.assemblyId, queued.taskId, planned.plan);
    const done = await services.generation.getTask(queued.taskId);
    expect(done.status).toBe("complete");
    expect(done.progress).toBe(100);
    expect(done.steps.every((step) => step.status === "done")).toBe(true);
  });

  it("assembles a chair with corner legs", async () => {
    const bundle = await generateChair();
    const legs = bundle.instances.filter((i) => /leg/i.test(i.label));
    expect(legs).toHaveLength(4);
    const spanX = Math.max(...legs.map((l) => l.position.x)) - Math.min(...legs.map((l) => l.position.x));
    expect(spanX).toBeGreaterThan(0.35);
    const seat = bundle.instances.find((i) => /seat/i.test(i.label));
    const back = bundle.instances.find((i) => /back/i.test(i.label));
    expect(seat).toBeTruthy();
    expect(back).toBeTruthy();
    expect(back!.position.z).toBeLessThan(seat!.position.z);
    const maxLeg = Math.max(...legs.map((l) => Math.abs(l.position.x)));
    expect(maxLeg).toBeLessThan(0.28);
  });

  it("nudges selected instances by centimeters without remeshing", async () => {
    const bundle = await generateChair();
    const legs = bundle.instances.filter((i) => /leg/i.test(i.label));
    const before = legs[0].position.y;
    const moved = await services.assemblies.nudgeInstances(
      bundle.assembly.id,
      legs.map((leg) => leg.id),
      { x: 0, y: 0.02, z: 0 },
    );
    const after = moved.instances.filter((i) => /leg/i.test(i.label));
    expect(after).toHaveLength(4);
    expect(after[0].position.y).toBeCloseTo(before + 0.02, 5);
    expect(after[0].position.x).toBeCloseTo(legs[0].position.x, 5);
  });

  it("remembers scene pins in world centimeters", async () => {
    const bundle = await generateChair();
    const pinned = await services.assemblies.addMarker(bundle.assembly.id, { x: 0.09, y: 0.03, z: 0.04 });
    expect(pinned.markers).toHaveLength(1);
    expect(pinned.markers[0].name).toBe("A");
    expect(pinned.markers[0].position.y).toBeCloseTo(0.03, 5);
    const named = await services.assemblies.addMarker(bundle.assembly.id, { x: 0.01, y: 0.4, z: 0 }, "handle");
    expect(named.markers.some((marker) => marker.name === "handle")).toBe(true);
    const renamed = await services.assemblies.renameMarker(
      bundle.assembly.id,
      named.markers.find((marker) => marker.name === "handle")!.id,
      "left handle",
    );
    expect(renamed.markers.some((marker) => marker.name === "left handle")).toBe(true);
    const cleared = await services.assemblies.removeMarker(bundle.assembly.id, pinned.markers[0].id);
    expect(cleared.markers.some((marker) => marker.id === pinned.markers[0].id)).toBe(false);
  });

  it("keeps a stable component id across new versions", async () => {
    const { component, version } = await services.components.createComponent({
      name: "Leg",
      role: "structural",
      generationPrompt: "original leg",
    });
    const v2 = await services.components.addVersion({
      componentId: component.id,
      generationPrompt: "taller art deco leg",
      notes: "taller",
    });
    expect(v2.componentId).toBe(component.id);
    expect(v2.id).not.toBe(version.id);
    expect(v2.versionNumber).toBe(2);
    const { versions } = await services.components.get(component.id);
    expect(versions.map((v) => v.id)).toEqual([version.id, v2.id]);
  });

  it("never overwrites an existing version record", async () => {
    const { component, version } = await services.components.createComponent({
      name: "Seat",
      role: "structural",
      generationPrompt: "seat v1",
    });
    await services.components.addVersion({
      componentId: component.id,
      generationPrompt: "seat v2",
      notes: "padded more",
    });
    const { versions } = await services.components.get(component.id);
    const original = versions.find((v) => v.id === version.id);
    expect(original?.generationPrompt).toBe("seat v1");
    expect(original?.versionNumber).toBe(1);
    expect(versions).toHaveLength(2);
  });

  it("blocks edits and splits on locked components", async () => {
    const bundle = await generateChair();
    const seat = bundle.components.find((c) => c.name === "Seat")!;
    await services.components.setLocked(seat.id, true);
    await expect(
      services.edits.edit({
        componentId: seat.id,
        assemblyId: bundle.assembly.id,
        prompt: "Make this sequined",
      }),
    ).rejects.toMatchObject({ code: "locked" });
    await expect(
      services.splitMerge.split({
        componentId: seat.id,
        assemblyId: bundle.assembly.id,
        prompt: "Separate the cushion from the frame",
      }),
    ).rejects.toMatchObject({ code: "locked" });
  });

  it("assembles one shared Leg component with four instances", async () => {
    const bundle = await generateChair();
    const legs = bundle.instances.filter((i) => /leg/i.test(i.label));
    const legComponentIds = new Set(legs.map((i) => i.componentId));
    expect(legs).toHaveLength(4);
    expect(legComponentIds.size).toBe(1);
    const versionIds = new Set(legs.map((i) => i.versionId));
    expect(versionIds.size).toBe(1);
    expect(bundle.versions.every((v) => v.cadSource?.format === "kcl")).toBe(true);
    expect(bundle.components.map((c) => c.name).sort()).toEqual(["Back", "Cushion", "Leg", "Seat"]);
  });

  it("edits only the selected instance and keeps sibling geometry", async () => {
    const bundle = await generateChair();
    const legs = bundle.instances.filter((i) => /leg/i.test(i.label));
    const untouched = legs[1];
    const target = legs[0];
    const before = await services.db.read();
    const untouchedVersion = before.componentVersions.find((v) => v.id === untouched.versionId)!;

    const result = await services.edits.edit({
      componentId: target.componentId,
      assemblyId: bundle.assembly.id,
      instanceId: target.id,
      prompt: "Make this taller and more Art Deco.",
    });

    const after = await services.assemblies.get(bundle.assembly.id);
    const updatedTarget = after.instances.find((i) => i.id === target.id)!;
    const updatedSibling = after.instances.find((i) => i.id === untouched.id)!;
    expect(updatedTarget.componentId).not.toBe(updatedSibling.componentId);
    expect(updatedSibling.versionId).toBe(untouched.versionId);
    const siblingVersion = after.versions.find((v) => v.id === updatedSibling.versionId)!;
    expect(siblingVersion.geometryPath).toBe(untouchedVersion.geometryPath);
    expect(result.previousVersionId).toBeTruthy();
    const { versions } = await services.components.get(result.componentId);
    expect(versions.length).toBeGreaterThan(1);
    expect(versions.some((v) => v.id === result.previousVersionId)).toBe(true);
  });

  it("preserves locked components during a broad design change", async () => {
    const bundle = await generateChair();
    const seat = bundle.components.find((c) => c.name === "Seat")!;
    const seatVersion = seat.currentVersionId;
    await services.components.setLocked(seat.id, true);
    const results = await services.edits.applyBroadChange(bundle.assembly.id, "Make the whole chair more Art Deco.");
    const skipped = results.find((r) => r.componentId === seat.id);
    expect(skipped).toMatchObject({ skipped: true, reason: "locked" });
    const after = await services.components.get(seat.id);
    expect(after.component.currentVersionId).toBe(seatVersion);
    const back = afterWait(results, bundle.components.find((c) => c.name === "Back")!.id);
    expect(back?.skipped).toBeFalsy();
  });

  it("saves a component to the library and reuses it without duplicating source versions", async () => {
    const bundle = await generateChair();
    const leg = bundle.components.find((c) => c.name === "Leg")!;
    const item = await services.library.save({ name: "Art Deco Chair Leg", componentId: leg.id });
    const listed = await services.library.list("art deco");
    expect(listed.map((i) => i.name)).toContain("Art Deco Chair Leg");
    const versionsBefore = (await services.db.read()).componentVersions.filter((v) => v.componentId === leg.id);
    await services.library.use(item.id, bundle.assembly.id);
    const after = await services.assemblies.get(bundle.assembly.id);
    expect(after.instances.filter((i) => i.componentId === leg.id).length).toBe(5);
    const versionsAfter = (await services.db.read()).componentVersions.filter((v) => v.componentId === leg.id);
    expect(versionsAfter).toHaveLength(versionsBefore.length);
  });

  it("tracks dependencies without regenerating unrelated components", async () => {
    const bundle = await generateChair();
    expect(bundle.dependencies.length).toBeGreaterThan(0);
    const seat = bundle.components.find((c) => c.name === "Seat")!;
    const back = bundle.components.find((c) => c.name === "Back")!;
    const seatVersion = seat.currentVersionId;
    await services.edits.edit({
      componentId: back.id,
      assemblyId: bundle.assembly.id,
      prompt: "Make the back more curved.",
    });
    const afterSeat = await services.components.get(seat.id);
    expect(afterSeat.component.currentVersionId).toBe(seatVersion);
    const related = await services.assemblies.relatedComponentIds(back.id);
    expect(related.has(seat.id)).toBe(true);
  });

  it("applies parameter-only edits without calling a new mesh when color changes", async () => {
    const bundle = await generateChair();
    const seat = bundle.components.find((c) => c.name === "Seat")!;
    const before = (await services.components.get(seat.id)).versions.at(-1)!;
    const result = await services.edits.edit({
      componentId: seat.id,
      assemblyId: bundle.assembly.id,
      prompt: "Change the color to deep walnut.",
    });
    expect(result.parameterOnly).toBe(true);
    const after = await services.components.get(seat.id);
    const latest = after.versions.at(-1)!;
    expect(latest.id).not.toBe(before.id);
    expect(latest.geometryPath).toBe(before.geometryPath);
  });

  it("makes a component taller by scaling the existing mesh instead of regenerating it", async () => {
    const bundle = await generateChair();
    const leg = bundle.components.find((c) => c.name === "Leg")!;
    const before = (await services.components.get(leg.id)).versions.at(-1)!;
    const result = await services.edits.edit({
      componentId: leg.id,
      assemblyId: bundle.assembly.id,
      prompt: "Make the legs taller.",
      applyTo: "definition",
    });
    expect(result.parameterOnly).toBe(true);
    const after = await services.components.get(leg.id);
    const latest = after.versions.at(-1)!;
    expect(latest.id).not.toBe(before.id);
    expect(latest.geometryPath).toBe(before.geometryPath);
    const beforeHeight = before.parameters.find((p) => p.key === "height")?.value;
    const afterHeight = latest.parameters.find((p) => p.key === "height")?.value;
    expect(afterHeight).not.toBe(beforeHeight);
  });

  it("surfaces lock as a domain error, not a silent overwrite", async () => {
    const { component } = await services.components.createComponent({
      name: "Back",
      role: "structural",
      generationPrompt: "back",
    });
    await services.components.setLocked(component.id, true);
    await expect(
      services.components.addVersion({
        componentId: component.id,
        generationPrompt: "new",
        notes: "nope",
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

function afterWait(results: Array<{ componentId: string; skipped?: boolean }>, id: string) {
  return results.find((r) => r.componentId === id);
}

describe("3D-Caprio semantic layer", () => {
  let services: ReturnType<typeof createServices>;

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "caprio-"));
    process.env.DATA_DIR = dir;
    services = createServices({
      db: new MemoryDatabase(),
      llm: new HeuristicLLMProvider(),
      threed: new LocalPrimitiveProvider(),
    });
  });

  async function generateChair() {
    const planned = await services.planner.planObject(PROMPT);
    expect(planned.type).toBe("plan");
    if (planned.type !== "plan") throw new Error("expected plan");
    const started = await services.generation.generateFromPlan(planned.plan, PROMPT);
    return services.assemblies.get(started.assemblyId);
  }
  it("keeps lineage on the same component identity", async () => {
    const { component, version } = await services.components.createComponent({
      name: "Leg",
      role: "structural",
      generationPrompt: "tapered wooden leg",
    });
    const v2 = await services.components.addVersion({
      componentId: component.id,
      generationPrompt: "taller art deco leg",
      notes: "taller",
    });
    expect(v2.parentVersionId).toBe(version.id);
    expect(v2.label.toLowerCase()).toMatch(/taller|deco|leg/);
    expect(v2.label).not.toBe("v2");
    expect(v2.dna?.style).toBe("Art Deco");
  });

  it("edits the shared definition so all four legs stay one component", async () => {
    const bundle = await generateChair();
    const legs = bundle.instances.filter((i) => /leg/i.test(i.label));
    const result = await services.edits.edit({
      componentId: legs[0].componentId,
      assemblyId: bundle.assembly.id,
      prompt: "Make the legs taller and more Art Deco.",
      applyTo: "definition",
    });
    const after = await services.assemblies.get(bundle.assembly.id);
    const updated = after.instances.filter((i) => i.componentId === result.componentId);
    expect(updated).toHaveLength(4);
    expect(new Set(updated.map((i) => i.versionId)).size).toBe(1);
    expect(updated[0].versionId).toBe(result.versionId);
  });

  it("does not mutate another assembly when a shared library component is edited", async () => {
    const chair = await generateChair();
    const leg = chair.components.find((c) => c.name === "Leg")!;
    const item = await services.library.save({ name: "Tapered Wooden Leg", componentId: leg.id });
    const tablePlan = await services.planner.planObject(PROMPT);
    if (tablePlan.type !== "plan") throw new Error("expected plan");
    const table = await services.generation.generateFromPlan(
      { ...tablePlan.plan, object_name: "Coffee Table" },
      "coffee table",
    );
    await services.library.use(item.id, table.assemblyId);
    const beforeTable = await services.assemblies.get(table.assemblyId);
    const tableLegInstances = beforeTable.instances.filter((i) => i.componentId === leg.id);
    expect(tableLegInstances.length).toBeGreaterThan(0);
    const pinned = tableLegInstances[0].versionId;

    await services.edits.edit({
      componentId: leg.id,
      assemblyId: chair.assembly.id,
      prompt: "Make the legs taller and more Art Deco.",
      applyTo: "definition",
    });

    const afterTable = await services.assemblies.get(table.assemblyId);
    const stillPinned = afterTable.instances.filter((i) => i.componentId === leg.id);
    expect(stillPinned.every((i) => i.versionId === pinned)).toBe(true);
    const afterChair = await services.assemblies.get(chair.assembly.id);
    expect(afterChair.instances.filter((i) => i.componentId === leg.id).every((i) => i.versionId !== pinned)).toBe(true);
  });

  it("previews impact without creating a version", async () => {
    const bundle = await generateChair();
    const before = await services.db.read();
    const preview = await services.edits.preview({
      assemblyId: bundle.assembly.id,
      prompt: "Make the legs taller.",
    });
    const after = await services.db.read();
    expect(preview.impact.direct.map((c) => c.name)).toEqual(["Leg"]);
    expect(preview.impact.potential.some((p) => p.name === "Seat")).toBe(true);
    expect(preview.impact.unchanged.map((c) => c.name).sort()).toEqual(["Back", "Cushion"]);
    expect(after.componentVersions).toHaveLength(before.componentVersions.length);
  });

  it("records a semantic diff after a surgical edit", async () => {
    const bundle = await generateChair();
    const leg = bundle.components.find((c) => c.name === "Leg")!;
    await services.edits.edit({
      componentId: leg.id,
      assemblyId: bundle.assembly.id,
      prompt: "Make the legs taller and more Art Deco.",
      applyTo: "definition",
    });
    const after = await services.assemblies.get(bundle.assembly.id);
    const diff = after.changeSets.at(-1)?.diff;
    expect(diff?.modified.some((m) => m.name === "Leg")).toBe(true);
    expect(diff?.unchanged.some((u) => u.name === "Seat")).toBe(true);
  });

  it("branches a design without destroying the original pins", async () => {
    const bundle = await generateChair();
    const original = await services.assemblies.ensureMainBranch(bundle.assembly.id);
    const leg = bundle.components.find((c) => c.name === "Leg")!;
    const originalVersion = bundle.instances.find((i) => i.componentId === leg.id)!.versionId;
    const deco = await services.assemblies.createBranch(bundle.assembly.id, "Art Deco");
    await services.edits.edit({
      componentId: leg.id,
      assemblyId: bundle.assembly.id,
      prompt: "Make the legs more Art Deco.",
      applyTo: "definition",
    });
    const decoState = await services.assemblies.get(bundle.assembly.id);
    const decoVersion = decoState.instances.find((i) => i.componentId === leg.id)!.versionId;
    expect(decoVersion).not.toBe(originalVersion);
    await services.assemblies.activateBranch(bundle.assembly.id, original.id);
    const restored = await services.assemblies.get(bundle.assembly.id);
    expect(restored.instances.find((i) => i.componentId === leg.id)!.versionId).toBe(originalVersion);
    expect(deco.name).toBe("Art Deco");
  });

  it("checks compatibility when inserting a library component", async () => {
    const bundle = await generateChair();
    const leg = bundle.components.find((c) => c.name === "Leg")!;
    const item = await services.library.save({ name: "Tapered Wooden Leg", componentId: leg.id });
    const used = await services.library.use(item.id, bundle.assembly.id);
    expect(used.compatibility.checks.length).toBeGreaterThan(0);
    expect(used.compatibility.compatible).toBe(true);
  });

  it("still generates a chair with local parts when Meshy reports insufficient funds", async () => {
    let createCalls = 0;
    services = createServices({
      db: new MemoryDatabase(),
      llm: new HeuristicLLMProvider(),
      threed: {
        name: "meshy",
        async createTask() {
          createCalls += 1;
          throw new Error("Insufficient funds");
        },
        async getTask() {
          return { providerTaskId: "x", status: "failed" as const, progress: 0, error: "Insufficient funds" };
        },
        async waitForModel() {
          throw new Error("waitForModel should not run after createTask fails");
        },
      },
    });
    const planned = await services.planner.planObject(PROMPT);
    expect(planned.type).toBe("plan");
    if (planned.type !== "plan") throw new Error("expected plan");
    const started = await services.generation.generateFromPlan(planned.plan, PROMPT);
    const task = await services.generation.getTask(started.taskId);
    expect(task.status).toBe("complete");
    expect(createCalls).toBe(1);
    expect(task.message).toMatch(/out of credits/i);
    const bundle = await services.assemblies.get(started.assemblyId);
    expect(bundle.instances.length).toBeGreaterThanOrEqual(7);
    expect(bundle.versions.every((version) => Boolean(version.geometryPath))).toBe(true);
  });

  it("saves a named iteration combo and can restore it", async () => {
    const bundle = await generateChair();
    expect(bundle.iterations.some((i) => i.name === "Blockout 1")).toBe(true);
    const first = bundle.iterations[0];
    const leg = bundle.components.find((c) => c.name === "Leg")!;
    const originalVersion = bundle.instances.find((i) => i.componentId === leg.id)!.versionId;
    expect(bundle.versions.find((v) => v.id === originalVersion)?.stage).toBe("form");
    await services.edits.edit({
      componentId: leg.id,
      assemblyId: bundle.assembly.id,
      prompt: "Make the legs taller.",
      applyTo: "definition",
    });
    const named = await services.assemblies.saveIteration(bundle.assembly.id, "Tall legs");
    expect(named.pins.some((p) => p.name === "Leg")).toBe(true);
    await services.assemblies.activateIteration(bundle.assembly.id, first.id);
    const restored = await services.assemblies.get(bundle.assembly.id);
    expect(restored.instances.find((i) => i.componentId === leg.id)!.versionId).toBe(originalVersion);
  });
});

