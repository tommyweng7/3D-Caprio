import { afterEach, describe, expect, it, vi } from "vitest";
import { SondialMeshProvider } from "@/caprio/threed/sondial-mesh-provider";
import { buildBoxGlb } from "@/caprio/threed/glb";
import type { MeshGenerationProvider } from "@/providers/types";

type MeshInput = Parameters<MeshGenerationProvider["generateMesh"]>[0];

/** Stands in for Sondial's mesh provider: one poll in progress, then done. */
class StubMeshProvider implements MeshGenerationProvider {
  readonly name = "meshy";
  readonly calls: MeshInput[] = [];
  private polls = 0;

  constructor(private readonly meshFileUrl: string) {}

  async generateMesh(input: MeshInput) {
    this.calls.push(input);
    return { jobId: "job_1" };
  }

  async checkStatus(jobId: string) {
    if (jobId !== "job_1") return { status: "failed" as const, error: "unknown job" };
    this.polls += 1;
    if (this.polls < 2) return { status: "processing" as const, progress: 40 };
    return {
      status: "complete" as const,
      progress: 100,
      result: { meshFileUrl: this.meshFileUrl, format: "glb" as const },
    };
  }
}

describe("Caprio geometry over Sondial's mesh provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MESHY_POLL_INTERVAL_MS;
  });

  it("asks for the detail tier only on a Detail pass", async () => {
    const stub = new StubMeshProvider("https://cdn.example/model.glb");
    const provider = new SondialMeshProvider(stub);

    await provider.createTask({ prompt: "floral cutouts", partName: "Back", stage: "detail" });
    await provider.createTask({ prompt: "tapered leg", partName: "Leg", stage: "form" });

    expect(stub.calls[0].quality).toBe("detail");
    expect(stub.calls[1].quality).toBe("fast");
  });

  it("sends one isolated part, not the whole assembly", async () => {
    const stub = new StubMeshProvider("https://cdn.example/model.glb");
    await new SondialMeshProvider(stub).createTask({
      prompt: "floral cutouts",
      partName: "Back",
      stage: "detail",
    });

    const prompt = stub.calls[0].prompt ?? "";
    expect(prompt).toMatch(/^Isolated/);
    expect(prompt).toMatch(/panel/i);
    expect(prompt).toMatch(/DETAIL PASS/i);
    expect(prompt).toMatch(/FORBIDDEN: a complete chair/i);
    expect(stub.calls[0].format).toBe("glb");
  });

  it("polls to completion and returns the downloaded GLB", async () => {
    process.env.MESHY_POLL_INTERVAL_MS = "1";
    const glb = buildBoxGlb();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(glb), { status: 200 })),
    );

    const provider = new SondialMeshProvider(new StubMeshProvider("https://cdn.example/model.glb"));
    const progress: number[] = [];
    const result = await provider.waitForModel("job_1", {
      onProgress: (snapshot) => void progress.push(snapshot.progress),
    });

    expect(result.modelBytes.toString("ascii", 0, 4)).toBe("glTF");
    expect(result.mimeType).toBe("model/gltf-binary");
    expect(progress).toContain(40);
  });

  it("rejects a download that is not a GLB", async () => {
    process.env.MESHY_POLL_INTERVAL_MS = "1";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>expired link</html>", { status: 200 })),
    );

    const provider = new SondialMeshProvider(new StubMeshProvider("https://cdn.example/model.glb"));
    await expect(provider.waitForModel("job_1")).rejects.toMatchObject({ code: "invalid_glb" });
  });

  it("surfaces a provider failure instead of writing a broken part", async () => {
    process.env.MESHY_POLL_INTERVAL_MS = "1";
    const provider = new SondialMeshProvider(new StubMeshProvider("https://cdn.example/model.glb"));
    await expect(provider.waitForModel("nope")).rejects.toMatchObject({ code: "generation_failure" });
  });
});
