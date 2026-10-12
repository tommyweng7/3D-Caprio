export interface SelectedRef {
  instanceId: string;
  componentId: string;
}

export interface SemanticGraphNode {
  componentId: string;
  name: string;
  role: string;
  locked: boolean;
  instances: number;
  currentVersion: string | null;
  lineage: string;
  purpose: string;
  style: string;
  dependents: string[];
  dependencies: Array<{ to: string; kind: string; description: string }>;
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

export interface SemanticDiff {
  fromLabel: string;
  toLabel: string;
  modified: Array<{ componentId: string; name: string; changes: string[] }>;
  unchanged: Array<{ componentId: string; name: string }>;
  added: string[];
  removed: string[];
}

export interface CompatibilityResult {
  compatible: boolean;
  checks: Array<{ name: string; status: "pass" | "warn" | "fail"; detail: string }>;
  suggestions: string[];
}

export interface AssemblyBundle {
  assembly: {
    id: string;
    name: string;
    prompt: string;
    status: string;
    error: string | null;
    activeBranchId?: string | null;
    activeIterationId?: string | null;
  };
  instances: Array<{
    id: string;
    assemblyId: string;
    componentId: string;
    versionId: string;
    label: string;
    instanceIndex: number;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    detached: boolean;
  }>;
  components: Array<{
    id: string;
    name: string;
    role: string;
    locked: boolean;
    currentVersionId: string | null;
    purpose?: string;
    style?: string;
    materials?: string[];
    libraryStatus?: string;
    dna?: {
      purpose: string;
      style: string;
      material: string;
      geometry: Record<string, string | number>;
      constraints: string[];
      connections: string[];
      rationale: string;
    };
  }>;
  versions: Array<{
    id: string;
    componentId: string;
    versionNumber: number;
    label: string;
    generationPrompt: string;
    geometryPath: string | null;
    parameters: Array<{ id: string; key: string; value: string | number; unit?: string }>;
    notes: string;
    createdAt: string;
    parentVersionId?: string | null;
    stage?: "blockout" | "form" | "detail";
    dna?: {
      purpose: string;
      style: string;
      material: string;
      geometry: Record<string, string | number>;
      constraints: string[];
      connections: string[];
    };
    cadSource?: { provider: string; format: "kcl"; files: Record<string, string> } | null;
  }>;
  dependencies: Array<{
    id: string;
    fromComponentId: string;
    toComponentId: string;
    kind: string;
    description: string;
  }>;
  branches?: Array<{
    id: string;
    name: string;
    parentBranchId: string | null;
  }>;
  iterations?: Array<{
    id: string;
    name: string;
    note: string;
    parentIterationId: string | null;
    stage: "blockout" | "form" | "detail";
    pins: Array<{ instanceId: string; componentId: string; versionId: string; name: string; versionLabel: string }>;
  }>;
  changeSets?: Array<{
    id: string;
    prompt: string;
    createdAt: string;
    explanation: string;
    impact: ImpactReport;
    diff: SemanticDiff;
  }>;
  decisions?: Array<{
    id: string;
    request: string;
    result: string;
    createdAt: string;
  }>;
  graph?: SemanticGraphNode[];
  markers?: Array<{
    id: string;
    assemblyId: string;
    name: string;
    position: { x: number; y: number; z: number };
    createdAt: string;
  }>;
}

export interface GenerationJob {
  id: string;
  status: string;
  progress: number;
  error: string | null;
  assemblyId: string | null;
  currentPartName: string | null;
  currentPartIndex: number;
  totalParts: number;
  partProgress: number;
  message: string;
  steps: Array<{ name: string; quantity: number; status: string }>;
}

export interface LibraryEntry {
  id: string;
  name: string;
  description: string;
  componentId: string;
  savedVersionId: string;
  tags: string[];
  version?: { label: string; geometryPath: string | null };
  usedIn?: string[];
}
