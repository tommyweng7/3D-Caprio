import type { DatabaseState } from "@/caprio/domain/types";
import { type Database, emptyState, isDatabaseState } from "@/caprio/db/database";

export class MemoryDatabase implements Database {
  private state: DatabaseState;

  constructor(initial?: DatabaseState) {
    this.state = initial ? structuredClone(initial) : emptyState();
  }

  async read(): Promise<DatabaseState> {
    return structuredClone(this.state);
  }

  async write(mutator: (state: DatabaseState) => unknown): Promise<DatabaseState> {
    const draft = structuredClone(this.state);
    const result = mutator(draft);
    this.state = isDatabaseState(result) ? result : draft;
    return structuredClone(this.state);
  }
}
