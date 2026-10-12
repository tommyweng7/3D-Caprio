import { z } from "zod";

const COMPONENT_ROLES = ["structural", "functional", "aesthetic", "connector", "hardware"] as const;
const DEPENDENCY_KINDS = ["structural", "attachment", "aesthetic"] as const;

export function normalizeComponentRole(role: unknown) {
  const value = String(role ?? "").toLowerCase().trim();
  if ((COMPONENT_ROLES as readonly string[]).includes(value)) return value;
  if (/(comfort|pad|cushion|upholster|decor|visual|style)/.test(value)) return "aesthetic";
  if (/(connect|joint|fasten|attach|hardware|bolt|screw)/.test(value)) return "hardware";
  if (/(function|move|mechan|hinge|swivel)/.test(value)) return "functional";
  return "structural";
}

export function normalizeDependencyKind(kind: unknown) {
  const value = String(kind ?? "").toLowerCase().trim();
  if ((DEPENDENCY_KINDS as readonly string[]).includes(value)) return value;
  if (/(attach|rest|sit|mount|join)/.test(value)) return "attachment";
  if (/(visual|style|aesthetic)/.test(value)) return "aesthetic";
  return "structural";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  return record ? Object.values(record) : [];
}

function asText(value: unknown, fallback = "") {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return fallback;
}

export const parameterSchema = z.object({
  key: z.string().min(1),
  value: z.preprocess((value) => {
    if (typeof value === "number" || typeof value === "string") return value;
    if (typeof value === "boolean") return String(value);
    if (value == null) return 0;
    return String(value);
  }, z.union([z.number(), z.string()])),
  unit: z.string().optional(),
  affectsGeometry: z.preprocess((value) => Boolean(value), z.boolean()).default(false),
});

function normalizeQuantity(value: unknown) {
  if (value && typeof value === "object") {
    const record = asRecord(value);
    return normalizeQuantity(record?.value ?? record?.count ?? record?.quantity);
  }
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(32, Math.round(n));
}

function normalizeArrangement(value: unknown) {
  const text = String(value ?? "single").toLowerCase();
  if (text === "single" || text === "corners" || text === "grid" || text === "linear") return text;
  if (/(corner|leg|four|quad)/.test(text)) return "corners";
  if (/(grid|array|matrix)/.test(text)) return "grid";
  if (/(row|line|linear|along)/.test(text)) return "linear";
  return "single";
}

function normalizePrompt(value: unknown) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.slice(0, 800);
}

export const plannedComponentSchema = z.object({
  name: z.string().min(1).max(80),
  role: z.preprocess(normalizeComponentRole, z.enum(COMPONENT_ROLES)),
  quantity: z.preprocess(normalizeQuantity, z.number().int().min(1).max(32)),
  generation_prompt: z.preprocess(normalizePrompt, z.string().min(8).max(800)),
  parameters: z.array(parameterSchema).optional(),
  layout: z
    .object({
      arrangement: z.preprocess(normalizeArrangement, z.enum(["single", "corners", "grid", "linear"])).default("single"),
    })
    .optional(),
  purpose: z.string().optional(),
  style: z.string().optional(),
  material: z.string().optional(),
  constraints: z.array(z.string()).optional(),
});

export const componentPlanSchema = z.object({
  object_name: z.string().min(1),
  summary: z.string().min(1),
  components: z.array(plannedComponentSchema).min(1).max(24),
  dependencies: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        kind: z.preprocess(normalizeDependencyKind, z.enum(DEPENDENCY_KINDS)),
        description: z.preprocess((value) => String(value ?? ""), z.string()),
      }),
    )
    .default([]),
  clarifications: z.array(z.string()).default([]),
});

export const clarificationResponseSchema = z.object({
  type: z.literal("clarification"),
  questions: z.array(z.string().min(1)).min(1).max(3),
});

export const planOrClarifySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("plan"),
    plan: componentPlanSchema,
  }),
  clarificationResponseSchema,
]);

