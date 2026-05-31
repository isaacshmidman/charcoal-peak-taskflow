// @ts-nocheck
/**
 * @file Click-to-zoom lightbox for image attachments. Renders an
 * overlay with the original-resolution image scaled to fit, plus
 * Escape-to-close + click-backdrop-to-close.
 *
 * Failure mode: if the original can't render (HEIC in Chrome, server
 * error, corrupt file…), the `<img>` fires `onError` and we swap to a
 * fallback panel with the filename + an "Open in new tab" link so the
 * user can at least try the browser's native viewer.
 *
 * Props:
 *   @param {{ id: string, filename: string, mime_type?: string } | null} attachment
 *   @param {() => void} onClose
 */
import { useEffect, useState } from "react";
import { ExternalLink, ImageOff, X } from "lucide-react";
import { apiClient } from "@/api/apiClient";

export default function AttachmentLightbox({ attachment, onClose }) {
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!attachment) return;
    // Fresh attachment → reset the error state so a previously-failed
    // image doesn't leave the next one stuck in error.
    setLoadError(false);
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [attachment, onClose]);

  if (!attachment) return null;

  const originalUrl = apiClient.attachments.urlFor(attachment.id);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={attachment.filename}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center"
        aria-label="Close preview"
      >
        <X className="w-5 h-5" />
      </button>

      {loadError ? (
        <div
          onClick={(e) => e.stopPropagation()}
          className="max-w-sm w-full bg-white dark:bg-[#161616] rounded-2xl p-6 text-center space-y-3 shadow-2xl"
        >
          <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 dark:bg-[#222222] flex items-center justify-center">
            <ImageOff className="w-6 h-6 text-slate-400 dark:text-slate-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 break-all">
              {attachment.filename}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              This browser can't preview the file inline
              {attachment.mime_type ? ` (${attachment.mime_type})` : ""}.
              Open it in a new tab instead.
            </p>
          </div>
          <a
            href={originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100 hover:underline"
          >
            <ExternalLink className="w-4 h-4" />
            Open {attachment.filename}
          </a>
        </div>
      ) : (
        <img
          src={originalUrl}
          alt={attachment.filename}
          className="max-w-full max-h-full rounded-lg shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          onError={() => setLoadError(true)}
        />
      )}
    </div>
  );
}
