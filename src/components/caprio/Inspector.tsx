"use client";

import { useMemo, useState } from "react";
import type {
  AssemblyBundle,
  CompatibilityResult,
  ImpactReport,
  LibraryEntry,
  SelectedRef,
  SemanticDiff,
} from "@/caprio/client/types";
import { MATERIAL_PRESETS } from "@/caprio/threed/appearance";

type EditStage = "blockout" | "form" | "detail";

/** The usual first ask for a part: a back gets pierced, a cushion gets tufted. */
function suggestEdit(name?: string, stage?: EditStage): { prompt: string; stage: EditStage } {
  if (/back/i.test(name || "")) return { prompt: "floral cutouts", stage: "detail" };
  if (/cushion|seat/i.test(name || "")) return { prompt: "tuck and roll upholstery", stage: "detail" };
  return { prompt: "", stage: stage || "detail" };
}

export function Inspector({
  bundle,
  selected,
  library,
  busy,
  preview,
  compatibility,
  onlyThisInstance,
  onOnlyThisInstance,
  onPreview,
  onEdit,
  onLock,
  onSwitchVersion,
  onSaveLibrary,
  onSplit,
  onMerge,
  onUseLibrary,
  onCreateBranch,
  onActivateBranch,
  onNudge,
  onPlaceMarker,
  onRenameMarker,
  onDeleteMarker,
}: {
  bundle: AssemblyBundle | null;
  selected: SelectedRef[];
  library: LibraryEntry[];
  busy: boolean;
  preview: ImpactReport | null;
  compatibility: CompatibilityResult | null;
  onlyThisInstance: boolean;
  onOnlyThisInstance: (value: boolean) => void;
  onPreview: (prompt: string) => void;
  onEdit: (prompt: string, stage?: "blockout" | "form" | "detail") => void;
  onLock: (locked: boolean) => void;
  onSwitchVersion: (versionId: string) => void;
  onSaveLibrary: (name: string) => void;
  onSplit: (prompt: string) => void;
  onMerge: (otherId: string) => void;
  onUseLibrary: (id: string) => void;
  onCreateBranch: (name: string) => void;
  onActivateBranch: (id: string) => void;
  onNudge: (deltaCm: { x: number; y: number; z: number }) => void;
  onPlaceMarker: (pointCm: { x: number; y: number; z: number }, name?: string) => void;
  onRenameMarker: (id: string, name: string) => void;
  onDeleteMarker: (id: string) => void;
}) {
  const [splitPrompt, setSplitPrompt] = useState("Separate the decorative cap from the main leg.");
  const [libraryName, setLibraryName] = useState("");
  const [mergeId, setMergeId] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [materialPrompt, setMaterialPrompt] = useState("");
  const [branchName, setBranchName] = useState("Art Deco");
  const [draft, setDraft] = useState<{ key: string; prompt: string; stage: EditStage } | null>(null);
  const [nudge, setNudge] = useState({ x: "0", y: "0", z: "0" });
  const [pinCm, setPinCm] = useState({ x: "0", y: "0", z: "0" });
  const [pinName, setPinName] = useState("");

  const selectedIds = new Set((selected || []).map((item) => item.instanceId));
  const selectedInstances = bundle?.instances.filter((i) => selectedIds.has(i.id)) || [];
  const instance = selectedInstances[0];
  const selectedComponents = bundle?.components.filter((c) => selectedInstances.some((i) => i.componentId === c.id)) || [];
  const component = selectedComponents[0];
  const versions = bundle?.versions.filter((v) => v.componentId === component?.id) || [];
  const currentVersion = versions.find((v) => v.id === instance?.versionId);

  // The draft is keyed by part version, so selecting another part falls back to
  // that part's own suggestion without an effect resetting state behind the UI.
  const draftKey = `${component?.id || ""}:${currentVersion?.id || ""}`;
  const suggested = suggestEdit(component?.name, currentVersion?.stage);
  const onDraftKey = draft?.key === draftKey;
  const editPrompt = onDraftKey ? draft.prompt : suggested.prompt;
  const selectedStage = onDraftKey ? draft.stage : suggested.stage;
  const setEditPrompt = (value: string | ((prev: string) => string)) => {
    setDraft({
      key: draftKey,
      prompt: typeof value === "function" ? value(editPrompt) : value,
      stage: selectedStage,
    });
  };
  const setSelectedStage = (stage: EditStage) => setDraft({ key: draftKey, prompt: editPrompt, stage });
  const others = bundle?.components.filter((c) => c.id !== component?.id) || [];
  const instanceCount = bundle?.instances.filter((i) => i.componentId === component?.id).length || 0;
  const lastChange = bundle?.changeSets?.at(-1);
  const filteredLibrary = useMemo(
    () =>
      library.filter((item) => {
        const q = libraryQuery.toLowerCase();
        if (!q) return true;
        return (
          item.name.toLowerCase().includes(q) ||
          item.tags.join(" ").toLowerCase().includes(q) ||
          (item.description || "").toLowerCase().includes(q) ||
          (item.usedIn || []).join(" ").toLowerCase().includes(q)
        );
      }),
    [library, libraryQuery],
  );
  const dna = currentVersion?.dna || component?.dna;

  if (!component || !instance) {
    return (
      <div className="space-y-4 p-4 text-sm text-zinc-400">
        <p>Select a component in the tree or viewer.</p>
        {bundle ? (
          <PinsPanel
            bundle={bundle}
            busy={busy}
            pinCm={pinCm}
            pinName={pinName}
            onPinCm={setPinCm}
            onPinName={setPinName}
            onPlaceMarker={onPlaceMarker}
            onRenameMarker={onRenameMarker}
            onDeleteMarker={onDeleteMarker}
            onUseInPrompt={(text) => setEditPrompt(text)}
          />
        ) : null}
        {bundle ? (
          <BranchBlock
            bundle={bundle}
            busy={busy}
            branchName={branchName}
            onBranchName={setBranchName}
            onCreate={onCreateBranch}
            onActivate={onActivateBranch}
          />
        ) : null}
        {lastChange ? <DiffBlock diff={lastChange.diff} explanation={lastChange.explanation} /> : null}
        <LibraryBlock
          query={libraryQuery}
          onQuery={setLibraryQuery}
          items={filteredLibrary}
          onUse={onUseLibrary}
          disabled={!bundle || busy}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 overflow-y-auto p-4 text-sm">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-zinc-50">
            {selectedComponents.length > 1
              ? selectedComponents.map((item) => item.name).join(", ")
              : component.name}
          </h2>
          {component.locked ? (
            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-200">Locked</span>
          ) : null}
        </div>
        <p className="mt-1 font-mono text-[11px] text-zinc-500">
          {component.id}:{currentVersion?.label || "v?"}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          Instances: {instanceCount}
          {selectedInstances.length > 1 ? ` · ${selectedInstances.length} selected` : ""}
          {instance.detached ? " · this instance detached" : ""}
        </p>
        <p className="mt-2 text-zinc-400">{dna?.purpose || currentVersion?.generationPrompt}</p>
      </div>

      {dna ? (
        <section>
          <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Component DNA</h3>
          <dl className="space-y-1 text-xs text-zinc-300">
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500">Style</dt>
              <dd>{dna.style}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500">Material</dt>
              <dd>{dna.material}</dd>
            </div>
            {Object.entries(dna.geometry).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-2 font-mono">
                <dt className="text-zinc-500">{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
          {dna.constraints?.length ? (
            <ul className="mt-2 list-disc pl-4 text-[11px] text-zinc-500">
              {dna.constraints.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {currentVersion?.cadSource?.files?.["main.kcl"] ? (
        <section>
          <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Zoo CAD (KCL)</h3>
          <pre className="max-h-40 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-2 font-mono text-[10px] text-zinc-400">
            {currentVersion.cadSource.files["main.kcl"]}
          </pre>
        </section>
      ) : null}

      {bundle?.dependencies?.filter(
        (d) => d.fromComponentId === component.id || d.toComponentId === component.id,
      ).length ? (
        <section>
          <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Dependencies</h3>
          <ul className="space-y-1 text-xs text-zinc-400">
            {bundle.dependencies
              .filter((d) => d.fromComponentId === component.id || d.toComponentId === component.id)
              .map((d) => (
                <li key={d.id}>
                  {d.kind}: {d.description}
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Move (cm)</h3>
        <p className="mb-2 text-[11px] leading-4 text-zinc-500">
          Offset the selected instance{selectedInstances.length > 1 ? "s" : ""} in centimeters. Y is up. Example: Y +2 lifts legs 2cm.
        </p>
        {instance ? (
          <p className="mb-2 font-mono text-[11px] text-zinc-500">
            now {(instance.position.x * 100).toFixed(1)}, {(instance.position.y * 100).toFixed(1)},{" "}
            {(instance.position.z * 100).toFixed(1)}
            {selectedInstances.length > 1 ? ` · ${selectedInstances.length} selected` : ""}
          </p>
        ) : null}
        <div className="grid grid-cols-3 gap-1">
          {(["x", "y", "z"] as const).map((axis) => (
            <label key={axis} className="text-[11px] text-zinc-400">
              {axis.toUpperCase()}
              <input
                value={nudge[axis]}
                onChange={(e) => setNudge((prev) => ({ ...prev, [axis]: e.target.value }))}
                inputMode="decimal"
                className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-zinc-100"
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || (!Number(nudge.x) && !Number(nudge.y) && !Number(nudge.z))}
          onClick={() =>
            onNudge({
              x: Number(nudge.x) || 0,
              y: Number(nudge.y) || 0,
              z: Number(nudge.z) || 0,
            })
          }
          className="mt-2 w-full rounded-md border border-zinc-700 px-3 py-2 text-zinc-200 disabled:opacity-40"
        >
          Shift
        </button>
      </section>

      {bundle ? (
        <PinsPanel
          bundle={bundle}
          busy={busy}
          pinCm={pinCm}
          pinName={pinName}
          onPinCm={setPinCm}
          onPinName={setPinName}
          onPlaceMarker={onPlaceMarker}
          onRenameMarker={onRenameMarker}
          onDeleteMarker={onDeleteMarker}
          onUseInPrompt={(text) => setEditPrompt((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))}
        />
      ) : null}

      <section>
        <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Surgical edit</h3>
        <p className="mb-2 text-[11px] leading-4 text-zinc-500">
          Selected part only. Examples: floral cutouts, extend this face 3cm, add a serrated edge, put a hole at pin A.
        </p>
        <textarea
          value={editPrompt}
          onChange={(e) => setEditPrompt(e.target.value)}
          placeholder="Describe the change to this part…"
          className="h-20 w-full rounded-md border border-zinc-800 bg-zinc-950 p-2 text-zinc-100"
        />
        <label className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={onlyThisInstance}
            onChange={(e) => onOnlyThisInstance(e.target.checked)}
          />
          Only this instance
        </label>
        <div className="mt-2 grid grid-cols-1 gap-1.5">
          {(
            [
              ["blockout", "Shape", "Wrong object or blob. Rebuild the isolated part from scratch."],
              ["form", "Form", "Correct proportions and primary surfaces. Medium-poly, still no tiny ornament."],
              ["detail", "Detail", "Sculpt the requested feature into the mesh: tufting, cutouts, carving, handles."],
            ] as const
          ).map(([stage, label, hint]) => (
            <button
              key={stage}
              type="button"
              disabled={busy || component.locked}
              onClick={() => setSelectedStage(stage)}
              className={`rounded border px-2 py-1.5 text-left disabled:opacity-40 ${
                selectedStage === stage
                  ? "border-teal-500/50 bg-teal-500/10 text-teal-100"
                  : "border-zinc-700 text-zinc-300"
              }`}
            >
              <div className="text-[11px] font-medium">{label}</div>
              <div className="mt-0.5 text-[10px] leading-4 text-zinc-500">{hint}</div>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] leading-4 text-zinc-500">
          These only pick the pass. Type the change above, then Apply.
        </p>
        <div className="mt-2 flex gap-1">
          <input
            value={materialPrompt}
            onChange={(e) => setMaterialPrompt(e.target.value)}
            placeholder="worn brown leather, brushed brass, cream velvet…"
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
          />
          <button
            type="button"
            disabled={busy || component.locked || !materialPrompt.trim()}
            onClick={() => onEdit(`Change the material to ${materialPrompt.trim()}.`)}
            className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 disabled:opacity-40"
          >
            Finish
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {Object.entries(MATERIAL_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              disabled={busy || component.locked}
              onClick={() => onEdit(`Change the material to ${preset.label}.`)}
              className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 disabled:opacity-40"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={busy || component.locked}
            onClick={() => onPreview(editPrompt)}
            className="flex-1 rounded-md border border-zinc-700 px-3 py-2 text-zinc-200 disabled:opacity-40"
          >
            Preview
          </button>
          <button
            type="button"
            disabled={busy || component.locked}
            onClick={() =>
              onEdit(
                editPrompt.trim() ||
                  (selectedStage === "blockout"
                    ? "Rebuild as a clay blockout. Raw silhouette only."
                    : selectedStage === "form"
                      ? "Rebuild with correct proportions and medium-poly surfaces."
                      : "Sculpt high-detail surface features on this isolated part. Tufting, channels, cutouts, or carving must be clearly visible in the mesh."),
                selectedStage,
              )
            }
            className="flex-1 rounded-md bg-teal-500 px-3 py-2 font-medium text-zinc-950 disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      </section>

      {preview ? <ImpactBlock impact={preview} /> : null}

      <section>
        <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Versions of this component</h3>
        <ul className="space-y-1">
          {versions.map((version) => (
            <li key={version.id}>
              <button
                type="button"
                disabled={busy || component.locked}
                onClick={() => onSwitchVersion(version.id)}
                className={`flex w-full items-center justify-between rounded px-2 py-1 text-left ${
                  version.id === instance.versionId ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:bg-zinc-900"
                }`}
              >
                <span>
                  {version.label}
                  {version.id === instance.versionId ? " ← active" : ""}
                </span>
                <span className="text-[10px]">{version.notes}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onLock(!component.locked)}
          className="flex-1 rounded-md border border-zinc-700 px-3 py-2 text-zinc-200"
        >
          {component.locked ? "Unlock" : "Lock"}
        </button>
      </section>

      <BranchBlock
        bundle={bundle!}
        busy={busy}
        branchName={branchName}
        onBranchName={setBranchName}
        onCreate={onCreateBranch}
        onActivate={onActivateBranch}
      />

      {lastChange ? <DiffBlock diff={lastChange.diff} explanation={lastChange.explanation} /> : null}

      <section>
        <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Save to library</h3>
        <input
          value={libraryName}
          onChange={(e) => setLibraryName(e.target.value)}
          placeholder="Tapered Wooden Leg"
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 p-2"
        />
        <button
          type="button"
          disabled={busy || !libraryName.trim()}
          onClick={() => onSaveLibrary(libraryName.trim())}
          className="mt-2 w-full rounded-md border border-teal-500/40 px-3 py-2 text-teal-200"
        >
          Save current version
        </button>
      </section>

      <section>
        <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Split</h3>
        <textarea
          value={splitPrompt}
          onChange={(e) => setSplitPrompt(e.target.value)}
          className="h-16 w-full rounded-md border border-zinc-800 bg-zinc-950 p-2"
        />
        <button
          type="button"
          disabled={busy || component.locked}
          onClick={() => onSplit(splitPrompt)}
          className="mt-2 w-full rounded-md border border-zinc-700 px-3 py-2"
        >
          Propose / perform split
        </button>
      </section>

      <section>
        <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Merge with</h3>
        <select
          value={mergeId}
          onChange={(e) => setMergeId(e.target.value)}
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 p-2"
        >
          <option value="">Select component</option>
          {others.map((other) => (
            <option key={other.id} value={other.id}>
              {other.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !mergeId || component.locked}
          onClick={() => onMerge(mergeId)}
          className="mt-2 w-full rounded-md border border-zinc-700 px-3 py-2"
        >
          Merge
        </button>
      </section>

      {compatibility ? <CompatibilityBlock result={compatibility} /> : null}

      <LibraryBlock
        query={libraryQuery}
        onQuery={setLibraryQuery}
        items={filteredLibrary}
        onUse={onUseLibrary}
        disabled={!bundle || busy}
      />
    </div>
  );
}

function ImpactBlock({ impact }: { impact: ImpactReport }) {
  return (
    <section className="rounded-md border border-zinc-800 bg-zinc-900 p-3 text-xs">
      <h3 className="mb-2 uppercase tracking-wide text-zinc-500">Change preview</h3>
      <p className="mb-2 text-zinc-300">{impact.explanation}</p>
      <p className="mb-2 text-zinc-500">
        Preservation (approximate): {impact.approximatePreservationPercent}%
      </p>
      <List label="Will change" items={impact.direct.map((c) => c.name)} mark="✓" />
      <List label="May affect" items={impact.potential.map((c) => `${c.name} (${c.reason})`)} mark="△" />
      <List label="Preserved" items={impact.unchanged.map((c) => c.name)} mark="○" />
      <List label="Locked" items={impact.locked.map((c) => `${c.name} 🔒`)} mark="🔒" />
      {impact.plannedVersions.map((v) => (
        <div key={v.componentId} className="text-zinc-400">
          New: {v.name} {v.fromLabel} → {v.toLabel}
        </div>
      ))}
    </section>
  );
}

function DiffBlock({ diff, explanation }: { diff: SemanticDiff; explanation: string }) {
  return (
    <section className="rounded-md border border-zinc-800 p-3 text-xs text-zinc-300">
      <h3 className="mb-2 uppercase tracking-wide text-zinc-500">Semantic diff</h3>
      <p className="mb-2 text-zinc-400">{explanation}</p>
      {diff.modified.map((item) => (
        <div key={item.componentId} className="mb-1">
          ✓ {item.name}
          <ul className="pl-4 text-zinc-500">
            {item.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </div>
      ))}
      {diff.unchanged.map((item) => (
        <div key={item.componentId} className="text-zinc-500">
          ○ {item.name}
        </div>
      ))}
      {diff.added.map((name) => (
        <div key={name} className="text-teal-300">
          + {name}
        </div>
      ))}
    </section>
  );
}

function CompatibilityBlock({ result }: { result: CompatibilityResult }) {
  return (
    <section className="rounded-md border border-zinc-800 p-3 text-xs">
      <h3 className="mb-2 uppercase tracking-wide text-zinc-500">
        Compatibility {result.compatible ? "· compatible" : "· incompatible"}
      </h3>
      {result.checks.map((check) => (
        <div key={check.name} className="text-zinc-400">
          {check.status === "pass" ? "✓" : check.status === "warn" ? "△" : "✗"} {check.name}
          <div className="pl-4 text-zinc-600">{check.detail}</div>
        </div>
      ))}
      {result.suggestions.length ? (
        <ul className="mt-2 list-disc pl-4 text-zinc-500">
          {result.suggestions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function PinsPanel({
  bundle,
  busy,
  pinCm,
  pinName,
  onPinCm,
  onPinName,
  onPlaceMarker,
  onRenameMarker,
  onDeleteMarker,
  onUseInPrompt,
}: {
  bundle: AssemblyBundle;
  busy: boolean;
  pinCm: { x: string; y: string; z: string };
  pinName: string;
  onPinCm: (value: { x: string; y: string; z: string }) => void;
  onPinName: (value: string) => void;
  onPlaceMarker: (pointCm: { x: number; y: number; z: number }, name?: string) => void;
  onRenameMarker: (id: string, name: string) => void;
  onDeleteMarker: (id: string) => void;
  onUseInPrompt: (text: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const markers = bundle.markers || [];

  function commitName(id: string, current: string) {
    const next = (drafts[id] ?? current).trim();
    if (!next || next === current) return;
    onRenameMarker(id, next);
  }

  return (
    <section>
      <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Pins</h3>
      <p className="mb-2 text-[11px] leading-4 text-zinc-500">
        Name a landmark, then drop it. Rename or delete anytime. Example: “put a hole at pin handle”.
      </p>
      <label className="block text-[11px] text-zinc-400">
        Name
        <input
          value={pinName}
          onChange={(e) => onPinName(e.target.value)}
          placeholder="handle, left tuft, pin A…"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100"
        />
      </label>
      <div className="mt-1 grid grid-cols-3 gap-1">
        {(["x", "y", "z"] as const).map((axis) => (
          <label key={axis} className="text-[11px] text-zinc-400">
            {axis.toUpperCase()}
            <input
              value={pinCm[axis]}
              onChange={(e) => onPinCm({ ...pinCm, [axis]: e.target.value })}
              inputMode="decimal"
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-zinc-100"
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          onPlaceMarker(
            {
              x: Number(pinCm.x) || 0,
              y: Number(pinCm.y) || 0,
              z: Number(pinCm.z) || 0,
            },
            pinName.trim() || undefined,
          );
          onPinName("");
        }}
        className="mt-2 w-full rounded-md border border-zinc-700 px-3 py-2 text-zinc-200 disabled:opacity-40"
      >
        Save pin
      </button>
      <ul className="mt-2 space-y-2">
        {markers.map((marker) => (
          <li key={marker.id} className="rounded border border-zinc-800 p-2">
            <div className="flex items-center gap-1">
              <input
                value={drafts[marker.id] ?? marker.name}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [marker.id]: e.target.value }))}
                onBlur={() => commitName(marker.id, marker.name)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                disabled={busy}
                aria-label={`Rename pin ${marker.name}`}
                className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-pink-100"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => onDeleteMarker(marker.id)}
                className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 disabled:opacity-40"
              >
                Delete
              </button>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[10px] text-zinc-500">
              <span>
                {(marker.position.x * 100).toFixed(1)}, {(marker.position.y * 100).toFixed(1)},{" "}
                {(marker.position.z * 100).toFixed(1)} cm
              </span>
              <button
                type="button"
                className="text-pink-200 hover:text-pink-100"
                onClick={() =>
                  onUseInPrompt(
                    `at pin ${drafts[marker.id] ?? marker.name} (${(marker.position.x * 100).toFixed(1)}, ${(marker.position.y * 100).toFixed(1)}, ${(marker.position.z * 100).toFixed(1)} cm)`,
                  )
                }
              >
                Use
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BranchBlock({
  bundle,
  busy,
  branchName,
  onBranchName,
  onCreate,
  onActivate,
}: {
  bundle: AssemblyBundle;
  busy: boolean;
  branchName: string;
  onBranchName: (v: string) => void;
  onCreate: (name: string) => void;
  onActivate: (id: string) => void;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Design branches</h3>
      <p className="mb-2 text-[11px] leading-relaxed text-zinc-500">
        A branch is a named pin-set of every part version in this assembly. Create one before a risky experiment
        (for example Art Deco legs). Switching branches restores those pins; it does not delete the other branch.
        Iterations below the tree are named snapshots of the same idea.
      </p>
      <ul className="mb-2 space-y-1">
        {(bundle.branches || []).map((branch) => (
          <li key={branch.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onActivate(branch.id)}
              className={`w-full rounded px-2 py-1 text-left text-xs ${
                branch.id === bundle.assembly.activeBranchId ? "bg-zinc-800 text-zinc-50" : "text-zinc-400"
              }`}
            >
              {branch.name}
              {branch.id === bundle.assembly.activeBranchId ? " ← active" : ""}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          value={branchName}
          onChange={(e) => onBranchName(e.target.value)}
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 p-2 text-xs"
        />
        <button
          type="button"
          disabled={busy || !branchName.trim()}
          onClick={() => onCreate(branchName.trim())}
          className="rounded-md border border-zinc-700 px-2 py-1 text-xs"
        >
          Branch
        </button>
      </div>
    </section>
  );
}

function List({ label, items, mark }: { label: string; items: string[]; mark: string }) {
  if (!items.length) return null;
  return (
    <div className="mb-1">
      <div className="text-zinc-500">{label}</div>
      {items.map((item) => (
        <div key={item}>
          {mark} {item}
        </div>
      ))}
    </div>
  );
}

function LibraryBlock({
  query,
  onQuery,
  items,
  onUse,
  disabled,
}: {
  query: string;
  onQuery: (v: string) => void;
  items: LibraryEntry[];
  onUse: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Component library</h3>
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="wooden, Art Deco, 450mm…"
        className="mb-2 w-full rounded-md border border-zinc-800 bg-zinc-950 p-2"
      />
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2 rounded border border-zinc-800 px-2 py-1">
            <div>
              <div className="text-zinc-200">{item.name}</div>
              <div className="text-[11px] text-zinc-500">
                {item.version?.label} · {item.tags.join(", ")}
                {item.usedIn?.length ? ` · used in ${item.usedIn.join(", ")}` : ""}
              </div>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onUse(item.id)}
              className="text-xs text-teal-300"
            >
              Insert
            </button>
          </li>
        ))}
        {!items.length ? <li className="text-zinc-600">Library is empty.</li> : null}
      </ul>
    </section>
  );
}
