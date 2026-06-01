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
import { cn } from "@/lib/utils";
import AttachmentChip from "./AttachmentChip.jsx";
import AttachmentLightbox from "./AttachmentLightbox.jsx";

// SI units (10^6) to match the backend cap so error messages line up.
const MAX_FILE_BYTES = 25 * 1_000_000;
const MAX_PER_TASK = 10;

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
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewing, setPreviewing] = useState(null);
  const [topLevelError, setTopLevelError] = useState("");

  const { data: serverAttachments = [] } = useQuery({
    queryKey: ["taskAttachments", taskId],
    queryFn: () => apiClient.attachments.list(taskId),
    enabled: !!taskId,
  });

  const totalCount = (serverAttachments?.length || 0) + (pendingFiles?.length || 0);

  /** Mutate a single pending file's status by tempId. */
  const patchPending = (tempId, patch) => {
    setPendingFiles((current = []) =>
      current.map((p) => (p.tempId === tempId ? { ...p, ...patch } : p))
    );
  };

  const removePending = (tempId) => {
    setPendingFiles((current = []) => current.filter((p) => p.tempId !== tempId));
  };

  /** Existing-task path: fire upload, swap chip on success, flip to error on failure. */
  const startUploadInBackground = async (file, tempId, isRetry = false) => {
    setTopLevelError("");
    patchPending(tempId, { status: "uploading", error: undefined });
    if (!isRetry) patchCachedTaskCount(queryClient, taskId, +1);  // bump on first try only
    try {
      const created = await apiClient.attachments.upload(taskId, file);
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
      patchPending(tempId, { status: "error", error: msg });
      patchCachedTaskCount(queryClient, taskId, -1);
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
    const newPending = fileList.map((file) => ({
      tempId: makeTempId(),
      file,
      status: taskId ? "uploading" : "queued",
    }));
    setPendingFiles([...(pendingFiles || []), ...newPending]);
    if (taskId) {
      // Existing task — start uploads in parallel.
      newPending.forEach(({ file, tempId }) => {
        // Bump count once now (before status flip); startUploadInBackground
        // is called with isRetry=true to avoid a second bump.
        patchCachedTaskCount(queryClient, taskId, +1);
        startUploadInBackground(file, tempId, /* isRetry */ true);
      });
    }
    // For NEW task: parent's handleSubmit will call flushPendingUploads.
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
    <div>
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
        // No `accept` restriction — backend handles all types. `capture` on
        // mobile makes the photo picker offer the camera as an option.
        multiple
        capture
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

      {/* Existing + pending chips */}
      {(serverAttachments.length > 0 || pendingFiles.length > 0) && (
        <div className="mt-2 space-y-1.5">
          {serverAttachments.map((att) => (
            <AttachmentChip
              key={att.id}
              attachment={att}
              onPreview={(a) => a.is_image && setPreviewing(a)}
              onDelete={readOnly ? undefined : () => handleDelete(att.id)}
            />
          ))}
          {pendingFiles.map(({ tempId, file, status, error }) => (
            <AttachmentChip
              key={tempId}
              attachment={null}
              localFile={file}
              uploading={status === "uploading"}
              uploadError={status === "error" ? (error || "Upload failed") : null}
              onRetry={status === "error" && taskId
                ? () => startUploadInBackground(file, tempId, /* isRetry */ false)
                : undefined}
              onDelete={readOnly ? undefined : () => removePending(tempId)}
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
