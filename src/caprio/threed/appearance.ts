export interface Appearance {
  color: string;
  roughness: number;
  metalness: number;
  label: string;
}

export const MATERIAL_PRESETS: Record<string, Appearance> = {
  oak: { color: "#c4a574", roughness: 0.72, metalness: 0.02, label: "oak" },
  walnut: { color: "#5c3a21", roughness: 0.7, metalness: 0.04, label: "walnut" },
  wood: { color: "#b08968", roughness: 0.74, metalness: 0.02, label: "wood" },
  brass: { color: "#c4a35a", roughness: 0.28, metalness: 0.85, label: "brass" },
  steel: { color: "#8a93a0", roughness: 0.35, metalness: 0.9, label: "steel" },
  fabric: { color: "#d6c4a8", roughness: 0.92, metalness: 0, label: "fabric" },
  paint: { color: "#f4f1ea", roughness: 0.45, metalness: 0.05, label: "paint" },
};

const COLOR_WORDS: Record<string, string> = {
  red: "#a33a2c",
  crimson: "#8b1e3f",
  brown: "#6b3e26",
  tan: "#c4a574",
  beige: "#d9cbb3",
  cream: "#efe6d5",
  ivory: "#f4f1ea",
  white: "#f7f4ee",
  black: "#1a1a1a",
  charcoal: "#2f2f2f",
  grey: "#9a958c",
  gray: "#9a958c",
  silver: "#c5c8ce",
  blue: "#3d5a80",
  navy: "#1f3347",
  green: "#4a6741",
  olive: "#6b6b3a",
  gold: "#c4a35a",
  yellow: "#d4b44a",
  orange: "#c46a2b",
  purple: "#6b4c7a",
  pink: "#d4a0b0",
};

const FINISHES: Array<{ test: RegExp; roughness: number; metalness: number; color?: string; label: string }> = [
  { test: /velvet|velour/, roughness: 0.95, metalness: 0, color: "#6b2d4a", label: "velvet" },
  { test: /leather|hide/, roughness: 0.62, metalness: 0.04, color: "#6b3e26", label: "leather" },
  { test: /suede/, roughness: 0.9, metalness: 0, color: "#8a6a4a", label: "suede" },
  { test: /linen|cotton|canvas/, roughness: 0.93, metalness: 0, color: "#ddd3c2", label: "linen" },
  { test: /wool|tweed/, roughness: 0.96, metalness: 0, color: "#8c7a62", label: "wool" },
  { test: /silk|satin/, roughness: 0.28, metalness: 0.08, color: "#d8cfc0", label: "silk" },
  { test: /marble/, roughness: 0.22, metalness: 0.12, color: "#e8e4dc", label: "marble" },
  { test: /concrete|stone/, roughness: 0.88, metalness: 0.02, color: "#8d8a84", label: "stone" },
  { test: /chrome|mirror/, roughness: 0.08, metalness: 1, color: "#d5d8de", label: "chrome" },
  { test: /gold|gilded/, roughness: 0.25, metalness: 0.92, color: "#c4a35a", label: "gold" },
  { test: /copper/, roughness: 0.32, metalness: 0.88, color: "#b87333", label: "copper" },
  { test: /bronze/, roughness: 0.4, metalness: 0.8, color: "#8c6a3a", label: "bronze" },
  { test: /brushed/, roughness: 0.45, metalness: 0.82, label: "brushed metal" },
  { test: /plastic|acrylic/, roughness: 0.35, metalness: 0.05, color: "#d0d4d8", label: "plastic" },
  { test: /rubber|matte black/, roughness: 0.92, metalness: 0, color: "#222", label: "rubber" },
  { test: /glass/, roughness: 0.08, metalness: 0.15, color: "#c5d5dc", label: "glass" },
  { test: /ceramic/, roughness: 0.4, metalness: 0.05, color: "#efe8dc", label: "ceramic" },
];

const GEOMETRY_HINT =
  /(taller|shorter|wider|thinner|thicker|cutout|floral|pattern|sculpt|regenerat|reshape|star|ornate|carv|geometry|mesh|silhouette|blockout|tuck|tuft|upholster|quilt|pleat|channel|hole|serrat|extend|notch|slot|chamfer|fillet|faceplate|\badd\b|\bhandle\b)/i;

export function looksLikeGeometryRequest(text: string): boolean {
  return GEOMETRY_HINT.test(text);
}

function colorFromText(text: string): string | undefined {
  const hex = text.match(/#([0-9a-f]{6})/i);
  if (hex) return `#${hex[1]}`;
  for (const [word, color] of Object.entries(COLOR_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) return color;
  }
  return undefined;
}

function hashHue(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  const h = hash % 360;
  return `hsl(${h} 28% 52%)`;
}

export function appearanceFromText(text: string): Appearance | null {
  const blob = text.toLowerCase().trim();
  if (!blob) return null;
  if (GEOMETRY_HINT.test(blob) && !/(material|finish|leather|velvet|oak|walnut|brass|paint|fabric)/.test(blob)) {
    return null;
  }

  for (const [key, preset] of Object.entries(MATERIAL_PRESETS)) {
    if (blob.includes(key)) {
      const tint = colorFromText(blob);
      return tint && tint !== preset.color ? { ...preset, color: tint, label: `${blob.match(/\b\w+\b/g)?.[0] || ""} ${preset.label}`.trim() } : preset;
    }
  }

  const finish = FINISHES.find((item) => item.test.test(blob));
  const tint = colorFromText(blob);
  if (finish) {
    return {
      color: tint || finish.color || "#b08968",
      roughness: finish.roughness,
      metalness: finish.metalness,
      label: text.replace(/^(change|set|make)\s+(the\s+)?(material|finish|it)\s*(to|as)?\s*/i, "").trim() || finish.label,
    };
  }

  if (tint) {
    const metal = /metal|steel|iron|aluminum|aluminium/.test(blob);
    return {
      color: tint,
      roughness: metal ? 0.35 : /matte|flat/.test(blob) ? 0.9 : /gloss|shiny|polished/.test(blob) ? 0.2 : 0.65,
      metalness: metal ? 0.85 : 0.05,
      label: text.replace(/^(change|set|make)\s+(the\s+)?(material|finish|it|color)\s*(to|as)?\s*/i, "").trim() || "custom",
    };
  }

  if (/^(change|set|make).*(material|finish|color)|material:|finish:/i.test(blob) || /leather|velvet|wood|metal|fabric|paint/.test(blob)) {
    const label = text.replace(/^(change|set|make)\s+(the\s+)?(material|finish|it)\s*(to|as)?\s*/i, "").trim() || blob;
    return { color: hashHue(label), roughness: 0.6, metalness: 0.08, label };
  }

  return null;
}

export function appearanceFromParameters(
  parameters: Array<{ key: string; value: string | number }>,
): Partial<Appearance> {
  const get = (key: string) => parameters.find((p) => p.key === key)?.value;
  const color = get("color");
  const roughness = get("roughness");
  const metalness = get("metalness");
  const material = get("material");
  const fromMaterial = typeof material === "string" ? appearanceFromText(String(material)) : null;
  return {
    color: typeof color === "string" ? color : fromMaterial?.color,
    roughness: typeof roughness === "number" ? roughness : fromMaterial?.roughness,
    metalness: typeof metalness === "number" ? metalness : fromMaterial?.metalness,
    label: fromMaterial?.label,
  };
}

export const DEFAULT_CLAY: Appearance = {
  color: "#d2cdc4",
  roughness: 0.82,
  metalness: 0.04,
  label: "clay",
};
