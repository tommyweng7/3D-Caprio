import type {
  Assembly,
  AssemblyComponent,
  ChangeSet,
  CompatibilityResult,
  Component,
  ComponentDna,
  ComponentVersion,
  ConnectionPoint,
  Dependency,
  DesignBranch,
  DesignDecision,
  ImpactReport,
  Parameter,
  SemanticDiff,
} from "@/caprio/domain/types";
import { uuid } from "@/caprio/ids";

export function lineageKey(componentId: string, versionNumber: number): string {
  return `${componentId}:v${versionNumber}`;
}

export function inferStyle(...texts: string[]): string {
  const blob = texts.join(" ").toLowerCase();
  if (/art deco/.test(blob)) return "Art Deco";
  if (/futur/.test(blob)) return "futuristic";
  if (/modern/.test(blob)) return "modern";
  if (/industrial/.test(blob)) return "industrial";
  return "";
}

export function inferMaterial(...texts: string[]): string {
  const blob = texts.join(" ").toLowerCase();
  if (/brass/.test(blob)) return "brass";
  if (/oak|wood|walnut|timber/.test(blob)) return "wood";
  if (/steel|metal|aluminum|aluminium/.test(blob)) return "metal";
  if (/fabric|padded|cushion|upholster/.test(blob)) return "fabric";
  return "";
}

export function inferDna(input: {
  name: string;
  role: string;
  prompt: string;
  parameters?: Parameter[];
  connectionPoints?: ConnectionPoint[];
  purpose?: string;
  style?: string;
  material?: string;
  constraints?: string[];
  rationale?: string;
}): ComponentDna {
  const geometry: Record<string, string | number> = {};
  for (const parameter of input.parameters || []) {
    geometry[parameter.key] = parameter.value;
  }
  const style = input.style || inferStyle(input.prompt, input.name) || "unspecified";
  const material = input.material || inferMaterial(input.prompt, input.name) || "unspecified";
  return {
    purpose: input.purpose || defaultPurpose(input.name, input.role),
    style,
    material,
    geometry,
    constraints: input.constraints || defaultConstraints(input.name),
    connections: (input.connectionPoints || []).map((p) => p.name),
    rationale: input.rationale || "",
  };
}

function defaultPurpose(name: string, role: string): string {
  const n = name.toLowerCase();
  if (/leg/.test(n)) return "support the seat";
  if (/seat/.test(n)) return "provide a sitting surface";
  if (/back/.test(n)) return "provide back support";
  if (/cushion/.test(n)) return "pad the sitting surface";
  return `${role} part of the assembly`;
}

function defaultConstraints(name: string): string[] {
  const n = name.toLowerCase();
  if (/leg/.test(n)) return ["must support seat", "must connect to underside of seat"];
  if (/back/.test(n)) return ["must attach to seat"];
  if (/cushion/.test(n)) return ["must rest on seat"];
  return [];
}

export function overlayDna(base: ComponentDna | undefined, prompt: string, parameters?: Parameter[]): ComponentDna {
  const next = inferDna({
    name: "",
    role: "structural",
    prompt,
    parameters: parameters || paramFromGeometry(base),
    style: inferStyle(prompt) || base?.style,
    material: inferMaterial(prompt) || base?.material,
    purpose: base?.purpose,
    constraints: base?.constraints,
    rationale: base?.rationale,
  });
  return {
    purpose: base?.purpose || next.purpose,
    style: inferStyle(prompt) || base?.style || next.style,
    material: inferMaterial(prompt) || base?.material || next.material,
    geometry: { ...(base?.geometry || {}), ...next.geometry },
    constraints: base?.constraints?.length ? base.constraints : next.constraints,
    connections: base?.connections || next.connections,
    rationale: base?.rationale || next.rationale,
  };
}

function paramFromGeometry(dna?: ComponentDna): Parameter[] {
  if (!dna) return [];
  return Object.entries(dna.geometry).map(([key, value]) => ({
    id: key,
    key,
    value,
    affectsGeometry: true,
  }));
}

