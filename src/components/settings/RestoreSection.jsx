// @ts-nocheck
/**
 * @file "Restore from an export": upload a Zephyrly export (the .zip, or
 * its data.json) and the server adds back whatever this account is
 * missing — never changing or removing what's here (backend/restore.js).
 * Shown under the export download, its other half.
 */
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { restoreFromExport } from "@/api/apiClient";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { Button } from "@/components/ui/button";

const ADDED_LABELS = [
  ["tasks", "task", "tasks"],
  ["notes", "note", "notes"],
  ["priorities", "priority", "priorities"],
  ["tags", "tag", "tags"],
  ["recentlyDeleted", "item in Recently Deleted", "items in Recently Deleted"],
  ["files", "file", "files"],
];

/**
 * One line for what a restore added, e.g. "Added 12 tasks, 3 notes and 2 files."
 *
 * @param {Record<string, number> | undefined} added
 */
export function describeRestore(added) {
  const parts = ADDED_LABELS.filter(([key]) => added?.[key] > 0).map(
    ([key, one, many]) => `${added[key]} ${added[key] === 1 ? one : many}`
  );
  if (!parts.length) return "Nothing was missing — everything in this export is already here.";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Added ${list}.`;
}

export default function RestoreSection() {
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const inputRef = useRef(null);
  // idle | uploading (percent) | working | done (result) | failed (message)
  const [state, setState] = useState({ phase: "idle" });
  const busy = state.phase === "uploading" || state.phase === "working";

  const start = async (file) => {
    setState({ phase: "uploading", percent: 0 });
    try {
      const result = await restoreFromExport(file, {
        onProgress: (percent) =>
          setState((current) =>
            current.phase !== "uploading" ? current : percent >= 100 ? { phase: "working" } : { phase: "uploading", percent }
          ),
      });
      setState({ phase: "done", result });
      // New records can land anywhere — tasks, notes, trash, storage.
      queryClient.invalidateQueries();
    } catch (error) {
      setState({ phase: "failed", message: error?.message || "The restore didn't finish. Nothing was changed." });
    }
  };

  const onPick = (event) => {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again still fires a change.
    event.target.value = "";
    if (file) start(file);
  };

  return (
    <div className="space-y-3 border-t border-slate-100 pt-5 dark:border-[#303030]">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Restore from an export</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Choose an export you downloaded (the .zip, or its data.json) to bring back anything that's missing. Nothing
        already here is changed or removed.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".zip,.json,application/zip,application/json"
        className="hidden"
        onChange={onPick}
        data-testid="restore-file-input"
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={!online || busy}
        data-testid="restore-choose"
        className="w-full gap-2"
      >
        <Upload className="h-4 w-4" />
        {busy ? "Restoring…" : "Choose an export…"}
      </Button>

      <div aria-live="polite" data-testid="restore-status">
        {!online && !busy && (
          <p className="text-center text-xs text-slate-400 dark:text-slate-500">You're offline. Restoring needs a connection.</p>
        )}
        {state.phase === "uploading" && (
          <div className="space-y-1.5">
            <div
              role="progressbar"
              aria-label="Uploading export"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={state.percent}
              className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-[#303030]"
            >
              <div className="h-full bg-slate-900 transition-[width] dark:bg-slate-100" style={{ width: `${state.percent}%` }} />
            </div>
            <p className="text-center text-xs text-slate-500 dark:text-slate-400">
              Uploading… {state.percent}%. Keep this page open until it finishes.
            </p>
          </div>
        )}
        {state.phase === "working" && (
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">Restoring… Keep this page open until it finishes.</p>
        )}
        {state.phase === "failed" && (
          <p className="text-xs text-red-600 dark:text-red-400" data-testid="restore-error">{state.message}</p>
        )}
        {state.phase === "done" && (
          <div className="space-y-1.5 rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-[#252525]" data-testid="restore-summary">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{describeRestore(state.result?.added)}</p>
            {(state.result?.notes || []).length > 0 && (
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-500 dark:text-slate-400">
                {state.result.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
