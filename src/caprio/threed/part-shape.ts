import type { DetailStage } from "@/caprio/domain/types";

export type PartKind = "leg" | "seat" | "cushion" | "back" | "arm" | "generic";

const KIND_HINTS: Record<PartKind, { positive: string; negative: string }> = {
  leg: {
    positive:
      "One single vertical tapered wooden CHAIR LEG only, 45cm tall and 4cm thick, standing upright like a table-leg product shot.",
    negative:
      "FORBIDDEN: a full chair, seat, backrest, room, floor, or four legs. One leg only. Watertight solid wooden mesh.",
  },
  seat: {
    positive:
      "One wide FLAT rectangular wooden SEAT SLAB only, 50cm wide, 46cm deep, 5cm thick. Horizontal board, watertight solid.",
    negative:
      "FORBIDDEN: a full chair, legs, backrest, or room. Not a rod. Much wider and deeper than it is thick. Closed solid wooden mesh.",
  },
  cushion: {
    positive:
      "One plump rectangular SEAT CUSHION only, 48cm wide, 44cm deep, 10cm thick, like a sofa seat pad. Watertight CLOSED solid upholstery.",
    negative:
      "FORBIDDEN: a full chair, legs, backrest, sheet, plane, spikes, holes, or black interior. Not a pancake. Solid stuffed cushion block only.",
  },
  back: {
    positive:
      "One thin upright wooden SPLAT PANEL only, a flat rectangle standing on its long edge, about 48cm wide and 46cm tall. Front product shot of the board, not furniture.",
    negative:
      "FORBIDDEN: a complete chair, side view of a chair, front view of a chair, four legs, a seat, armrests, or a room. Isolated flat panel only.",
  },
  arm: {
    positive: "One wooden ARMREST only, 40cm long, 8cm wide, 6cm thick. Watertight solid.",
    negative: "FORBIDDEN: a full chair, legs, or seat.",
  },
  generic: {
    positive: "One solid furniture PART only, realistic proportions, watertight mesh.",
    negative: "FORBIDDEN: a complete piece of furniture or a room. Isolated part only.",
  },
};

export function inferPartKind(partName?: string, prompt = ""): PartKind {
  const name = (partName || "").toLowerCase().trim();
  if (/cushion|pillow|pad/.test(name)) return "cushion";
  if (/seat/.test(name)) return "seat";
  if (/back/.test(name)) return "back";
  if (/arm/.test(name)) return "arm";
  if (/^(leg|post|column|spindle)s?$/.test(name) || /^leg\b/.test(name)) return "leg";
  if (name) return "generic";

  const stripped = prompt
    .toLowerCase()
    .replace(/\bno\b[^.,;]*\b(legs?|back|seat|cushions?)\b/g, " ")
    .replace(/\bwithout\b[^.,;]*\b(legs?|back|seat|cushions?)\b/g, " ");

  if (/cushion|pillow/.test(stripped)) return "cushion";
  if (/\bseat\b/.test(stripped)) return "seat";
  if (/backrest|\bback\b/.test(stripped)) return "back";
  if (/\barmrest|\barm\b/.test(stripped)) return "arm";
  if (/\bleg\b/.test(stripped) || /\btaper/.test(stripped)) return "leg";
  return "generic";
}

const STAGE_HINTS: Record<DetailStage, string> = {
  blockout:
    "LOW POLY BLOCKOUT: gray clay, simple silhouette, no ornaments, no cutouts, no fabric weave, no shaders. Only the raw massing of this part.",
  form:
    "FORM PASS: medium-poly, correct proportions and primary surfaces, real furniture material. Not a featureless box. No tiny filigree yet.",
  detail:
    "DETAIL PASS: high-resolution sculpt. The requested feature MUST be clearly modeled in the mesh — tufting, channels, cutouts, carving, stitching, or handles. Not a smooth clay block.",
};

export function looksLikeAdditiveEdit(prompt: string): boolean {
  return /\b(add|attach|include|with a|put a|put an)\b/i.test(prompt) || /\b(handle|grip|hole|slot|hook)\b/i.test(prompt);
}

