import { inferPartKind } from "@/caprio/threed/part-shape";

const STOP = new Set([
  "the",
  "a",
  "an",
  "to",
  "on",
  "of",
  "and",
  "with",
  "this",
  "that",
  "chair",
  "component",
  "please",
  "make",
  "add",
  "it",
  "as",
  "some",
  "sort",
  "thing",
  "into",
  "from",
  "keep",
  "only",
  "just",
  "rebuild",
  "change",
  "set",
]);

const KIND_WORD: Record<string, string> = {
  back: "backrest",
  cushion: "cushion",
  seat: "seat",
  leg: "leg",
  arm: "armrest",
  generic: "part",
};

export function versionTitle(componentName: string, prompt: string, versionNumber: number): string {
  if (versionNumber <= 1) return `Original ${componentName}`;
  const kind = KIND_WORD[inferPartKind(componentName, prompt)] || componentName.toLowerCase();
  const cleaned = prompt
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/rebuild as a low-poly[^.]*\.?/g, "blockout")
    .replace(/of a chair|the chair'?s?/g, "")
    .replace(/[^a-z0-9\s-]/g, " ");
  const tokens = cleaned
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP.has(token))
    .slice(0, 4);
  if (!tokens.length) return `${componentName} v${versionNumber}`;
  const title = tokens.map((token) => token[0].toUpperCase() + token.slice(1)).join(" ");
  if (title.toLowerCase().includes(kind)) return title;
  return `${title} ${kind[0].toUpperCase()}${kind.slice(1)}`;
}
