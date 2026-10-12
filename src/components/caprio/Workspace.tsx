"use client";

import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import { ComponentTree } from "@/components/caprio/ComponentTree";
import { HistoryTree } from "@/components/caprio/HistoryTree";
import { Inspector } from "@/components/caprio/Inspector";
import { JobProgress } from "@/components/caprio/JobProgress";
import type { AssemblyBundle, CompatibilityResult, GenerationJob, ImpactReport, LibraryEntry, SelectedRef } from "@/caprio/client/types";

const AssemblyViewer = dynamic(
  () => import("@/components/caprio/AssemblyViewer").then((m) => m.AssemblyViewer),
  { ssr: false },
);

type PlanResponse =
  | {
      type: "plan";
      plan: {
        object_name: string;
        summary: string;
        components: Array<{ name: string; quantity: number; generation_prompt: string; role: string }>;
      };
    }
  | { type: "clarification"; questions: string[] };

const DEFAULT_PROMPT =
  "Create a modern wooden chair with a curved back, padded seat, and four tapered legs.";

export function Workspace() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [broadPrompt, setBroadPrompt] = useState("Make the whole chair more Art Deco.");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [bundle, setBundle] = useState<AssemblyBundle | null>(null);
  const [selected, setSelected] = useState<SelectedRef[]>([]);
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [honesty, setHonesty] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImpactReport | null>(null);
  const [compatibility, setCompatibility] = useState<CompatibilityResult | null>(null);
  const [onlyThisInstance, setOnlyThisInstance] = useState(false);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [editLabel, setEditLabel] = useState<string | null>(null);

  const refreshLibrary = useCallback(async () => {
    const res = await fetch("/api/caprio/library");
    const data = await res.json();
    setLibrary(data.items || []);
  }, []);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    const text = await res.text();
    let data: { error?: string; code?: string } = {};
    try {
      data = text ? (JSON.parse(text) as { error?: string; code?: string }) : {};
    } catch {
      throw new Error(res.ok ? "Server returned a non-JSON response" : `Request failed (${res.status})`);
    }
    if (!res.ok) {
      throw new Error(data.error || data.code || `Request failed (${res.status})`);
    }
    return data as T;
  }

  useEffect(() => {
    if (!busy) {
      setElapsedSec(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (!activeTaskId) return;
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch("/api/caprio/generate/" + activeTaskId);
        const data = (await res.json()) as { task?: GenerationJob; error?: string };
        if (cancelled) return;
        if (!res.ok || !data.task) {
          throw new Error(data.error || "Could not read generation progress");
        }
        setJob(data.task);
        setStatus(data.task.status);
        if (data.task.assemblyId) {
          const assemblyRes = await fetch("/api/caprio/assemblies/" + data.task.assemblyId);
          if (assemblyRes.ok) {
            const assembly = (await assemblyRes.json()) as AssemblyBundle;
            if (cancelled) return;
            setBundle(assembly);
            setSelected((current) => {
              if (current.length) return current;
              const first = assembly.instances?.[0];
              return first ? [{ instanceId: first.id, componentId: first.componentId }] : current;
            });
          }
        }
        if (data.task.status === "complete" || data.task.status === "failed") {
          setBusy(false);
          setActiveTaskId(null);
          if (data.task.status === "failed") {
            setError(data.task.error || data.task.message || "Generation failed");
          }
        }
      } catch {
        if (cancelled) return;
      }
    }

    void tick();
    const timer = window.setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeTaskId]);

  async function runPlan() {
    setBusy(true);
    setError(null);
    setHonesty(null);
    setStatus("planning");
    setJob(null);
    setEditLabel(null);
    try {
      const result = await api<PlanResponse>("/api/caprio/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      setPlan(result);
      setStatus(result.type === "clarification" ? "idle" : "idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Planning failed");
      setStatus("failed");
    } finally {
      setBusy(false);
    }
  }

  async function runGenerate() {
    if (!plan || plan.type !== "plan") return;
    setBusy(true);
    setError(null);
    setEditLabel(null);
    setStatus("generating");
    setJob({
      id: "",
      status: "generating",
      progress: 0,
      error: null,
      assemblyId: null,
      currentPartName: null,
      currentPartIndex: 0,
      totalParts: plan.plan.components.length,
      partProgress: 0,
      message: `Starting ${plan.plan.components.length} Meshy jobs`,
      steps: plan.plan.components.map((c) => ({
        name: c.name,
        quantity: c.quantity,
        status: "pending",
      })),
    });
    try {
      const data = await api<{ assembly: AssemblyBundle; task: GenerationJob; taskId: string }>("/api/caprio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, plan: plan.plan }),
      });
      setBundle(data.assembly);
      setJob(data.task);
      setActiveTaskId(data.task?.id || data.taskId);
      setStatus(data.task.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setStatus("failed");
      setBusy(false);
    }
  }

  function applySelection(ref: SelectedRef | null, additive = false, group?: SelectedRef[]) {
    if (!ref?.instanceId) {
      if (!additive) setSelected([]);
      return;
    }
    if (group?.length) {
      if (additive) {
        setSelected((prev) => {
          const ids = new Set(prev.map((item) => item.instanceId));
          const extra = group.filter((item) => !ids.has(item.instanceId));
          if (extra.length) return [...prev, ...extra];
          return prev.filter((item) => !group.some((g) => g.instanceId === item.instanceId));
        });
      } else {
        setSelected(group);
      }
      return;
    }
    if (additive) {
      setSelected((prev) =>
        prev.some((item) => item.instanceId === ref.instanceId)
          ? prev.filter((item) => item.instanceId !== ref.instanceId)
          : [...prev, ref],
      );
    } else {
      setSelected([ref]);
    }
  }

  async function onPreview(editPrompt: string) {
    if (!bundle) return;
    const primary = selected[0];
    setError(null);
    const data = await api<{ impact: ImpactReport }>("/api/caprio/assemblies/" + bundle.assembly.id + "/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: editPrompt,
        componentId: primary?.componentId,
        instanceId: primary?.instanceId,
      }),
    });
    setPreview(data.impact);
  }

  async function onPlaceMarker(pointCm: { x: number; y: number; z: number }, name?: string) {
    if (!bundle) return;
    setError(null);
    try {
      const next = await api<AssemblyBundle>("/api/caprio/assemblies/" + bundle.assembly.id + "/markers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...pointCm, name, unit: "cm" }),
      });
      setBundle(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save pin");
    }
  }

  async function onRenameMarker(markerId: string, name: string) {
    if (!bundle) return;
    setError(null);
    try {
      const next = await api<AssemblyBundle>("/api/caprio/assemblies/" + bundle.assembly.id + "/markers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markerId, name }),
      });
      setBundle(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename pin");
    }
  }

  async function onDeleteMarker(markerId: string) {
    if (!bundle) return;
    setError(null);
    try {
      const next = await api<AssemblyBundle>(
        "/api/caprio/assemblies/" + bundle.assembly.id + "/markers?markerId=" + encodeURIComponent(markerId),
        { method: "DELETE" },
      );
      setBundle(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete pin");
    }
  }

  async function onNudge(deltaCm: { x: number; y: number; z: number }) {
    if (!bundle || !selected.length) return;
    const instanceIds = (onlyThisInstance ? selected.slice(0, 1) : selected).map((item) => item.instanceId);
    setError(null);
    try {
      const next = await api<AssemblyBundle>("/api/caprio/assemblies/" + bundle.assembly.id + "/nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceIds, ...deltaCm, unit: "cm" }),
      });
      setBundle(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move the part");
    }
  }

  async function onEdit(editPrompt: string, stage?: "blockout" | "form" | "detail") {
    const targets = [...new Map((selected || []).map((item) => [item.componentId, item])).values()];
    if (!targets.length || !bundle) return;
    setBusy(true);
    setError(null);
    setStatus("generating");
    setJob(null);
    const names = targets
      .map((target) => bundle.components.find((c) => c.id === target.componentId)?.name)
      .filter(Boolean);
    setEditLabel(names.join(", ") || "selected part");
    try {
      let nextBundle = bundle;
      let lastComponentId = targets[0].componentId;
      for (const target of targets) {
        const data = await api<{ assembly: AssemblyBundle; result: { componentId: string } }>(
          "/api/caprio/components/" + target.componentId + "/edit",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: editPrompt,
              assemblyId: bundle.assembly.id,
              instanceId: target.instanceId,
              applyTo: onlyThisInstance && targets.length === 1 ? "instance" : "definition",
              stage,
            }),
          },
        );
        nextBundle = data.assembly;
        lastComponentId = data.result.componentId;
      }
      setBundle(nextBundle);
      setSelected((prev) =>
        prev.map((item) =>
          item.componentId === targets[0].componentId ? { ...item, componentId: lastComponentId } : item,
        ),
      );
      setStatus("complete");
      setPreview(nextBundle.changeSets?.at(-1)?.impact || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Edit failed");
      setStatus("failed");
    } finally {
      setBusy(false);
    }
  }

  async function onLock(locked: boolean) {
    if (!selected[0]?.componentId) return;
    const data = await api<{ component: { locked: boolean; id: string } }>(
      "/api/caprio/components/" + selected[0].componentId + "/lock",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked }),
      },
    );
    if (bundle) {
      setBundle({
        ...bundle,
        components: bundle.components.map((c) => (c.id === data.component.id ? { ...c, locked: data.component.locked } : c)),
      });
    }
  }

  async function onSwitchVersion(versionId: string) {
    if (!selected[0]?.componentId || !bundle) return;
    await api("/api/caprio/components/" + selected[0].componentId + "/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        versionId,
        assemblyId: bundle.assembly.id,
        instanceId: selected[0].instanceId,
      }),
    });
    const data = await api<AssemblyBundle>("/api/caprio/assemblies/" + bundle.assembly.id);
    setBundle(data);
  }

  async function onRestoreVersion(componentId: string, versionId: string) {
    if (!bundle) return;
    const instance = bundle.instances.find((i) => i.componentId === componentId);
    await api("/api/caprio/components/" + componentId + "/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        versionId,
        assemblyId: bundle.assembly.id,
        instanceId: instance?.id,
      }),
    });
    const data = await api<AssemblyBundle>("/api/caprio/assemblies/" + bundle.assembly.id);
    setBundle(data);
    if (instance) setSelected([{ instanceId: instance.id, componentId }]);
  }

  async function onSaveLibrary(name: string) {
    if (!selected[0]?.componentId) return;
    await api("/api/caprio/library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, componentId: selected[0].componentId }),
    });
    await refreshLibrary();
  }

  async function onSplit(splitPrompt: string) {
    if (!selected[0]?.componentId || !bundle) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ result: { honesty?: string }; assembly: AssemblyBundle }>(
        "/api/caprio/components/" + selected[0].componentId + "/split",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assemblyId: bundle.assembly.id, prompt: splitPrompt }),
        },
      );
      setHonesty(data.result.honesty || null);
      setBundle(data.assembly);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Split failed");
    } finally {
      setBusy(false);
    }
  }

  async function onMerge(otherId: string) {
    if (!selected[0]?.componentId || !bundle) return;
    setBusy(true);
    try {
      const data = await api<{ assembly: AssemblyBundle }>("/api/caprio/components/" + selected[0].componentId + "/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assemblyId: bundle.assembly.id, otherComponentId: otherId }),
      });
      setBundle(data.assembly);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setBusy(false);
    }
  }

  async function onUseLibrary(id: string) {
    if (!bundle) return;
    const data = await api<{ assembly: AssemblyBundle; compatibility?: CompatibilityResult }>(
      "/api/caprio/library/" + id + "/use",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assemblyId: bundle.assembly.id }),
      },
    );
    setBundle(data.assembly);
    setCompatibility(data.compatibility || null);
  }

  async function onCreateBranch(name: string) {
    if (!bundle) return;
    const data = await api<AssemblyBundle>("/api/caprio/assemblies/" + bundle.assembly.id + "/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setBundle(data);
  }

  async function onActivateBranch(id: string) {
    if (!bundle) return;
    const data = await api<AssemblyBundle>("/api/caprio/assemblies/" + bundle.assembly.id + "/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activateId: id }),
    });
    setBundle(data);
  }

  async function onSaveIteration(name: string) {
    if (!bundle) return;
    const data = await api<AssemblyBundle>("/api/caprio/assemblies/" + bundle.assembly.id + "/iterations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setBundle(data);
  }

  async function onActivateIteration(id: string) {
    if (!bundle) return;
    const data = await api<AssemblyBundle>("/api/caprio/assemblies/" + bundle.assembly.id + "/iterations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activateId: id }),
    });
    setBundle(data);
  }

  async function onBroadEdit() {
    if (!bundle) return;
    setBusy(true);
    setError(null);
    setStatus("generating");
    setJob(null);
    setEditLabel("unlocked parts for a broad change");
    try {
      const previewData = await api<{ impact: ImpactReport }>(
        "/api/caprio/assemblies/" + bundle.assembly.id + "/preview",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: broadPrompt }),
        },
      );
      setPreview(previewData.impact);
      const data = await api<{ assembly: AssemblyBundle; results: Array<{ skipped?: boolean; reason?: string; message?: string }> }>(
        "/api/caprio/assemblies/" + bundle.assembly.id + "/broad-edit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: broadPrompt }),
        },
      );
      setBundle(data.assembly);
      const skipped = data.results.filter((r) => r.skipped);
      if (skipped.length) {
        setHonesty(skipped.map((s) => s.message || "Locked component preserved.").join(" "));
      }
      setStatus("complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Broad edit failed");
      setStatus("failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">3D-Caprio</h1>
            <p className="text-xs text-zinc-500">
              The component intelligence layer. Pick a part, then Shape, Form, or Detail, then Apply.
            </p>
          </div>
          <StatusPill status={busy ? status : bundle?.assembly.status || status} />
        </div>
        <div className="flex gap-2">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy}
            onClick={runPlan}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
          >
            Plan
          </button>
          <button
            type="button"
            disabled={busy || plan?.type !== "plan"}
            onClick={runGenerate}
            className="rounded-md bg-teal-500 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-40"
          >
            Generate
          </button>
        </div>
        <JobProgress
          phase={status === "planning" ? "planning" : busy ? "generating" : "idle"}
          elapsedSec={elapsedSec}
          job={job}
          editLabel={editLabel}
        />
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_320px]">
        <aside className="overflow-y-auto border-r border-zinc-800">
          <ComponentTree bundle={bundle} selected={selected} onSelect={applySelection} />
          <HistoryTree
            bundle={bundle}
            selected={selected}
            busy={busy}
            onSelect={(ref) => applySelection(ref)}
            onRestoreVersion={(componentId, versionId) => void onRestoreVersion(componentId, versionId)}
            onSaveIteration={(name) => void onSaveIteration(name)}
            onActivateIteration={(id) => void onActivateIteration(id)}
          />
          {plan?.type === "plan" ? (
            <div className="border-t border-zinc-800 p-3 text-xs text-zinc-400">
              <div className="mb-1 font-medium text-zinc-200">Approved plan</div>
              {plan.plan.components.map((c) => (
                <div key={c.name}>
                  {c.name} ×{c.quantity}
                </div>
              ))}
            </div>
          ) : null}
        </aside>
        <main className="min-h-0 p-3">
          <ViewerGuard>
          <AssemblyViewer
            bundle={bundle}
            selected={selected || []}
            markers={bundle?.markers || []}
            onSelect={applySelection}
            onPlaceMarker={(point, name) =>
              void onPlaceMarker({ x: point.x * 100, y: point.y * 100, z: point.z * 100 }, name)
            }
            emptyLabel={
              busy
                ? status === "planning"
                  ? "Planning components…"
                  : job?.message || "Generating parts…"
                : "Generate an object to view the assembly"
            }
          />
          </ViewerGuard>
          {plan?.type === "clarification" ? (
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              <div className="font-medium">Need a bit more detail</div>
              <ul className="mt-1 list-disc pl-5">
                {plan.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {honesty ? (
            <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-400">{honesty}</div>
          ) : null}
          {error ? (
            <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
          ) : null}
          {bundle ? (
            <div className="mt-3 flex gap-2">
              <input
                value={broadPrompt}
                onChange={(e) => setBroadPrompt(e.target.value)}
                className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={busy}
                onClick={onBroadEdit}
                className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
              >
              Broad change (honors locks)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onPreview(broadPrompt)}
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
            >
              Preview
            </button>
            </div>
          ) : null}
        </main>
        <aside className="overflow-y-auto border-l border-zinc-800">
          <Inspector
            bundle={bundle}
            selected={selected}
            library={library}
            busy={busy}
            preview={preview}
            compatibility={compatibility}
            onlyThisInstance={onlyThisInstance}
            onOnlyThisInstance={setOnlyThisInstance}
            onPreview={(p) => void onPreview(p)}
            onEdit={onEdit}
            onLock={onLock}
            onSwitchVersion={onSwitchVersion}
            onSaveLibrary={onSaveLibrary}
            onSplit={onSplit}
            onMerge={onMerge}
            onUseLibrary={onUseLibrary}
            onCreateBranch={(name) => void onCreateBranch(name)}
            onActivateBranch={(id) => void onActivateBranch(id)}
            onNudge={(delta) => void onNudge(delta)}
            onPlaceMarker={(point, name) => void onPlaceMarker(point, name)}
            onRenameMarker={(id, name) => void onRenameMarker(id, name)}
            onDeleteMarker={(id) => void onDeleteMarker(id)}
          />
        </aside>
      </div>
    </div>
  );
}

class ViewerGuard extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message || "The 3D view crashed" };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-[420px] items-center justify-center rounded-xl border border-red-500/30 bg-zinc-950 p-4 text-sm text-red-200">
          The 3D view crashed while loading a mesh. Refresh, or restore the previous version in history.
        </div>
      );
    }
    return this.props.children;
  }
}

function StatusPill({ status }: { status: string }) {
  const label =
    status === "planning"
      ? "Planning"
      : status === "generating"
        ? "Generating"
        : status === "downloading"
          ? "Downloading"
          : status === "assembling"
            ? "Assembling"
            : status === "complete"
              ? "Complete"
              : status === "failed"
                ? "Failed"
                : status === "idle"
                  ? "Idle"
                  : status;
  const color =
    status === "failed"
      ? "bg-red-500/20 text-red-200"
      : status === "complete"
        ? "bg-teal-500/20 text-teal-200"
        : status === "idle"
          ? "bg-zinc-800 text-zinc-300"
          : "bg-amber-500/20 text-amber-100";
  return <span className={`rounded-full px-3 py-1 text-xs ${color}`}>{label}</span>;
}
