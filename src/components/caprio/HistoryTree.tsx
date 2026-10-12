"use client";

import { useState } from "react";
import type { AssemblyBundle, SelectedRef } from "@/caprio/client/types";

export function HistoryTree({
  bundle,
  selected,
  busy,
  onSelect,
  onRestoreVersion,
  onSaveIteration,
  onActivateIteration,
}: {
  bundle: AssemblyBundle | null;
  selected: SelectedRef[];
  busy: boolean;
  onSelect: (ref: SelectedRef) => void;
  onRestoreVersion: (componentId: string, versionId: string) => void;
  onSaveIteration: (name: string) => void;
  onActivateIteration: (id: string) => void;
}) {
  const [name, setName] = useState("");

  if (!bundle) return null;

  return (
    <div className="border-t border-zinc-800 p-3 text-xs">
      <div className="mb-2 font-medium uppercase tracking-wide text-zinc-500">Iteration tree</div>
      <ul className="space-y-1">
        {(bundle.iterations || []).map((iteration) => {
          const active = iteration.id === bundle.assembly.activeIterationId;
          return (
            <li key={iteration.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onActivateIteration(iteration.id)}
                className={`w-full rounded px-2 py-1 text-left ${
                  active ? "bg-teal-500/20 text-teal-100" : "text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                <div>
                  {active ? "● " : "○ "}
                  {iteration.name}
                  <span className="ml-1 text-[10px] uppercase text-zinc-600">{iteration.stage}</span>
                </div>
                <div className="truncate pl-3 font-mono text-[10px] text-zinc-600">
                  {iteration.pins.map((p) => `${p.name} ${p.versionLabel}`).join(" · ")}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex gap-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name this combo"
          className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-200"
        />
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => {
            onSaveIteration(name.trim());
            setName("");
          }}
          className="rounded border border-teal-500/40 px-2 py-1 text-teal-200"
        >
          Save
        </button>
      </div>

      <div className="mt-3 font-medium uppercase tracking-wide text-zinc-500">Part history</div>
      {bundle.components.map((component) => {
        const versions = bundle.versions
          .filter((v) => v.componentId === component.id)
          .sort((a, b) => a.versionNumber - b.versionNumber);
        const activeId = bundle.instances.find((i) => i.componentId === component.id)?.versionId;
        return (
          <div key={component.id} className="mt-2">
            <button
              type="button"
              onClick={() => {
                const first = bundle.instances.find((i) => i.componentId === component.id);
                if (first) onSelect({ instanceId: first.id, componentId: component.id });
              }}
              className={`text-left ${selected.some((item) => item.componentId === component.id) ? "text-teal-200" : "text-zinc-300"}`}
            >
              {component.name}
            </button>
            {versions.map((version, index) => (
              <button
                key={version.id}
                type="button"
                disabled={busy}
                onClick={() => onRestoreVersion(component.id, version.id)}
                className={`flex w-full items-center gap-1 py-0.5 pl-2 text-left font-mono text-[10px] ${
                  version.id === activeId ? "text-teal-300" : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                {index === versions.length - 1 ? "└" : "├"} {version.label}
                {version.stage ? ` · ${version.stage}` : ""}
                {version.id === activeId ? " ←" : ""}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