function compactPreserve(text: string): string {
  return text
    .replace(/Isolated [^.]*\./gi, " ")
    .replace(/Product-studio[^.]*\./gi, " ")
    .replace(/FORBIDDEN:[^.]*\./gi, " ")
    .replace(/(LOW POLY BLOCKOUT|FORM PASS|DETAIL PASS):[^.]*\./gi, " ")
    .replace(/KEEP this existing[^.]*\./gi, " ")
    .replace(/World landmarks[^.]*\./gi, " ")
    .replace(/Apply this feature[^.]*\./gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

export function meshGenerationPrompt(
  partName: string | undefined,
  prompt: string,
  stage: DetailStage = "blockout",
  options?: { preserve?: string },
): string {
  const kind = inferPartKind(partName);
  const hint = KIND_HINTS[kind];
  const label = partWord(kind, partName);
  const request = sanitizePartRequest(prompt, kind) || `one ${label}`;
  const keep = options?.preserve ? compactPreserve(options.preserve) : "";
  const additive = Boolean(keep) && looksLikeAdditiveEdit(request);
  if (additive) {
    return [
      `KEEP this existing ${label}. Do not redesign it.`,
      keep ? `Current part: ${keep}.` : "",
      `Only add this feature: ${request}.`,
      `Same overall silhouette, proportions, and material. Isolated ${label} only, not a complete chair.`,
      `FORBIDDEN: a brand-new ${label} design, a full chair, legs, seat, or a room.`,
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 800);
  }
  const surface = looksLikeSurfaceRebuild(request);
  const stageHint = surface || stage === "detail" ? STAGE_HINTS.detail : STAGE_HINTS[stage];
  const positive = surface ? surfacePositive(kind, label, request) : hint.positive;
  const negative = surface
    ? `FORBIDDEN: a complete chair, extra parts, room, or floor. Only the ${label}.`
    : hint.negative;
  const wrapped = [
    `Isolated ${label} only.`,
    request,
    `Product-studio shot of that ${label} alone.`,
    positive,
    stageHint,
    `Do not model a complete chair or any other furniture parts.`,
    negative,
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return wrapped.slice(0, 800);
}

function partWord(kind: PartKind, partName?: string) {
  if (kind === "back") return "flat wooden splat panel";
  if (kind === "cushion") return "seat cushion";
  if (kind === "seat") return "seat slab";
  if (kind === "leg") return "single chair leg";
  if (kind === "arm") return "armrest";
  return partName || "furniture part";
}

function surfacePositive(kind: PartKind, label: string, request: string): string {
  if (kind === "back") {
    return `Front orthographic view of one ${label} only, standing upright. Apply this to the board itself: ${request}. Openwork piercing is allowed. Forbidden: a complete chair, a side view of a chair, legs, or a seat.`;
  }
  if (kind === "seat" || kind === "cushion") {
    return `A single isolated ${label} with this change applied to that part only: ${request}. Keep a seat-shaped mass. Tufting, channels, and upholstery folds are allowed. No legs or backrest.`;
  }
  return `A single isolated ${label} with this change applied to that part only: ${request}.`;
}

export function looksLikeSurfaceRebuild(prompt: string): boolean {
  return /(cutout|floral|ornate|star|pattern|tuck.?and.?roll|\btuft|upholster|quilt|pleat|channel|button.?tuft|carv|filigree|inlay|perforat|hole|serrat|extend|notch|slot|chamfer|fillet|faceplate)/i.test(
    prompt,
  );
}

export function sanitizePartRequest(prompt: string, kind: PartKind): string {
  return prompt
    .replace(/\bno legs or back\b/gi, "without any other parts")
    .replace(/\bon the back of a chairs?\b/gi, "on this backrest panel")
    .replace(/\b(front|side) view of (a |the )?chair\b/gi, `${kind}`)
    .replace(/\bof a chairs?\b/gi, "")
    .replace(/\bthe chairs?\b/gi, `the ${kind}`)
    .replace(/\s+/g, " ")
    .trim();
}

/** True only for meter-scale full furniture, not a thick backrest or tufted seat. */
export function looksLikeWholeObject(kind: PartKind, size: { x: number; y: number; z: number }): boolean {
  const axes = [size.x, size.y, size.z].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (axes.length < 3) return true;
  const [min, mid, max] = axes;
  const furnitureSized = min > 0.7 && mid > 0.85 && max > 1.1;
  const giantCube = max >= 1.4 && max / min < 1.85;
  if (furnitureSized || giantCube) return true;
  if (kind === "leg") return max / min < 1.6 && max > 0.85;
  return false;
}

/** True when a supposedly isolated back/seat is actually a chair silhouette (legs at the bottom). */
export function looksLikeChairProfile(points: Array<[number, number, number]>): boolean {
  if (points.length < 24) return false;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let a = 0; a < 3; a += 1) {
      min[a] = Math.min(min[a], p[a]);
      max[a] = Math.max(max[a], p[a]);
    }
  }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map((s) => Math.max(s, 1e-6));
  const ranked = [0, 1, 2].sort((a, b) => size[a] - size[b]);
  const face = [ranked[1], ranked[2]];
  const up = size[face[0]] >= size[face[1]] ? face[0] : face[1];
  const across = face.find((i) => i !== up) ?? face[0];
  const height = size[up];
  const width = size[across];
  const bottomCut = min[up] + height * 0.28;
  const xs: number[] = [];
  for (const p of points) {
    if (p[up] <= bottomCut) xs.push(p[across]);
  }
  if (xs.length < 80) return false;
  xs.sort((a, b) => a - b);
  const gap = width * 0.12;
  const clusters: Array<{ min: number; max: number; count: number }> = [{ min: xs[0], max: xs[0], count: 1 }];
  for (const x of xs.slice(1)) {
    const last = clusters[clusters.length - 1];
    if (x - last.max > gap) clusters.push({ min: x, max: x, count: 1 });
    else {
      last.max = x;
      last.count += 1;
    }
  }
  const legs = clusters.filter((c) => c.count >= 20);
  if (legs.length < 2) return false;
  const span = xs[xs.length - 1] - xs[0];
  const fattest = Math.max(...legs.map((c) => c.max - c.min));
  return span > width * 0.4 && fattest < width * 0.38;
}

export function primitiveForKind(kind: PartKind): {
  type: "box" | "cylinder";
  sx?: number;
  sy?: number;
  sz?: number;
  radius?: number;
  height?: number;
  color: [number, number, number];
} {
  switch (kind) {
    case "leg":
      return { type: "cylinder", radius: 0.04, height: 0.45, color: [0.45, 0.28, 0.14] };
    case "seat":
      return { type: "box", sx: 0.5, sy: 0.05, sz: 0.46, color: [0.62, 0.42, 0.22] };
    case "cushion":
      return { type: "box", sx: 0.48, sy: 0.1, sz: 0.44, color: [0.78, 0.7, 0.58] };
    case "back":
      return { type: "box", sx: 0.48, sy: 0.46, sz: 0.028, color: [0.6, 0.4, 0.22] };
    case "arm":
      return { type: "box", sx: 0.08, sy: 0.12, sz: 0.42, color: [0.55, 0.35, 0.18] };
    default:
      return { type: "box", sx: 0.3, sy: 0.2, sz: 0.3, color: [0.7, 0.7, 0.72] };
  }
}

export const CANONICAL_SIZE: Record<PartKind, { x: number; y: number; z: number }> = {
  seat: { x: 0.5, y: 0.05, z: 0.46 },
  cushion: { x: 0.48, y: 0.1, z: 0.44 },
  back: { x: 0.48, y: 0.46, z: 0.028 },
  leg: { x: 0.045, y: 0.45, z: 0.045 },
  arm: { x: 0.07, y: 0.08, z: 0.4 },
  generic: { x: 0.3, y: 0.2, z: 0.3 },
};

type SizeParam = { key: string; value: number | string; unit?: string };

function paramNumber(parameters: SizeParam[] | undefined, keys: string[], fallback: number) {
  const found = parameters?.find((p) => keys.includes(p.key.toLowerCase()));
  let value = typeof found?.value === "number" ? found.value : Number(found?.value);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  if (found?.unit === "cm" || value > 3) value = value / 100;
  return value;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Target AABB in meters after the mesh is oriented (Y up, -Z rear). */
export function canonicalSize(kind: PartKind, parameters?: SizeParam[]): { x: number; y: number; z: number } {
  const base = CANONICAL_SIZE[kind];
  if (kind === "seat") {
    return {
      x: clamp(paramNumber(parameters, ["width"], base.x), 0.4, 0.62),
      y: clamp(paramNumber(parameters, ["thickness", "height"], base.y), 0.04, 0.07),
      z: clamp(paramNumber(parameters, ["depth"], base.z), 0.38, 0.56),
    };
  }
  if (kind === "cushion") {
    return {
      x: clamp(paramNumber(parameters, ["width"], base.x), 0.38, 0.58),
      y: clamp(paramNumber(parameters, ["thickness", "height"], base.y), 0.08, 0.14),
      z: clamp(paramNumber(parameters, ["depth"], base.z), 0.36, 0.52),
    };
  }
  if (kind === "back") {
    return {
      x: clamp(paramNumber(parameters, ["width"], base.x), 0.4, 0.58),
      y: clamp(paramNumber(parameters, ["height"], base.y), 0.36, 0.58),
      z: clamp(paramNumber(parameters, ["thickness", "depth"], base.z), 0.02, 0.035),
    };
  }
  if (kind === "leg") {
    const thick = clamp(paramNumber(parameters, ["top_width", "width", "thickness", "radius"], base.x), 0.032, 0.06);
    return {
      x: thick,
      y: clamp(paramNumber(parameters, ["height"], base.y), 0.38, 0.55),
      z: thick,
    };
  }
  return { ...base };
}
