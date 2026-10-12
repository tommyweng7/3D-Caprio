import { readFile } from "node:fs/promises";
import path from "node:path";

export interface GlbMeshInfo {
  meshCount: number;
  nodeCount: number;
  primitiveCount: number;
  materialCount: number;
  generator?: string;
}

export async function inspectGlbMeshes(publicOrFsPath: string): Promise<GlbMeshInfo> {
  const filePath = publicOrFsPath.startsWith("/api/models/")
    ? path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "models", publicOrFsPath.split("/").pop() || "")
    : publicOrFsPath;

  const bytes = await readFile(filePath);
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF") {
    return { meshCount: 0, nodeCount: 0, primitiveCount: 0, materialCount: 0 };
  }
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.slice(20, 20 + jsonLength).toString("utf8").trim());
  const meshes = json.meshes || [];
  const primitives = meshes.flatMap((m: { primitives?: unknown[] }) => m.primitives || []);
  return {
    meshCount: meshes.length,
    nodeCount: (json.nodes || []).length,
    primitiveCount: primitives.length,
    materialCount: (json.materials || []).length,
    generator: json.asset?.generator,
  };
}
