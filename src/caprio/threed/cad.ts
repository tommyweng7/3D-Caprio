export type CadSource = {
  provider: string;
  format: "kcl";
  files: Record<string, string>;
  conversationId?: string;
};

export function filesToUtf8Bytes(files: Record<string, string>): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [name, content] of Object.entries(files)) {
    out[name] = Array.from(Buffer.from(content, "utf8"));
  }
  return out;
}

export function utf8BytesToFiles(files: Record<string, number[] | string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    if (typeof content === "string") {
      out[name] = content;
      continue;
    }
    out[name] = Buffer.from(content).toString("utf8");
  }
  return out;
}

export function extractKclFiles(value: unknown, into: Record<string, string> = {}): Record<string, string> {
  if (!value || typeof value !== "object") return into;
  const record = value as Record<string, unknown>;
  if (record.outputs && typeof record.outputs === "object") {
    extractKclFiles(record.outputs, into);
  }
  if (record.files && typeof record.files === "object") {
    const files = utf8BytesToFiles(record.files as Record<string, number[] | string>);
    Object.assign(into, files);
  }
  for (const [key, child] of Object.entries(record)) {
    if (key.endsWith(".kcl") && typeof child === "string") into[key] = child;
    else if (key.endsWith(".kcl") && Array.isArray(child)) into[key] = Buffer.from(child as number[]).toString("utf8");
    else if (child && typeof child === "object" && key !== "files" && key !== "outputs") extractKclFiles(child, into);
  }
  return into;
}

export function mainKcl(files: Record<string, string>): string | null {
  return files["main.kcl"] || Object.entries(files).find(([name]) => name.endsWith(".kcl"))?.[1] || null;
}

export function parseKclNumbers(kcl: string): Record<string, number> {
  const values: Record<string, number> = {};
  const re = /(?:^|\n)\s*(height|width|depth|thickness|radius|taper|angle)\s*=\s*(-?\d+(?:\.\d+)?)/gi;
  for (const match of kcl.matchAll(re)) {
    values[match[1].toLowerCase()] = Number(match[2]);
  }
  return values;
}

export function patchKclNumbers(kcl: string, patch: Record<string, number>): string {
  let next = kcl;
  for (const [key, value] of Object.entries(patch)) {
    const re = new RegExp(`((?:^|\\n)\\s*${key}\\s*=\\s*)(-?\\d+(?:\\.\\d+)?)`, "i");
    if (re.test(next)) next = next.replace(re, `$1${value}`);
    else next = `${key} = ${value}\n${next}`;
  }
  return next;
}

export function parametricKcl(input: {
  name: string;
  prompt: string;
  parameters?: Array<{ key: string; value: number | string; unit?: string }>;
}): string {
  const nums = Object.fromEntries(
    (input.parameters || [])
      .filter((p) => typeof p.value === "number")
      .map((p) => [p.key, Number(p.value)]),
  );
  const kind = input.name.toLowerCase();
  const heightMm = mm(nums.height, /leg|post|column/.test(kind) ? 450 : /back/.test(kind) ? 480 : 70);
  const widthMm = mm(nums.width, /leg/.test(kind) ? 40 : 500);
  const depthMm = mm(nums.depth, /leg/.test(kind) ? 40 : 480);
  const thicknessMm = mm(nums.thickness, /back/.test(kind) ? 50 : 70);
  const radiusMm = mm(nums.radius, 20);

  return `// 3D-Caprio component: ${input.name}
// Isolated CAD part. Do not include other furniture components.
// ${input.prompt.replace(/\n/g, " ")}

height = ${heightMm}
width = ${widthMm}
depth = ${depthMm}
thickness = ${thicknessMm}
radius = ${radiusMm}

part = startSketchOn(XY)
  |> startProfile(at = [${-widthMm / 2}, ${-depthMm / 2}])
  |> line(end = [${widthMm}, 0])
  |> line(end = [0, ${depthMm}])
  |> line(end = [${-widthMm}, 0])
  |> close()
  |> extrude(length = ${/leg|post|column/.test(kind) ? heightMm : thicknessMm})
`;
}

function mm(metersOrMm: number | undefined, fallbackMm: number): number {
  if (metersOrMm == null || Number.isNaN(metersOrMm)) return fallbackMm;
  return metersOrMm > 20 ? Math.round(metersOrMm) : Math.round(metersOrMm * 1000);
}

export function inferParametricPatch(prompt: string, current: Record<string, number>): Record<string, number> | null {
  const text = prompt.toLowerCase();
  if (/art deco|style|shape|carv|sculpt|ornament|flut/.test(text) && !/taller|shorter|thicker|thinner|wider/.test(text)) {
    return null;
  }
  const patch: Record<string, number> = {};
  const height = current.height ?? 450;
  if (/taller|increase height|raise/.test(text)) patch.height = Math.round(height * 1.35);
  if (/shorter|decrease height/.test(text)) patch.height = Math.round(height * 0.75);
  if (/thicker/.test(text) && current.thickness) patch.thickness = Math.round(current.thickness * 1.25);
  if (/thinner/.test(text) && current.thickness) patch.thickness = Math.round(current.thickness * 0.8);
  if (/wider/.test(text) && current.width) patch.width = Math.round(current.width * 1.2);
  return Object.keys(patch).length ? patch : null;
}
