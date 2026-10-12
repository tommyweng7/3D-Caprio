import path from "node:path";
import type { Database } from "@/caprio/db/database";
import { getJsonDatabase } from "@/caprio/db/json-database";
import { createLLMProvider } from "@/caprio/llm/factory";
import type { LLMProvider } from "@/caprio/llm/provider";
import { AssemblyService } from "@/caprio/services/assemblies";
import { ComponentService } from "@/caprio/services/components";
import { EditService } from "@/caprio/services/edits";
import { GenerationService } from "@/caprio/services/generation";
import { LibraryService } from "@/caprio/services/library";
import { PlannerService } from "@/caprio/services/planner";
import { SplitMergeService } from "@/caprio/services/split-merge";
import { createThreeDProvider } from "@/caprio/threed/factory";
import type { ThreeDProvider } from "@/caprio/threed/provider";

export interface AppServices {
  db: Database;
  planner: PlannerService;
  components: ComponentService;
  assemblies: AssemblyService;
  library: LibraryService;
  generation: GenerationService;
  edits: EditService;
  splitMerge: SplitMergeService;
}

export function createServices(options?: {
  db?: Database;
  llm?: LLMProvider;
  threed?: ThreeDProvider;
}): AppServices {
  const db = options?.db ?? getJsonDatabase();
  const planner = new PlannerService(options?.llm ?? createLLMProvider());
  const components = new ComponentService(db);
  const assemblies = new AssemblyService(db);
  const library = new LibraryService(db, assemblies);
  const modelsDir = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "models");
  const generation = new GenerationService(
    db,
    planner,
    components,
    assemblies,
    options?.threed ?? createThreeDProvider(),
    modelsDir,
  );
  const edits = new EditService(db, planner, components, assemblies, generation);
  const splitMerge = new SplitMergeService(db, components, assemblies, generation);
  return { db, planner, components, assemblies, library, generation, edits, splitMerge };
}

export function getServices(): AppServices {
  return createServices();
}
