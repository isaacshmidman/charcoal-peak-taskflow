// @ts-nocheck
/**
 * @file Single attachment row used by AttachmentsField. Two visual
 * modes:
 *   - image:   small square thumbnail (browser-scaled from the
 *              original; we don't generate server-side thumbnails in
 *              v1) + filename + size + remove X. Click thumbnail to
 *              open the lightbox.
 *   - file:    file-type icon + filename + size + remove X. Click
 *              filename to download.
 *
 * Props:
 *   @param {{
 *     attachment: { id: string, filename: string, mime_type: string,
 *                   size_bytes: number, is_image: boolean } | null,
 *     localFile?: File,           — only set for queued uploads (no id yet)
 *     uploading?: boolean,
 *     uploadError?: string | null,
 *     onPreview?: (a: any) => void,
 *     onDelete?: () => void,
 *   }} props
 */
import { useEffect, useState } from "react";
import { Download, FileText, Image as ImageIcon, Loader2, X } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { cn } from "@/lib/utils";

/** "1234567" → "1.2 MB" */
function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function AttachmentChip({ attachment, localFile, uploading, uploadError, onPreview, onDelete }) {
  // For a queued local file (no attachment id yet), make an object URL
  // so we can show a preview before the upload completes.
  const [localPreviewUrl, setLocalPreviewUrl] = useState(null);
  useEffect(() => {
    if (!localFile || !localFile.type?.startsWith("image/")) {
      setLocalPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(localFile);
    setLocalPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [localFile]);

  const isImage = attachment?.is_image || (localFile?.type?.startsWith("image/") ?? false);
  const filename = attachment?.filename || localFile?.name || "Attachment";
  const sizeBytes = attachment?.size_bytes ?? localFile?.size ?? 0;
  // Prefer the server-generated thumbnail URL when available (Pri 2).
  // Falls back to the original (backend serves it when no thumb exists),
  // or the local blob URL while an upload is pending.
  const thumbnailUrl = attachment?.id
    ? apiClient.attachments.urlFor(attachment.id, { thumb: true })
    : localPreviewUrl;

  return (
    <div className={cn(
      "flex items-center gap-2.5 bg-white dark:bg-[#0c0c0c] border border-slate-200 dark:border-[#343434] rounded-lg px-2.5 py-2 group/att",
      uploadError && "border-red-300 dark:border-red-900"
    )}>
      {/* Thumbnail or icon */}
      {isImage && thumbnailUrl ? (
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
            loading="lazy"
            className="w-full h-full object-cover"
          />
        </button>
      ) : (
        <div className="shrink-0 w-10 h-10 rounded-md flex items-center justify-center bg-slate-100 dark:bg-[#161616] border border-slate-200 dark:border-[#343434]">
          {isImage
            ? <ImageIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            : <FileText className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
        </div>
      )}

      {/* Filename + size or status */}
      <div className="flex-1 min-w-0">
        {attachment?.id ? (
          // Clicking the title PREVIEWS the file:
          //   - images open in the in-app lightbox (onPreview),
          //   - everything else opens in a new browser tab where the
          //     OS / browser renders it inline (PDFs, text, video, …).
          // Use <a> for non-images so right-click → "Open in new tab"
          // / "Save link as" continues to work as users expect.
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
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
          {uploading
            ? "Uploading…"
            : uploadError
              ? <span className="text-red-500 dark:text-red-300">{uploadError}</span>
              : formatSize(sizeBytes)}
        </p>
      </div>

      {/* Status / actions */}
      {uploading ? (
        <Loader2 className="w-4 h-4 text-slate-400 dark:text-slate-500 animate-spin shrink-0" />
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          {attachment?.id && (
            // Download is a primary, predictable action — always visible
            // so it works on touch devices too (where there's no hover).
            <a
              href={apiClient.attachments.urlFor(attachment.id, { download: true })}
              download={attachment.filename}
              onClick={(e) => e.stopPropagation()}
              className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors p-1 -m-1 rounded"
              aria-label={`Download ${filename}`}
              title="Download"
            >
              <Download className="w-4 h-4" />
            </a>
          )}
          {onDelete && (
            // Delete is destructive — keep it hover/focus-revealed on
            // desktop so it isn't a tap target by mistake; on touch the
            // chip itself doesn't need a hover state because the user
            // can also swipe... actually they can't here, so reveal on
            // press too via opacity:active.
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
      )}
    </div>
  );
}
