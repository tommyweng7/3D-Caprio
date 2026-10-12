import type { Vec3 } from "@/caprio/domain/types";

export function metersToCm(v: Vec3): Vec3 {
  return { x: v.x * 100, y: v.y * 100, z: v.z * 100 };
}

export function cmToMeters(v: Vec3): Vec3 {
  return { x: v.x / 100, y: v.y / 100, z: v.z / 100 };
}

export function formatCm(v: Vec3, digits = 1): string {
  const c = metersToCm(v);
  return `${c.x.toFixed(digits)}, ${c.y.toFixed(digits)}, ${c.z.toFixed(digits)}`;
}

export function distanceMeters(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function nextPinName(existing: string[]): string {
  const used = new Set(existing.map((name) => name.trim().toUpperCase()));
  for (let i = 0; i < 26; i += 1) {
    const letter = String.fromCharCode(65 + i);
    if (!used.has(letter)) return letter;
  }
  return `P${existing.length + 1}`;
}

/** Parse "9, 3, 4" or "at 9 3 4" as centimeters → meters. */
export function parseCmTriple(text: string): Vec3 | null {
  const match = text.match(/(?:at\s+)?(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const cm = { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
  if (![cm.x, cm.y, cm.z].every(Number.isFinite)) return null;
  return cmToMeters(cm);
}

export function landmarkPrompt(prompt: string, partName: string, markers: Array<{ name: string; position: Vec3 }>): string {
  const parsed = parseCmTriple(prompt);
  const listed = markers
    .map((marker) => `${marker.name} at ${formatCm(marker.position)} cm`)
    .join("; ");
  const explicit = parsed ? ` Explicit point ${formatCm(parsed)} cm.` : "";
  const landmarks = listed ? ` World landmarks (Y-up centimeters, origin on the floor center): ${listed}.` : "";
  return `${prompt.trim()}. Apply this feature to the selected ${partName} only.${explicit}${landmarks}`.replace(/\s+/g, " ").trim();
}