export function promptLooksSpecified(prompt: string) {
  const text = prompt.trim();
  if (text.length < 24) return false;
  return /(wood|metal|oak|walnut|modern|padded|curved|taper|leg|fabric|steel|plastic|style|chair|table|stool|lamp)/i.test(
    text,
  );
}

export function canUseLocalChairPlan(prompt: string) {
  const text = prompt.toLowerCase();
  if (!/chair/.test(text)) return false;
  if (/(armrest|rocker|wheel|office|recliner|bar stool|folding)/.test(text)) return false;
  return promptLooksSpecified(prompt) || /(wood|modern|padded|leg)/.test(text);
}

export function sanitizePlannerPayload(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    return sanitizePlannerPayload({ type: "plan", components: raw });
  }
  const root = asRecord(raw);
  if (!root) throw new Error("Planner JSON was empty");

  const type = asText(root.type).toLowerCase();
  if (type === "clarification") {
    const questions = asList(root.questions)
      .map((item) => asText(item))
      .filter(Boolean)
      .slice(0, 3);
    if (questions.length) return { type: "clarification", questions };
  }

  const nested = asRecord(root.plan) || root;
  const components = asList(nested.components || nested.parts || root.components)
    .map((item, index) => {
      const part = asRecord(item) || {};
      const name = asText(part.name || part.part || part.component, `Part ${index + 1}`).slice(0, 80);
      const prompt = normalizePrompt(
        part.generation_prompt || part.prompt || part.description || `Standalone ${name} mesh, single part only.`,
      );
      return {
        name: name || `Part ${index + 1}`,
        role: part.role,
        quantity: part.quantity ?? part.count ?? 1,
        generation_prompt: prompt.length >= 8 ? prompt : `Standalone ${name} furniture part, isolated mesh.`,
        parameters: asList(part.parameters)
          .map((parameter) => {
            const rec = asRecord(parameter);
            if (!rec) return null;
            const key = asText(rec.key || rec.name);
            if (!key) return null;
            return rec;
          })
          .filter(Boolean),
        layout: asRecord(part.layout) || (part.arrangement ? { arrangement: part.arrangement } : undefined),
        purpose: asText(part.purpose) || undefined,
        style: asText(part.style) || undefined,
        material: asText(part.material) || undefined,
      };
    })
    .filter((part) => part.name);

  if (!components.length) throw new Error("Planner JSON had no components");

  const objectName = asText(nested.object_name || nested.name || root.object_name, "Object") || "Object";
  const summary = asText(nested.summary || nested.description || root.summary, objectName) || objectName;
  const dependencies = asList(nested.dependencies || root.dependencies)
    .map((item) => {
      const rec = asRecord(item);
      if (!rec) return null;
      const from = asText(rec.from || rec.source);
      const to = asText(rec.to || rec.target);
      if (!from || !to) return null;
      return {
        from,
        to,
        kind: rec.kind,
        description: rec.description ?? rec.note ?? "",
      };
    })
    .filter(Boolean);

  return {
    type: "plan",
    plan: {
      object_name: objectName,
      summary,
      components,
      dependencies,
      clarifications: asList(nested.clarifications).map((item) => asText(item)).filter(Boolean),
    },
  };
}

export const editIntentSchema = z.object({
  parameterOnly: z.boolean(),
  updatedPrompt: z.string().min(1),
  parameters: z.array(parameterSchema).default([]),
  styleNotes: z.string().default(""),
  geometryMustChange: z.boolean(),
  split: z
    .object({
      requested: z.boolean(),
      parts: z.array(z.object({ name: z.string(), generation_prompt: z.string() })),
    })
    .optional(),
});

export type PlanOrClarify = z.infer<typeof planOrClarifySchema>;
export type ValidatedPlan = z.infer<typeof componentPlanSchema>;
export type EditIntent = z.infer<typeof editIntentSchema>;
