// @ts-nocheck
/**
 * @file Attachments section inside TaskForm.
 *
 * Two modes:
 *   - EXISTING TASK (taskId set): clicking a file IMMEDIATELY adds an
 *     uploading chip + bumps TaskCard's paperclip count optimistically.
 *     The upload runs in the background; on success the temporary chip
 *     is swapped for the real one. On failure the chip flips to an
 *     error state with a Retry button (no re-picking required) and the
 *     count is rolled back.
 *   - NEW TASK (taskId null): files queue locally; the parent
 *     TaskForm calls `flushPendingUploads(newTaskId, pending)` after
 *     the task is created in handleSubmit, uploading each pending
 *     file in sequence.
 *
 * Internal state shape:
 *   pendingFiles: Array<{ tempId, file, status, error? }>
 *   status ∈ "queued" | "uploading" | "error"
 *
 * "queued" is used for NEW-task flow (file is staged until Save).
 * "uploading" + "error" are used for EXISTING-task flow (live upload).
 *
 * Props:
 *   @param {{
 *     taskId: string | null,
 *     pendingFiles: Array<{ tempId: string, file: File, status?: string, error?: string }>,
 *     setPendingFiles: (next: any) => void,
 *     readOnly?: boolean,
 *   }} props
 */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Paperclip, Upload } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import * as attachmentQueue from "@/lib/attachmentQueue";
import { cn } from "@/lib/utils";
import AttachmentChip from "./AttachmentChip.jsx";
import AttachmentLightbox from "./AttachmentLightbox.jsx";

// SI units (10^6) to match the backend cap so error messages line up.
const MAX_FILE_BYTES = 25 * 1_000_000;
const MAX_PER_TASK = 10;
// Cap simultaneous in-flight uploads so picking ten files doesn't open
// ten parallel connections (saturates the link, makes each bar crawl).
const MAX_CONCURRENT_UPLOADS = 3;

function makeTempId() {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function validateFile(file, existingCount) {
  if (existingCount >= MAX_PER_TASK) {
    return `Too many attachments (max ${MAX_PER_TASK}).`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `“${file.name}” is too large (max ${MAX_FILE_BYTES / 1_000_000} MB).`;
  }
  // Mirror the backend blocklist so the user gets immediate feedback.
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["exe", "bat", "cmd", "com", "scr", "msi", "app", "dmg", "sh", "ps1"].includes(ext)) {
    return `“.${ext}” files are not allowed.`;
  }
  return null;
}

/** Bump the cached task's attachment_count by `delta` (positive or negative). */
function patchCachedTaskCount(queryClient, taskId, delta) {
  queryClient.setQueryData(["tasks"], (prev) => {
    if (!Array.isArray(prev)) return prev;
    return prev.map((t) =>
      t.id === taskId
        ? { ...t, attachment_count: Math.max(0, (t.attachment_count || 0) + delta) }
        : t
    );
  });
}

