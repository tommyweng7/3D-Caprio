import { randomUUID } from "node:crypto";

export function uuid(): string {
  return randomUUID();
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return slug || "component";
}

export function uniqueSlug(base: string, existing: Set<string>): string {
  const root = slugify(base);
  if (!existing.has(root)) return root;
  let i = 2;
  while (existing.has(`${root}_${i}`)) i += 1;
  return `${root}_${i}`;
}
