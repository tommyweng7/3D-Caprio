"use client";

import { useMemo, useState } from "react";
import type { AssemblyBundle, SelectedRef } from "@/caprio/client/types";

export function ComponentTree({
  bundle,
  selected,
  onSelect,
}: {
  bundle: AssemblyBundle | null;
  selected: SelectedRef[];
  onSelect: (ref: SelectedRef | null, additive?: boolean, group?: SelectedRef[]) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const grouped = useMemo(() => {
    if (!bundle) return [];
    return bundle.components.map((component) => ({
      component,
      instances: bundle.instances.filter((i) => i.componentId === component.id),
    }));
  }, [bundle]);

  if (!bundle) {
    return <p className="px-3 py-2 text-sm text-zinc-500">No assembly yet.</p>;
  }

  const activeBranch = bundle.branches?.find((b) => b.id === bundle.assembly.activeBranchId);
  const selectedIds = new Set((selected || []).map((item) => item.instanceId));

  return (
    <div className="space-y-1 text-sm">
      <div className="px-3 py-2">
        <div className="font-medium text-zinc-100">{bundle.assembly.name}</div>
        <div className="text-[11px] text-zinc-500">
          {activeBranch ? `branch: ${activeBranch.name}` : "semantic graph"}
        </div>
        <div className="mt-1 text-[11px] text-zinc-600">Click a part name to select every instance. Shift-click to add.</div>
      </div>
      {grouped.map(({ component, instances }) => {
        const version = bundle.versions.find((v) => v.id === (instances[0]?.versionId || component.currentVersionId));
        const selectedHere = instances.some((i) => selectedIds.has(i.id));
        const open = expanded[component.id] ?? selectedHere;
        const group = instances.map((instance) => ({ instanceId: instance.id, componentId: instance.componentId }));
        return (
          <div key={component.id}>
            <button
              type="button"
              onClick={(event) => {
                if (group[0]) onSelect(group[0], event.shiftKey, group);
                setExpanded((prev) => ({ ...prev, [component.id]: true }));
              }}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left ${
                selectedHere ? "bg-teal-500/15 text-teal-100" : "text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              <span>
                {component.name}
                {instances.length > 1 ? ` ×${instances.length}` : ""}
                {component.locked ? " 🔒" : ""}
              </span>
              <span className="font-mono text-[10px] text-zinc-500">{version?.label || "—"}</span>
            </button>
            {open
              ? instances.map((instance) => {
                  const active = selectedIds.has(instance.id);
                  const instVersion = bundle.versions.find((v) => v.id === instance.versionId);
                  return (
                    <button
                      key={instance.id}
                      type="button"
                      onClick={(event) =>
                        onSelect({ instanceId: instance.id, componentId: instance.componentId }, event.shiftKey)
                      }
                      className={`flex w-full items-center justify-between px-6 py-1 text-left text-xs ${
                        active ? "text-teal-100" : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      <span>{instance.label}</span>
                      <span className="font-mono text-[10px]">{instVersion?.label}</span>
                    </button>
                  );
                })
              : null}
          </div>
        );
      })}
    </div>
  );
}
