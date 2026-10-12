import type { CadSource } from "@/caprio/threed/cad";

export type Vec3 = { x: number; y: number; z: number };

export type PipelineStatus =
  | "idle"
  | "planning"
  | "generating"
  | "downloading"
  | "assembling"
  | "complete"
  | "failed";

export type DetailStage = "blockout" | "form" | "detail";

export type ComponentRole =
  | "structural"
  | "functional"
  | "aesthetic"
  | "connector"
  | "hardware";

export interface Parameter {
  id: string;
  key: string;
  value: number | string;
  unit?: string;
  affectsGeometry: boolean;
}

export interface ConnectionPoint {
  id: string;
  name: string;
  type: string;
  position: Vec3;
  orientation: Vec3;
  compatibleTypes: string[];
  tolerance: number;
  attachmentType?: string;
  dimensions?: Record<string, number>;
}

export interface Dependency {
  id: string;
  fromComponentId: string;
  toComponentId: string;
  kind: "structural" | "attachment" | "aesthetic" | "supports" | "contains" | "derived-from";
  description: string;
}

export interface ComponentDna {
  purpose: string;
  style: string;
  material: string;
  geometry: Record<string, string | number>;
  constraints: string[];
  connections: string[];
  rationale: string;
}

export interface ComponentVersion {
  id: string;
  componentId: string;
  versionNumber: number;
  label: string;
  generationPrompt: string;
  geometryPath: string | null;
  thumbnailUrl: string | null;
  parameters: Parameter[];
  connectionPoints: ConnectionPoint[];
  createdAt: string;
  sourceEditRequestId: string | null;
  providerTaskId: string | null;
  notes: string;
  cadSource?: CadSource | null;
  parentVersionId?: string | null;
  branchName?: string;
  dna?: ComponentDna;
  stage?: DetailStage;
}

export interface Component {
  id: string;
  name: string;
  role: ComponentRole;
  locked: boolean;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  splitFromId: string | null;
  mergedFromIds: string[];
  description?: string;
  purpose?: string;
  style?: string;
  materials?: string[];
  parentId?: string | null;
  derivedFromId?: string | null;
  libraryStatus?: "none" | "saved";
  rationale?: string;
  dna?: ComponentDna;
}

export interface AssemblyComponent {
  id: string;
  assemblyId: string;
  componentId: string;
  versionId: string;
  label: string;
  instanceIndex: number;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  detached: boolean;
}

export interface Assembly {
  id: string;
  name: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  status: PipelineStatus;
  error: string | null;
  activeBranchId?: string | null;
  activeIterationId?: string | null;
}

export interface DesignIteration {
  id: string;
  assemblyId: string;
  name: string;
  note: string;
  parentIterationId: string | null;
  createdAt: string;
  stage: DetailStage;
  pins: Array<{ instanceId: string; componentId: string; versionId: string; name: string; versionLabel: string }>;
}

export interface DesignBranch {
  id: string;
  assemblyId: string;
  name: string;
  parentBranchId: string | null;
  createdAt: string;
  pins: Array<{ instanceId: string; componentId: string; versionId: string }>;
}

export interface ImpactReport {
  request: string;
  direct: Array<{ id: string; name: string }>;
  potential: Array<{ id: string; name: string; reason: string }>;
  unchanged: Array<{ id: string; name: string }>;
  locked: Array<{ id: string; name: string }>;
  plannedVersions: Array<{ componentId: string; name: string; fromLabel: string; toLabel: string }>;
  approximatePreservationPercent: number;
  explanation: string;
}

export interface SemanticDiffEntry {
  componentId: string;
  name: string;
  changes: string[];
}

export interface SemanticDiff {
  fromLabel: string;
  toLabel: string;
  modified: SemanticDiffEntry[];
  unchanged: Array<{ componentId: string; name: string }>;
  added: string[];
  removed: string[];
}

export type CompatibilityStatus = "pass" | "warn" | "fail";

export interface CompatibilityCheck {
  name: string;
  status: CompatibilityStatus;
  detail: string;
}

export interface CompatibilityResult {
  compatible: boolean;
  checks: CompatibilityCheck[];
  suggestions: string[];
}

export interface ChangeSet {
  id: string;
  assemblyId: string;
  prompt: string;
  createdAt: string;
  editRequestId: string | null;
  impact: ImpactReport;
  diff: SemanticDiff;
  explanation: string;
}

export interface DesignDecision {
  id: string;
  assemblyId: string;
  request: string;
  result: string;
  affectedComponentIds: string[];
  resultingVersionIds: string[];
  createdAt: string;
}

export interface LibraryItem {
  id: string;
  name: string;
  description: string;
  componentId: string;
  savedVersionId: string;
  tags: string[];
  createdAt: string;
}

export type GenerationStepStatus = "pending" | "running" | "done" | "failed";

export interface GenerationStep {
  name: string;
  quantity: number;
  status: GenerationStepStatus;
}

export interface GenerationTask {
  id: string;
  provider: string;
  providerTaskId: string | null;
  status: PipelineStatus;
  progress: number;
  error: string | null;
  componentId: string | null;
  assemblyId: string | null;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  currentPartName: string | null;
  currentPartIndex: number;
  totalParts: number;
  partProgress: number;
  message: string;
  steps: GenerationStep[];
}

export interface EditRequest {
  id: string;
  componentId: string;
  assemblyId: string;
  instanceId: string | null;
  prompt: string;
  status: "pending" | "clarifying" | "running" | "complete" | "failed" | "blocked_locked";
  createdNewVersionId: string | null;
  parameterOnly: boolean;
  createdAt: string;
  error: string | null;
  clarification: string | null;
}

export interface PlannedComponent {
  name: string;
  role: ComponentRole;
  quantity: number;
  generation_prompt: string;
  parameters?: Array<{
    key: string;
    value: number | string;
    unit?: string;
    affectsGeometry: boolean;
  }>;
  layout?: {
    arrangement: "single" | "corners" | "grid" | "linear";
  };
  purpose?: string;
  style?: string;
  material?: string;
  constraints?: string[];
}

export interface ComponentPlan {
  object_name: string;
  summary: string;
  components: PlannedComponent[];
  dependencies: Array<{
    from: string;
    to: string;
    kind: Dependency["kind"];
    description: string;
  }>;
  clarifications: string[];
}

export interface DatabaseState {
  components: Component[];
  componentVersions: ComponentVersion[];
  assemblies: Assembly[];
  assemblyComponents: AssemblyComponent[];
  connectionPoints: ConnectionPoint[];
  parameters: Parameter[];
  dependencies: Dependency[];
  libraryItems: LibraryItem[];
  generationTasks: GenerationTask[];
  editRequests: EditRequest[];
  designBranches: DesignBranch[];
  designIterations: DesignIteration[];
  changeSets: ChangeSet[];
  designDecisions: DesignDecision[];
  markers: SceneMarker[];
}

export function identity<T extends { id: string }>(id: string, items: T[]): T | undefined {
  return items.find((item) => item.id === id);
}

export const origin: Vec3 = { x: 0, y: 0, z: 0 };
export const unitScale: Vec3 = { x: 1, y: 1, z: 1 };

export interface SceneMarker {
  id: string;
  assemblyId: string;
  name: string;
  position: Vec3;
  createdAt: string;
}
