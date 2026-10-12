"use client";

import type { GenerationJob } from "@/caprio/client/types";

export function JobProgress({
  phase,
  elapsedSec,
  job,
  editLabel,
}: {
  phase: "planning" | "generating" | "idle";
  elapsedSec: number;
  job: GenerationJob | null;
  editLabel?: string | null;
}) {
  if (phase === "idle") return null;

  const surgical = Boolean(editLabel);
  const determinate = phase === "generating" && (job?.totalParts || 0) > 0;
  const percent = determinate ? Math.max(2, Math.min(100, job?.progress ?? 0)) : 0;
  const title = phase === "planning" ? "Planning with Grok" : surgical ? "Editing selected part" : "Generating parts";
  const subtitle =
    phase === "planning"
      ? `Breaking the object into independently editable components… ${elapsedSec}s`
      : surgical
        ? `Meshy is rebuilding ${editLabel} only. Other parts are left as they are. ${elapsedSec}s`
        : job?.message || `Meshy is sculpting each unique part… ${elapsedSec}s`;

  return (
    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-zinc-200">
          <span className="job-pulse h-2 w-2 rounded-full bg-teal-400" />
          <span className="font-medium">{title}</span>
        </div>
        <span className="tabular-nums text-zinc-500">{determinate ? `${percent}%` : `${elapsedSec}s`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
        {determinate ? (
          <div
            className="h-full rounded-full bg-teal-400 transition-[width] duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="job-indeterminate h-full w-1/3 rounded-full bg-teal-400" />
        )}
      </div>
      <p className="mt-2 text-xs text-zinc-400">{subtitle}</p>
      {job?.steps?.length ? (
        <ol className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-zinc-400 sm:grid-cols-4">
          {job.steps.map((step) => (
            <li key={step.name} className="flex items-center gap-1.5">
              <StepDot status={step.status} />
              <span className={step.status === "running" ? "text-teal-200" : step.status === "done" ? "text-zinc-300" : ""}>
                {step.name}
                {step.quantity > 1 ? ` ×${step.quantity}` : ""}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function StepDot({ status }: { status: string }) {
  if (status === "done") return <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />;
  if (status === "failed") return <span className="h-1.5 w-1.5 rounded-full bg-red-400" />;
  if (status === "running") return <span className="job-pulse h-1.5 w-1.5 rounded-full bg-amber-300" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />;
}
