// @ts-nocheck
/**
 * @file Single attachment row used by AttachmentsField. Two visual
 * modes:
 *   - image:   small square thumbnail + filename + size + remove X.
 *              Click thumbnail OR filename to open the lightbox.
 *   - file:    file-type icon + filename + size + download + remove X.
 *              Click filename to open inline in a new tab.
 *
 * Pending states (no `attachment.id` yet):
 *   - uploading: shows the local file's preview (blob URL) + spinner
 *     + "Uploading…" status text.
 *   - error: shows the local preview + a Retry button + the error
 *     message in red. The user can retry without re-picking the file.
 *
 * Props:
 *   @param {{
 *     attachment: { id: string, filename: string, mime_type: string,
 *                   size_bytes: number, is_image: boolean } | null,
 *     localFile?: File,           — only set for queued / failed uploads
 *     uploading?: boolean,        — true while queued or in flight
 *     progress?: number | null,   — 0–100 while uploading; null = indeterminate
 *     offlineQueued?: boolean,    — stored in IndexedDB, awaiting reconnect
 *     uploadError?: string | null,
 *     onRetry?: () => void,       — only meaningful when uploadError set
 *     onPreview?: (a: any) => void,
 *     onDelete?: () => void,
 *   }} props
 */
import { useEffect, useState } from "react";
import { CloudOff, Download, FileText, Image as ImageIcon, ImageOff, Loader2, RefreshCw, X } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { cn } from "@/lib/utils";

