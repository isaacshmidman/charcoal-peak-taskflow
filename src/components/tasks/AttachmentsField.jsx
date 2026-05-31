// @ts-nocheck
/**
 * @file Attachments section inside TaskForm.
 *
 * Two modes:
 *   - EXISTING TASK (taskId set): uploads + deletes hit the backend
 *     immediately. Reads via useQuery so the list stays fresh.
 *   - NEW TASK (taskId null): files queue locally; the parent
 *     TaskForm calls `flushPendingUploads(newTaskId)` after the task
 *     is created in handleSubmit, uploading each pending file in
 *     sequence. The chips render with their object-URL previews
 *     in the meantime.
 *
 * Drop zone + file picker — both bound to a hidden <input type="file">.
 * No batched picker; each file uploads independently so a per-file
 * error doesn't block siblings.
 *
 * Props:
 *   @param {{
 *     taskId: string | null,
 *     pendingFiles: File[],
 *     setPendingFiles: (next: File[]) => void,
 *     readOnly?: boolean,
 *   }} props
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Paperclip, Upload } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { cn } from "@/lib/utils";
import AttachmentChip from "./AttachmentChip.jsx";
import AttachmentLightbox from "./AttachmentLightbox.jsx";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PER_TASK = 10;

function validateFile(file, existingCount) {
  if (existingCount >= MAX_PER_TASK) {
    return `Too many attachments (max ${MAX_PER_TASK}).`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `“${file.name}” is too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB).`;
  }
  // Mirror the backend blocklist so the user gets immediate feedback.
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["exe", "bat", "cmd", "com", "scr", "msi", "app", "dmg", "sh", "ps1"].includes(ext)) {
    return `“.${ext}” files are not allowed.`;
  }
  return null;
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

  const uploadMutation = useMutation({
    mutationFn: ({ file }) => apiClient.attachments.upload(taskId, file),
    onSuccess: (created) => {
      queryClient.setQueryData(["taskAttachments", taskId], (prev = []) => [...prev, created]);
      // Mirror server-side: bump the cached task's attachment_count so
      // TaskCard's paperclip badge updates without a list refetch.
      queryClient.setQueryData(["tasks"], (prev) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map((t) =>
          t.id === taskId ? { ...t, attachment_count: (t.attachment_count || 0) + 1 } : t
        );
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => apiClient.attachments.delete(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData(["taskAttachments", taskId], (prev = []) => prev.filter((a) => a.id !== id));
      queryClient.setQueryData(["tasks"], (prev) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map((t) =>
          t.id === taskId
            ? { ...t, attachment_count: Math.max(0, (t.attachment_count || 0) - 1) }
            : t
        );
      });
    },
  });

  const totalCount = (serverAttachments?.length || 0) + (pendingFiles?.length || 0);

  const handleFiles = (files) => {
    setTopLevelError("");
    const fileList = Array.from(files || []);
    if (!fileList.length) return;
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const validation = validateFile(file, totalCount + i);
      if (validation) {
        setTopLevelError(validation);
        return;
      }
    }
    if (taskId) {
      // Existing task — upload immediately.
      fileList.forEach((file) => {
        uploadMutation.mutate({ file });
      });
    } else {
      // New task — queue locally; parent flushes after task creation.
      setPendingFiles([...(pendingFiles || []), ...fileList]);
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
              onDelete={readOnly ? undefined : () => deleteMutation.mutate(att.id)}
            />
          ))}
          {pendingFiles.map((file, idx) => (
            <AttachmentChip
              key={`pending-${idx}-${file.name}`}
              attachment={null}
              localFile={file}
              uploading={false}
              onDelete={readOnly ? undefined : () => {
                setPendingFiles(pendingFiles.filter((_, i) => i !== idx));
              }}
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
 * @param {string} taskId
 * @param {File[]} files
 * @returns {Promise<void>}
 */
export async function flushPendingUploads(taskId, files) {
  if (!taskId || !files?.length) return;
  for (const file of files) {
    try {
      await apiClient.attachments.upload(taskId, file);
    } catch (err) {
      // Don't block the whole batch on one bad file; surface a console
      // error so a future "upload failed" toast can catch it.
      console.warn("Attachment upload failed for", file.name, err);
    }
  }
}
