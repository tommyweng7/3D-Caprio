import type { DatabaseState } from "@/caprio/domain/types";

export interface Database {
  read(): Promise<DatabaseState>;
  write(mutator: (state: DatabaseState) => unknown): Promise<DatabaseState>;
}

const ARRAY_KEYS = [
  "components",
  "componentVersions",
  "assemblies",
  "assemblyComponents",
  "connectionPoints",
  "parameters",
  "dependencies",
  "libraryItems",
  "generationTasks",
  "editRequests",
  "designBranches",
  "designIterations",
  "changeSets",
  "designDecisions",
  "markers",
] as const;

export function emptyState(): DatabaseState {
  return {
    components: [],
    componentVersions: [],
    assemblies: [],
    assemblyComponents: [],
    connectionPoints: [],
    parameters: [],
    dependencies: [],
    libraryItems: [],
    generationTasks: [],
    editRequests: [],
    designBranches: [],
    designIterations: [],
    changeSets: [],
    designDecisions: [],
    markers: [],
  };
}

export function normalizeState(parsed: Partial<DatabaseState> | null | undefined): DatabaseState {
  const base = emptyState();
  if (!parsed || typeof parsed !== "object") return base;
  const next = { ...base, ...parsed };
  for (const key of ARRAY_KEYS) {
    const value = next[key];
    (next as Record<string, unknown>)[key] = Array.isArray(value) ? value : [];
  }
  return next;
}

export function isDatabaseState(value: unknown): value is DatabaseState {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as DatabaseState).components) &&
    Array.isArray((value as DatabaseState).assemblies)
  );
}