export default function AttachmentsField({ taskId, pendingFiles, setPendingFiles, readOnly }) {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewing, setPreviewing] = useState(null);
  const [topLevelError, setTopLevelError] = useState("");

  // Files queued in IndexedDB while offline, for THIS task. The replay
  // driver (useAttachmentQueue, mounted in Layout) uploads them on
  // reconnect and invalidates this query.
  const { data: offlineQueued = [] } = useQuery({
    queryKey: ["offlineAttachments", taskId],
    queryFn: () => attachmentQueue.listForTask(taskId),
    enabled: !!taskId,
  });

  // ── Shared upload semaphore ───────────────────────────────────
  // Caps concurrency across ALL add batches (not per-batch), so adding
  // 5 files then 5 more never exceeds MAX_CONCURRENT_UPLOADS in flight.
  // Files waiting for a slot show as "queued"; they flip to "uploading"
  // the moment acquire() resolves.
  const activeUploadsRef = useRef(0);
  const waitQueueRef = useRef(/** @type {Array<() => void>} */ ([]));
  const acquireSlot = () =>
    new Promise((resolve) => {
      if (activeUploadsRef.current < MAX_CONCURRENT_UPLOADS) {
        activeUploadsRef.current += 1;
        resolve();
      } else {
        waitQueueRef.current.push(resolve);
      }
    });
  const releaseSlot = () => {
    const next = waitQueueRef.current.shift();
    if (next) {
      // Hand the slot directly to the next waiter (count stays the same).
      next();
    } else {
      activeUploadsRef.current = Math.max(0, activeUploadsRef.current - 1);
    }
  };

  const { data: serverAttachments = [] } = useQuery({
    queryKey: ["taskAttachments", taskId],
    queryFn: () => apiClient.attachments.list(taskId),
    enabled: !!taskId,
  });

  const totalCount =
    (serverAttachments?.length || 0) +
    (pendingFiles?.length || 0) +
    (offlineQueued?.length || 0);

  /** Mutate a single pending file's status by tempId. */
  const patchPending = (tempId, patch) => {
    setPendingFiles((current = []) =>
      current.map((p) => (p.tempId === tempId ? { ...p, ...patch } : p))
    );
  };

  const removePending = (tempId) => {
    setPendingFiles((current = []) => current.filter((p) => p.tempId !== tempId));
  };

  /**
   * Existing-task path: wait for a concurrency slot, then upload with
   * live progress, swap chip on success, flip to error on failure.
   * The caller is responsible for the optimistic count bump (done once
   * per file in handleFiles / on retry here).
   */
  const startUploadInBackground = async (file, tempId, { bumpCount = false } = {}) => {
    setTopLevelError("");
    if (bumpCount) patchCachedTaskCount(queryClient, taskId, +1);
    // Stay "queued" until a slot frees up, then flip to "uploading".
    patchPending(tempId, { status: "queued", error: undefined, progress: 0 });
    await acquireSlot();
    patchPending(tempId, { status: "uploading", error: undefined, progress: 0 });
    try {
      const created = await apiClient.attachments.upload(taskId, file, {
        onProgress: (percent) => patchPending(tempId, { progress: percent }),
      });
      removePending(tempId);
      if (created?.id) {
        queryClient.setQueryData(["taskAttachments", taskId], (prev = []) => [...prev, created]);
      } else {
        queryClient.invalidateQueries({ queryKey: ["taskAttachments", taskId] });
      }
    } catch (err) {
      // Keep the chip — flip it to "error" so the user can hit Retry
      // without re-picking the file. Roll back the count bump (we'll
      // re-bump on retry).
      const msg = err?.message || `Couldn't upload “${file.name}”.`;
      patchPending(tempId, { status: "error", error: msg, progress: 0 });
      patchCachedTaskCount(queryClient, taskId, -1);
    } finally {
      releaseSlot();
    }
  };

  const handleFiles = (files) => {
    setTopLevelError("");
    const fileList = Array.from(files || []);
    if (!fileList.length) return;
    for (let i = 0; i < fileList.length; i++) {
      const validation = validateFile(fileList[i], totalCount + i);
      if (validation) {
        setTopLevelError(validation);
        return;
      }
    }
    // ── Offline path (existing task only) ──────────────────────
    // Stash the files in IndexedDB; the replay driver uploads them on
    // reconnect. We do NOT touch pendingFiles for these — they render
    // from the offlineAttachments query as "queued (offline)" chips.
    if (taskId && !online) {
      if (String(taskId).startsWith("offline_")) {
        // The task itself was created offline and hasn't synced; its
        // server id will differ, so we can't queue an upload against it.
        setTopLevelError("Reconnect to the internet to attach files to a newly created task.");
        return;
      }
      Promise.all(fileList.map((file) => attachmentQueue.enqueue({ taskId, file })))
        .then(() => queryClient.invalidateQueries({ queryKey: ["offlineAttachments", taskId] }))
        .catch(() => setTopLevelError("Couldn't queue files for offline upload on this device."));
      return;
    }

    const newPending = fileList.map((file) => ({
      tempId: makeTempId(),
      file,
      status: "queued",
      progress: 0,
    }));
    setPendingFiles([...(pendingFiles || []), ...newPending]);
    if (taskId) {
      // Existing task, online — schedule uploads; the semaphore caps concurrency.
      newPending.forEach(({ file, tempId }) => {
        startUploadInBackground(file, tempId, { bumpCount: true });
      });
    }
    // For NEW task: parent's handleSubmit will call flushPendingUploads.
  };

  /** Remove an offline-queued (not-yet-uploaded) file from IndexedDB. */
  const removeOfflineQueued = async (id) => {
    await attachmentQueue.remove(id);
    queryClient.invalidateQueries({ queryKey: ["offlineAttachments", taskId] });
  };

  /** Existing-task path: instant remove, roll back on error. */
  const handleDelete = async (id) => {
    setTopLevelError("");
    const prev = queryClient.getQueryData(["taskAttachments", taskId]) || [];
    const removed = prev.find((a) => a.id === id);
    if (!removed) return;
    queryClient.setQueryData(["taskAttachments", taskId], prev.filter((a) => a.id !== id));
    patchCachedTaskCount(queryClient, taskId, -1);
    try {
      await apiClient.attachments.delete(id);
    } catch (err) {
      queryClient.setQueryData(["taskAttachments", taskId], (curr = []) => [...curr, removed]);
      patchCachedTaskCount(queryClient, taskId, +1);
      setTopLevelError(err?.message || "Couldn't remove that file.");
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (!readOnly) handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e) => {
    e.preventDefault();
    if (!readOnly) setDragOver(true);
  };

  return (
    <div className="min-w-0">
      <Label className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1.5 block">
        Attachments
      </Label>

      {/* Drop zone + file picker trigger */}
      {!readOnly && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={() => setDragOver(false)}
          className={cn(
            "w-full flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 transition-colors text-xs font-medium",
            dragOver
              ? "border-slate-400 dark:border-slate-500 bg-slate-50 dark:bg-[#161616] text-slate-900 dark:text-slate-100"
              : "border-slate-200 dark:border-[#343434] bg-white dark:bg-[#0c0c0c] text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-[#454545]"
          )}
        >
          {dragOver ? (
            <>
              <Upload className="w-4 h-4" />
              Drop to attach
            </>
          ) : (
            <>
              <Paperclip className="w-4 h-4" />
              Attach files or drop here
            </>
          )}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        // No `accept` restriction — backend handles all types.
        // No `capture` attribute either: on iOS, `capture` forces the
        // camera to open immediately, skipping the standard action
        // sheet. Without it, Safari shows the full menu — "Photo
        // Library", "Take Photo or Video", "Choose Files" — which is
        // what the user expects on Apple devices.
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          // Clear so picking the same file twice still fires onChange.
          e.target.value = "";
        }}
      />

      {topLevelError && (
        <p className="mt-2 text-xs text-red-500 dark:text-red-300">{topLevelError}</p>
      )}

      {!online && taskId && (
        <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
          Offline — files you attach now upload automatically when you reconnect.
        </p>
      )}

      {/* Existing + pending + offline-queued chips */}
      {(serverAttachments.length > 0 || pendingFiles.length > 0 || offlineQueued.length > 0) && (
        <div className="mt-2 space-y-1.5">
          {serverAttachments.map((att) => (
            <AttachmentChip
              key={att.id}
              attachment={att}
              onPreview={(a) => a.is_image && setPreviewing(a)}
              onDelete={readOnly ? undefined : () => handleDelete(att.id)}
            />
          ))}
          {pendingFiles.map(({ tempId, file, status, error, progress }) => (
            <AttachmentChip
              key={tempId}
              attachment={null}
              localFile={file}
              uploading={status === "uploading" || status === "queued"}
              progress={status === "uploading" ? progress : null}
              uploadError={status === "error" ? (error || "Upload failed") : null}
              onRetry={status === "error" && taskId
                ? () => startUploadInBackground(file, tempId, { bumpCount: true })
                : undefined}
              onDelete={readOnly ? undefined : () => removePending(tempId)}
            />
          ))}
          {offlineQueued.map((item) => (
            <AttachmentChip
              key={item.id}
              attachment={null}
              localFile={attachmentQueue.toFile(item)}
              offlineQueued
              onDelete={readOnly ? undefined : () => removeOfflineQueued(item.id)}
            />
          ))}
        </div>
      )}

      <AttachmentLightbox
        attachment={previewing}
        onClose={() => setPreviewing(null)}
      />
    </div>
  );
}

/**
 * Sequentially upload the pending files against a newly-created task.
 * Called by TaskForm/index.jsx in `handleSubmit` after createTask
 * returns. Exported as a helper so TaskForm doesn't need to know about
 * the mutation internals.
 *
 * Returns the per-file results so the caller can surface failures.
 *
 * @param {string} taskId
 * @param {Array<{ tempId: string, file: File }>} pending
 * @returns {Promise<Array<{ file: File, ok: boolean, error?: string }>>}
 */
export async function flushPendingUploads(taskId, pending) {
  if (!taskId || !pending?.length) return [];
  const results = [];
  for (const { file } of pending) {
    try {
      await apiClient.attachments.upload(taskId, file);
      results.push({ file, ok: true });
    } catch (err) {
      const msg = err?.message || "Upload failed";
      console.warn("Attachment upload failed for", file.name, msg);
      results.push({ file, ok: false, error: msg });
    }
  }
  return results;
}