/** "1234567" → "1.2 MB" using SI units (matches the Settings → Storage page). */
function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export default function AttachmentChip({
  attachment,
  localFile,
  uploading,
  progress,
  offlineQueued,
  uploadError,
  onRetry,
  onPreview,
  onDelete,
}) {
  // For a queued local file (no attachment id yet), make an object URL
  // so we can show a preview before the upload completes.
  const [localPreviewUrl, setLocalPreviewUrl] = useState(null);
  // If the thumbnail fetch fails (e.g. backend served a HEIC-disguised-as-
  // JPG and the browser can't decode it), fall back to the file icon.
  const [thumbError, setThumbError] = useState(false);
  useEffect(() => {
    if (!localFile || !localFile.type?.startsWith("image/")) {
      setLocalPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(localFile);
    setLocalPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [localFile]);
  // Reset the error state when the underlying attachment changes so
  // re-uploading the same chip doesn't stay stuck in the icon-only
  // fallback.
  useEffect(() => { setThumbError(false); }, [attachment?.id]);

  const isImage = attachment?.is_image || (localFile?.type?.startsWith("image/") ?? false);
  const filename = attachment?.filename || localFile?.name || "Attachment";
  const sizeBytes = attachment?.size_bytes ?? localFile?.size ?? 0;
  const thumbnailUrl = attachment?.id
    ? apiClient.attachments.urlFor(attachment.id, { thumb: true })
    : localPreviewUrl;
  const showImageThumb = isImage && thumbnailUrl && !thumbError;

  // Status line under the filename. Drives the spinner / retry button
  // visibility in the actions area on the right.
  // While uploading: show a % when we have determinate progress, else
  // a plain "Uploading…" (covers the queued-waiting-for-a-slot state).
  let statusText;
  if (uploadError) statusText = <span className="text-red-500 dark:text-red-300">{uploadError}</span>;
  else if (offlineQueued) statusText = "Queued — uploads when you're back online";
  else if (uploading) statusText = typeof progress === "number" ? `Uploading… ${progress}%` : "Uploading…";
  else statusText = formatSize(sizeBytes);

  // Determinate bar width: the measured progress while uploading, or a
  // thin indeterminate sliver while queued (progress null).
  const hasBar = uploading && !uploadError;
  const barWidth = typeof progress === "number" ? `${progress}%` : "15%";

  return (
    <div className={cn(
      // min-w-0 + w-full so a long unbroken filename truncates inside the
      // chip instead of forcing the chip (and the whole TaskForm dialog)
      // to grow horizontally. relative + overflow-hidden so the progress
      // bar can pin to the bottom edge inside the rounded corners.
      "relative overflow-hidden flex items-center gap-2.5 w-full min-w-0 bg-white dark:bg-[#0c0c0c] border border-slate-200 dark:border-[#343434] rounded-lg px-2.5 py-2 group/att",
      uploadError && "border-red-300 dark:border-red-900"
    )}>
      {/* Thumbnail or icon */}
      {showImageThumb ? (
        <button
          type="button"
          onClick={() => attachment && onPreview && onPreview(attachment)}
          disabled={!attachment}
          className="shrink-0 w-10 h-10 rounded-md overflow-hidden bg-slate-100 dark:bg-[#161616] border border-slate-200 dark:border-[#343434] disabled:cursor-default"
          title={attachment ? "Preview" : undefined}
        >
          <img
            src={thumbnailUrl}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setThumbError(true)}
          />
        </button>
      ) : (
        <div className="shrink-0 w-10 h-10 rounded-md flex items-center justify-center bg-slate-100 dark:bg-[#161616] border border-slate-200 dark:border-[#343434]">
          {isImage && thumbError
            ? <ImageOff className="w-4 h-4 text-slate-400 dark:text-slate-500" />
            : isImage
              ? <ImageIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              : <FileText className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
        </div>
      )}

      {/* Filename + size or status */}
      <div className="flex-1 min-w-0">
        {attachment?.id ? (
          isImage ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (onPreview) onPreview(attachment); }}
              className="block w-full text-left text-sm font-medium text-slate-900 dark:text-slate-100 hover:underline truncate"
              title={`Preview ${filename}`}
            >
              {filename}
            </button>
          ) : (
            <a
              href={apiClient.attachments.urlFor(attachment.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm font-medium text-slate-900 dark:text-slate-100 hover:underline truncate"
              title={`Open ${filename}`}
              onClick={(e) => e.stopPropagation()}
            >
              {filename}
            </a>
          )
        ) : (
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate" title={filename}>
            {filename}
          </p>
        )}
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{statusText}</p>
      </div>

      {/* Right-side actions */}
      <div className="flex items-center gap-1 shrink-0">
        {offlineQueued && (
          <CloudOff className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        )}
        {uploadError && onRetry && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRetry(); }}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors p-1 -m-1 rounded"
            aria-label="Retry upload"
            title="Retry"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
        {uploading && !uploadError && !offlineQueued && (
          <Loader2 className="w-4 h-4 text-slate-400 dark:text-slate-500 animate-spin" />
        )}
        {attachment?.id && !uploading && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              triggerDownload(attachment);
            }}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors p-1 -m-1 rounded"
            aria-label={`Download ${filename}`}
            title="Download"
          >
            <Download className="w-4 h-4" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="text-slate-300 dark:text-slate-600 hover:text-red-400 dark:hover:text-red-300 transition-colors p-1 -m-1 rounded opacity-60 group-hover/att:opacity-100 focus:opacity-100"
            aria-label={`Remove ${filename}`}
            title="Remove"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Upload progress bar — pinned to the bottom edge inside the
          chip's rounded corners. Determinate width tracks bytes sent;
          while queued (progress null) it shows a thin sliver. */}
      {hasBar && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-100 dark:bg-[#222222]">
          <div
            className="h-full bg-slate-900 dark:bg-slate-100 transition-[width] duration-200 ease-out"
            style={{ width: barWidth }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Build a one-shot anchor element, dispatch a click on it, and clean
 * it up. Bypasses any weirdness around <a download> inside a <form>
 * (where some browsers delay the download until the form blurs).
 */
function triggerDownload(attachment) {
  if (!attachment?.id) return;
  const url = apiClient.attachments.urlFor(attachment.id, { download: true });
  const a = document.createElement("a");
  a.href = url;
  a.download = attachment.filename || "download";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