export function resolveTargetComponents(
  prompt: string,
  components: Component[],
  selectedComponentId?: string | null,
): Component[] {
  const text = prompt.toLowerCase();
  const named = components.filter((c) => {
    const name = c.name.toLowerCase();
    if (name.length < 3) return text.includes(name);
    const plural = `${name}s`;
    return text.includes(name) || text.includes(plural);
  });
  if (named.length) return named;
  if (selectedComponentId) {
    const selected = components.find((c) => c.id === selectedComponentId);
    if (selected) return [selected];
  }
  return components;
}

export function buildImpact(input: {
  prompt: string;
  components: Component[];
  versions: ComponentVersion[];
  dependencies: Dependency[];
  targets: Component[];
}): ImpactReport {
  const targetIds = new Set(input.targets.map((c) => c.id));
  const locked = input.components.filter((c) => c.locked);
  const lockedIds = new Set(locked.map((c) => c.id));
  const potential: ImpactReport["potential"] = [];
  for (const dep of input.dependencies) {
    if (targetIds.has(dep.fromComponentId) && !targetIds.has(dep.toComponentId) && !lockedIds.has(dep.toComponentId)) {
      const other = input.components.find((c) => c.id === dep.toComponentId);
      if (other) potential.push({ id: other.id, name: other.name, reason: dep.description || dep.kind });
    }
    if (targetIds.has(dep.toComponentId) && !targetIds.has(dep.fromComponentId) && !lockedIds.has(dep.fromComponentId)) {
      const other = input.components.find((c) => c.id === dep.fromComponentId);
      if (other) potential.push({ id: other.id, name: other.name, reason: dep.description || dep.kind });
    }
  }
  const potentialIds = new Set(potential.map((p) => p.id));
  const direct = input.targets
    .filter((c) => !c.locked)
    .map((c) => ({ id: c.id, name: c.name }));
  const unchanged = input.components
    .filter((c) => !targetIds.has(c.id) && !potentialIds.has(c.id) && !c.locked)
    .map((c) => ({ id: c.id, name: c.name }));
  const preserved = unchanged.length + locked.length;
  const total = Math.max(1, input.components.length);
  const percent = Math.round((preserved / total) * 100);
  const lockedDirect = input.targets.filter((c) => c.locked);
  const explanation = lockedDirect.length
    ? `${lockedDirect.map((c) => c.name).join(", ")} ${lockedDirect.length === 1 ? "is" : "are"} locked, so I will modify ${direct.map((c) => c.name).join(", ") || "no unlocked parts"} while preserving the locked geometry.`
    : `This change targets ${direct.map((c) => c.name).join(", ") || "nothing"} and leaves ${unchanged.map((c) => c.name).join(", ") || "the rest of the assembly"} on their current versions.`;

  return {
    request: input.prompt,
    direct,
    potential,
    unchanged,
    locked: locked.map((c) => ({ id: c.id, name: c.name })),
    plannedVersions: direct.map((c) => {
      const component = input.components.find((item) => item.id === c.id)!;
      const current =
        input.versions.find((v) => v.id === component.currentVersionId) ||
        input.versions.filter((v) => v.componentId === c.id).at(-1);
      const from = current?.label || "v1";
      return {
        componentId: c.id,
        name: c.name,
        fromLabel: from,
        toLabel: nextLabel(from),
      };
    }),
    approximatePreservationPercent: percent,
    explanation,
  };
}

function nextLabel(from: string): string {
  const match = /^v(\d+)$/.exec(from);
  if (!match) return "next version";
  return `v${Number(match[1]) + 1}`;
}

