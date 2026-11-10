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
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

// Mirrors the backend blocklist so the user hears about it at once.
const BLOCKED_EXTENSIONS = ["exe", "bat", "cmd", "com", "scr", "msi", "app", "dmg", "sh", "ps1"];

/** Why one file can't be attached, or null if it can. */
function validateFile(file) {
  if (file.size === 0) {
    // A folder dragged in shows up as an empty file; so does a truly
    // empty one. Either way there is nothing to upload.
    return `“${file.name}” is empty (folders can't be attached).`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `“${file.name}” is too large (max ${MAX_FILE_BYTES / 1_000_000} MB).`;
  }
  const ext = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return `“${file.name}”: .${ext} files are not allowed.`;
  }
  return null;
}

/**
 * Sort a picked batch into what can be attached and why the rest can't.
 * One bad file no longer sinks the whole batch: the good ones go ahead
 * and the message names the ones left out.
 *
 * @param {File[]} files
 * @param {number} existingCount  files already on the task
 * @returns {{ accepted: File[], problems: string[] }}
 */
export function sortPickedFiles(files, existingCount) {
  const accepted = [];
  const problems = [];
  let overLimit = 0;
  for (const file of files) {
    const problem = validateFile(file);
    if (problem) problems.push(problem);
    else if (existingCount + accepted.length >= MAX_PER_TASK) overLimit += 1;
    else accepted.push(file);
  }
  if (overLimit) {
    problems.push(
      `A task holds ${MAX_PER_TASK} files — ${overLimit === 1 ? "1 file was" : `${overLimit} files were`} left out.`
    );
  }
  return { accepted, problems };
}

