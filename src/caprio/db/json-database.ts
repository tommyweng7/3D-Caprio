import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DatabaseState } from "@/caprio/domain/types";
import { type Database, emptyState, isDatabaseState, normalizeState } from "@/caprio/db/database";

/**
 * File-backed store. Swap this implementation for Postgres/Supabase later
 * without changing domain services — they only depend on `Database`.
 */
export class JsonFileDatabase implements Database {
  private queue: Promise<void> = Promise.resolve();
  private cache: DatabaseState | null = null;

  constructor(private readonly filePath: string) {}

  async read(): Promise<DatabaseState> {
    if (this.cache) return structuredClone(this.cache);
    this.cache = await this.readFromDisk();
    return structuredClone(this.cache);
  }

  private async readFromDisk(): Promise<DatabaseState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      if (!raw.trim()) return emptyState();
      return normalizeState(JSON.parse(raw) as Partial<DatabaseState>);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyState();
      }
      throw error;
    }
  }

  async write(mutator: (state: DatabaseState) => unknown): Promise<DatabaseState> {
    let next: DatabaseState = emptyState();
    this.queue = this.queue.then(async () => {
      const current = this.cache ? structuredClone(this.cache) : await this.readFromDisk();
      const draft = structuredClone(current);
      const produced = mutator(draft);
      next = isDatabaseState(produced) ? produced : draft;
      this.cache = next;
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, JSON.stringify(next), "utf8");
      await rename(tmp, this.filePath);
    });
    await this.queue;
    return structuredClone(next);
  }
}

let singleton: JsonFileDatabase | null = null;

export function getJsonDatabase(): JsonFileDatabase {
  if (!singleton) {
    const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
    singleton = new JsonFileDatabase(path.join(dir, "store.json"));
  }
  return singleton;
}