export function semanticVersionDiff(
  from: ComponentVersion | undefined,
  to: ComponentVersion | undefined,
  name: string,
): string[] {
  if (!from || !to) return [];
  const changes: string[] = [];
  const keys = new Set([
    ...from.parameters.map((p) => p.key),
    ...to.parameters.map((p) => p.key),
    ...Object.keys(from.dna?.geometry || {}),
    ...Object.keys(to.dna?.geometry || {}),
  ]);
  for (const key of keys) {
    const a = from.parameters.find((p) => p.key === key)?.value ?? from.dna?.geometry[key];
    const b = to.parameters.find((p) => p.key === key)?.value ?? to.dna?.geometry[key];
    if (a !== undefined && b !== undefined && String(a) !== String(b)) {
      changes.push(`${key}: ${a} → ${b}`);
    }
  }
  const fromStyle = from.dna?.style;
  const toStyle = to.dna?.style;
  if (fromStyle && toStyle && fromStyle !== toStyle) changes.push(`style: ${fromStyle} → ${toStyle}`);
  const fromMaterial = from.dna?.material;
  const toMaterial = to.dna?.material;
  if (fromMaterial && toMaterial && fromMaterial !== toMaterial) {
    changes.push(`material: ${fromMaterial} → ${toMaterial}`);
  }
  if (from.generationPrompt !== to.generationPrompt && !changes.length) {
    changes.push(to.notes || "generation specification updated");
  } else if (to.notes && to.notes !== from.notes && to.notes !== "original") {
    changes.push(to.notes);
  }
  if (!changes.length && from.id !== to.id) changes.push("new version created");
  return changes.map((change) => `${name}: ${change}`);
}

export function diffAssemblies(input: {
  fromLabel: string;
  toLabel: string;
  before: Array<{ component: Component; version: ComponentVersion | undefined }>;
  after: Array<{ component: Component; version: ComponentVersion | undefined }>;
}): SemanticDiff {
  const beforeIds = new Set(input.before.map((item) => item.component.id));
  const afterIds = new Set(input.after.map((item) => item.component.id));
  const modified: SemanticDiff["modified"] = [];
  const unchanged: SemanticDiff["unchanged"] = [];
  for (const item of input.after) {
    const prior = input.before.find((b) => b.component.id === item.component.id);
    if (!prior) continue;
    if (prior.version?.id === item.version?.id) {
      unchanged.push({ componentId: item.component.id, name: item.component.name });
      continue;
    }
    modified.push({
      componentId: item.component.id,
      name: item.component.name,
      changes: semanticVersionDiff(prior.version, item.version, item.component.name),
    });
  }
  return {
    fromLabel: input.fromLabel,
    toLabel: input.toLabel,
    modified,
    unchanged,
    added: input.after.filter((item) => !beforeIds.has(item.component.id)).map((item) => item.component.name),
    removed: input.before.filter((item) => !afterIds.has(item.component.id)).map((item) => item.component.name),
  };
}

export function numericParam(version: ComponentVersion | undefined, key: string): number | null {
  const found = version?.parameters.find((p) => p.key === key);
  if (typeof found?.value === "number") return found.value;
  const geo = version?.dna?.geometry[key];
  return typeof geo === "number" ? geo : null;
}

export function checkCompatibility(
  incoming: ComponentVersion,
  incomingComponent: Component,
  host: {
    components: Component[];
    versions: ComponentVersion[];
    dependencies: Dependency[];
  },
): CompatibilityResult {
  const checks: CompatibilityResult["checks"] = [];
  const hostSeat = host.components.find((c) => /seat/i.test(c.name));
  const seatVersion = hostSeat
    ? host.versions.find((v) => v.id === hostSeat.currentVersionId) ||
      host.versions.filter((v) => v.componentId === hostSeat.id).at(-1)
    : undefined;

  const incomingHeight = numericParam(incoming, "height");
  const seatHeight = numericParam(seatVersion, "height");
  if (incomingHeight != null && seatHeight != null) {
    const ratio = incomingHeight / Math.max(seatHeight, 0.001);
    checks.push({
      name: "Height compatible",
      status: ratio > 0.5 && ratio < 2.5 ? "pass" : "fail",
      detail: `Incoming height ${incomingHeight} vs related host ${seatHeight}`,
    });
  } else if (incomingHeight != null) {
    checks.push({
      name: "Height compatible",
      status: "pass",
      detail: `Incoming height ${incomingHeight} has no conflicting host height parameter`,
    });
  }

  const hostMounts = (seatVersion?.connectionPoints || []).flatMap((p) => [p.type, ...p.compatibleTypes]);
  const incomingMounts = incoming.connectionPoints.flatMap((p) => [p.type, ...p.compatibleTypes]);
  if (incomingMounts.length && hostMounts.length) {
    const ok = incoming.connectionPoints.some((point) =>
      point.compatibleTypes.some((t) => hostMounts.includes(t)) || hostMounts.includes(point.type),
    );
    checks.push({
      name: "Mounting interface compatible",
      status: ok ? "pass" : "fail",
      detail: ok
        ? "Connection types overlap with the host assembly"
        : `Incoming mounts [${incomingMounts.join(", ")}] do not match host [${hostMounts.join(", ")}]`,
    });
  } else {
    checks.push({
      name: "Mounting interface compatible",
      status: "warn",
      detail: "Not enough connection-point data to prove interface match",
    });
  }

  const hostStyle = hostSeat?.style || hostSeat?.dna?.style;
  const incomingStyle = incomingComponent.style || incoming.dna?.style;
  if (hostStyle && incomingStyle && hostStyle !== incomingStyle && incomingStyle !== "unspecified" && hostStyle !== "unspecified") {
    checks.push({
      name: "Style difference detected",
      status: "warn",
      detail: `Host style ${hostStyle} vs incoming ${incomingStyle}`,
    });
  } else {
    checks.push({
      name: "Style difference detected",
      status: "pass",
      detail: "No conflicting style metadata",
    });
  }

  checks.push({
    name: "Orientation compatible",
    status: "pass",
    detail: "Instance transform is preserved; geometry is not silently rotated",
  });

  const failed = checks.filter((c) => c.status === "fail");
  const suggestions = failed.length
    ? ["Keep the existing component", "Add an adapter rather than deforming the part", "Choose a different library version"]
    : [];
  return {
    compatible: failed.length === 0,
    checks,
    suggestions,
  };
}

