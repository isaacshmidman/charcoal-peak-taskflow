// @ts-nocheck
/**
 * @file Storage usage sub-page (Pri 1 of deferred attachment work).
 *
 * Shows:
 *   - Big progress bar with the user's used / total bytes
 *   - Numeric "X MB of Y MB used" + "Z MB free"
 *   - Top 10 tasks by total attachment size — title + count + size each
 *
 * Read-only — there's no destructive UI here. Users free up space by
 * removing attachments from individual tasks.
 */
import { useQuery } from "@tanstack/react-query";
import { Database, FileText, Loader2 } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { cn } from "@/lib/utils";

/**
 * SI units (1 KB = 1000 bytes, 1 MB = 10^6, 1 GB = 10^9) so the
 * displayed number matches what users mean by "1 GB". With binary
 * units (2^30 = 1.073e9), 82 KB used would display as "1023.9 MB
 * free of 1 GB", which reads as "more than 1 GB free of 1 GB"
 * — confusing nonsense.
 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export default function StorageSection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["storageUsage"],
    queryFn: () => apiClient.attachments.usage(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading storage usage…
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-xs text-amber-600 dark:text-amber-300">
        Couldn't load storage usage: {error.message || "network error"}
      </p>
    );
  }

  const used = data?.used_bytes ?? 0;
  const max = data?.max_bytes ?? 1;
  const pct = Math.min(100, Math.max(0, (used / max) * 100));
  const free = Math.max(0, max - used);
  const biggestTasks = data?.biggest_tasks ?? [];

  // Colour grades by saturation, same threshold rules as iOS battery /
  // most disk-usage UIs.
  const barClass =
    pct >= 95
      ? "bg-red-500 dark:bg-red-400"
      : pct >= 80
        ? "bg-amber-500 dark:bg-amber-400"
        : "bg-slate-700 dark:bg-slate-300";

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-100 dark:border-[#303030] bg-white dark:bg-[#111111] px-4 py-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {formatBytes(used)} of {formatBytes(max)} used
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              {formatBytes(free)} free
            </p>
          </div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">
            {pct.toFixed(pct >= 10 ? 0 : 1)}%
          </p>
        </div>

        <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-[#0c0c0c] overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500", barClass)}
            style={{ width: `${pct}%` }}
            aria-hidden
          />
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500">
          Attachments live alongside your tasks. Removing a task's
          attachments frees space immediately; deleting a task removes
          them on the same 7-day Recently Deleted timer as the task.
        </p>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
          Largest tasks
        </h2>
        {biggestTasks.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-slate-500 px-1">
            No attachments yet. Drop a file into any task to see it here.
          </p>
        ) : (
          <ul className="rounded-xl border border-slate-100 dark:border-[#303030] bg-white dark:bg-[#111111] divide-y divide-slate-100 dark:divide-[#303030] overflow-hidden">
            {biggestTasks.map((task) => (
              <li
                key={task.task_id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <FileText className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate" title={task.task_title}>
                    {task.task_title}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    {task.file_count} file{task.file_count === 1 ? "" : "s"}
                  </p>
                </div>
                <p className="text-xs font-medium text-slate-700 dark:text-slate-200 shrink-0">
                  {formatBytes(task.total_bytes)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Mini-icon for the Settings card next to the Database lucide glyph.
 * Exported so Settings.jsx can colour-tag the icon if it wants to.
 */
export { Database as StorageIcon };