/** True when a drag or a paste is carrying files (not text, not a link). */
const carriesFiles = (dataTransfer) => Array.from(dataTransfer?.types || []).includes("Files");

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
  const rootRef = useRef(null);
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

    // A task that doesn't exist on the server yet can't take files while
    // offline: there is no id to queue them against, and they would be
    // dropped without a word when the task is created.
    if (!online && (!taskId || String(taskId).startsWith("offline_"))) {
      setTopLevelError("You're offline. Save this task, then add its files once you're back online.");
      return;
    }

    const { accepted, problems } = sortPickedFiles(fileList, totalCount);
    if (problems.length) setTopLevelError(problems.join(" "));
    if (!accepted.length) return;

    // ── Offline path (existing task only) ──────────────────────
    // Stash the files in IndexedDB; the replay driver uploads them on
    // reconnect. We do NOT touch pendingFiles for these — they render
    // from the offlineAttachments query as "queued (offline)" chips.
    if (taskId && !online) {
      Promise.all(accepted.map((file) => attachmentQueue.enqueue({ taskId, file })))
        .then(() => queryClient.invalidateQueries({ queryKey: ["offlineAttachments", taskId] }))
        .catch(() => setTopLevelError("Couldn't queue files for offline upload on this device."));
      return;
    }

    const newPending = accepted.map((file) => ({
      tempId: makeTempId(),
      file,
      status: "queued",
      progress: 0,
    }));
    // Functional, so two batches added in quick succession both land.
    setPendingFiles((current = []) => [...current, ...newPending]);
    if (taskId) {
      // Existing task, online — schedule uploads; the semaphore caps concurrency.
      newPending.forEach(({ file, tempId }) => {
        startUploadInBackground(file, tempId, { bumpCount: true });
      });
    }
    // For NEW task: parent's handleSubmit will call flushPendingUploads.
  };

  // The whole form takes a dropped or pasted file, not just the small
  // "Add files" strip. Before this, a file dropped a few pixels wide of
  // the strip made the browser leave the app and open the file instead —
  // taking the half-filled form with it.
  const handleFilesRef = useRef(handleFiles);
  handleFilesRef.current = handleFiles;
  useEffect(() => {
    if (readOnly) return undefined;
    const form = rootRef.current?.closest("[role='dialog']") || rootRef.current;
    if (!form) return undefined;
    const inForm = (event) => form.contains(event.target);

    const onDragOver = (event) => {
      if (!carriesFiles(event.dataTransfer)) return;
      // Always claim a file drag while the form is open, so a miss never
      // navigates away; only a drop inside the form attaches.
      event.preventDefault();
      event.dataTransfer.dropEffect = inForm(event) ? "copy" : "none";
      setDragOver(inForm(event));
    };
    const onDrop = (event) => {
      if (!carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      setDragOver(false);
      if (inForm(event)) handleFilesRef.current(event.dataTransfer.files);
    };
    const onDragEnd = (event) => {
      // Left the window (no related target), or the drag was abandoned.
      if (event.type === "dragend" || !event.relatedTarget) setDragOver(false);
    };
    const onPaste = (event) => {
      const data = event.clipboardData;
      if (!data?.files?.length || !inForm(event)) return;
      // Copying from a document or a spreadsheet puts a picture of the
      // selection on the clipboard next to the text. That paste is text.
      if (data.getData("text/plain")) return;
      event.preventDefault();
      handleFilesRef.current(data.files);
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragleave", onDragEnd);
    window.addEventListener("dragend", onDragEnd);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragleave", onDragEnd);
      window.removeEventListener("dragend", onDragEnd);
      window.removeEventListener("paste", onPaste);
    };
  }, [readOnly]);

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

  return (
    <div className="min-w-0" ref={rootRef}>
      {/* Drop zone + file picker trigger */}
      {!readOnly && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          data-testid="attachments-add"
          className={cn(
            "flex min-h-9 w-full items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-left text-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ink-900/10 dark:focus-visible:ring-sun-400/20",
            dragOver
              ? "border-ink-900 bg-selected text-ink-900 dark:border-sun-400 dark:text-ink-100"
              : "border-border-strong text-ink-500 hover:border-ink-400 hover:text-ink-700 dark:text-ink-400 dark:hover:border-night-line-bold dark:hover:text-ink-200"
          )}
        >
          {dragOver ? (
            <>
              <Upload className="h-4 w-4 shrink-0" />
              Drop anywhere here to attach
            </>
          ) : (
            <>
              <Paperclip className="h-4 w-4 shrink-0" />
              {/* Nothing can be dragged onto a phone, so it doesn't offer. */}
              <span>Add files<span className="[@media(pointer:coarse)]:hidden">, or drop them here</span></span>
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
        data-testid="attachments-input"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          // Clear so picking the same file twice still fires onChange.
          e.target.value = "";
        }}
      />

      {topLevelError && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{topLevelError}</p>
      )}

      {!online && taskId && (
        <p className="mt-2 text-[11px] text-ink-400 dark:text-ink-500">
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
              // A new task's files wait for Save; nothing is in flight.
              uploading={!!taskId && (status === "uploading" || status === "queued")}
              waitingForSave={!taskId}
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
 * @returns {Promise<Array<{ file: File, ok: boolean, error?: string, status?: number }>>}
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
      results.push({ file, ok: false, error: msg, status: err?.status });
    }
  }
  return results;
}

/** A refusal the server will repeat, as opposed to a dropped connection. */
const isRefusal = attachmentQueue.isPermanentUploadFailure;

/**
 * Upload the files picked for a task that has just been created, and
 * deal with the ones that didn't make it — which used to vanish without
 * a word, because the form that could have shown the error had closed.
 *
 *   - the connection dropped (or the server hiccuped): the file is put
 *     in the offline queue and uploads by itself when things recover;
 *   - the server refused it: nothing to retry, so the reason is reported;
 *   - the task itself was only saved offline: there is no server task to
 *     attach to yet, so that is reported too.
 *
 * @param {string} taskId
 * @param {Array<{ tempId: string, file: File }>} pending
 * @returns {Promise<{ uploaded: number, queued: number, message: string }>}
 *   `message` is "" when everything uploaded; otherwise a sentence to show.
 */
export async function attachToNewTask(taskId, pending) {
  if (!taskId || !pending?.length) return { uploaded: 0, queued: 0, message: "" };
  const count = (n) => `${n} file${n === 1 ? "" : "s"}`;

  if (String(taskId).startsWith("offline_")) {
    return {
      uploaded: 0,
      queued: 0,
      message: `The task was saved offline, so its ${count(pending.length)} couldn't be attached. Add ${pending.length === 1 ? "it" : "them"} again once you're back online.`,
    };
  }

  const results = await flushPendingUploads(taskId, pending);
  const failed = results.filter((r) => !r.ok);
  const refused = failed.filter((r) => isRefusal(r.status));
  const retryable = failed.filter((r) => !isRefusal(r.status));

  let queued = 0;
  for (const { file } of retryable) {
    try {
      await attachmentQueue.enqueue({ taskId, file });
      queued += 1;
    } catch {
      refused.push({ file, ok: false, error: "it couldn't be saved on this device to retry" });
    }
  }

  const parts = [];
  if (queued) parts.push(`${count(queued)} will finish uploading when the connection is back.`);
  if (refused.length === 1) parts.push(`Couldn't attach “${refused[0].file.name}”: ${refused[0].error}`);
  else if (refused.length > 1) parts.push(`Couldn't attach ${count(refused.length)}: ${refused[0].error}`);
  return { uploaded: results.length - failed.length, queued, message: parts.join(" ") };
}
