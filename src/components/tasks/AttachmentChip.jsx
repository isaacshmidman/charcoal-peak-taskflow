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
import { FileText, Image as ImageIcon, Loader2, X } from "lucide-react";
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
  const thumbnailUrl = attachment?.id
    ? apiClient.attachments.urlFor(attachment.id)
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
          <a
            href={apiClient.attachments.urlFor(attachment.id, { download: true })}
            download={attachment.filename}
            className="block text-sm font-medium text-slate-900 dark:text-slate-100 hover:underline truncate"
            title={attachment.filename}
            onClick={(e) => e.stopPropagation()}
          >
            {filename}
          </a>
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

      {/* Status / remove */}
      {uploading ? (
        <Loader2 className="w-4 h-4 text-slate-400 dark:text-slate-500 animate-spin shrink-0" />
      ) : (
        onDelete && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="shrink-0 text-slate-300 dark:text-slate-600 hover:text-red-400 dark:hover:text-red-300 transition-colors opacity-0 group-hover/att:opacity-100 focus:opacity-100"
            aria-label="Remove attachment"
          >
            <X className="w-4 h-4" />
          </button>
        )
      )}
    </div>
  );
}