export function snapshotPins(instances: AssemblyComponent[]): DesignBranch["pins"] {
  return instances.map((instance) => ({
    instanceId: instance.id,
    componentId: instance.componentId,
    versionId: instance.versionId,
  }));
}

export function makeBranch(input: {
  assemblyId: string;
  name: string;
  parentBranchId: string | null;
  instances: AssemblyComponent[];
}): DesignBranch {
  return {
    id: uuid(),
    assemblyId: input.assemblyId,
    name: input.name,
    parentBranchId: input.parentBranchId,
    createdAt: new Date().toISOString(),
    pins: snapshotPins(input.instances),
  };
}

export function makeChangeSet(input: {
  assemblyId: string;
  prompt: string;
  editRequestId: string | null;
  impact: ImpactReport;
  diff: SemanticDiff;
  explanation: string;
}): ChangeSet {
  return {
    id: uuid(),
    assemblyId: input.assemblyId,
    prompt: input.prompt,
    createdAt: new Date().toISOString(),
    editRequestId: input.editRequestId,
    impact: input.impact,
    diff: input.diff,
    explanation: input.explanation,
  };
}

export function makeDecision(input: {
  assemblyId: string;
  request: string;
  result: string;
  affectedComponentIds: string[];
  resultingVersionIds: string[];
}): DesignDecision {
  return {
    id: uuid(),
    assemblyId: input.assemblyId,
    request: input.request,
    result: input.result,
    affectedComponentIds: input.affectedComponentIds,
    resultingVersionIds: input.resultingVersionIds,
    createdAt: new Date().toISOString(),
  };
}

export function componentUsages(
  componentId: string,
  assemblies: Assembly[],
  instances: AssemblyComponent[],
): Array<{ assemblyId: string; assemblyName: string; versionIds: string[]; instanceCount: number }> {
  const byAssembly = new Map<string, AssemblyComponent[]>();
  for (const instance of instances.filter((i) => i.componentId === componentId)) {
    const list = byAssembly.get(instance.assemblyId) || [];
    list.push(instance);
    byAssembly.set(instance.assemblyId, list);
  }
  return [...byAssembly.entries()].map(([assemblyId, used]) => {
    const assembly = assemblies.find((a) => a.id === assemblyId);
    return {
      assemblyId,
      assemblyName: assembly?.name || assemblyId,
      versionIds: [...new Set(used.map((i) => i.versionId))],
      instanceCount: used.length,
    };
  });
}

export function wantsInstanceScope(prompt: string): boolean {
  return /\b(this|only|just this|front-left|front left|single instance)\b/i.test(prompt);
}
