import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  if (!file.endsWith(".glb") || file.includes("..") || file.includes("/")) {
    return NextResponse.json({ error: "Invalid model path", code: "invalid_request" }, { status: 400 });
  }
  const filePath = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "models", file);
  try {
    const bytes = await readFile(filePath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "model/gltf-binary",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Model not found", code: "not_found" }, { status: 404 });
  }
}
