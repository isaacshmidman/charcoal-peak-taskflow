// @ts-nocheck
/**
 * @file Click-to-zoom lightbox for image attachments. Renders an
 * overlay with the original-resolution image scaled to fit, plus
 * Escape-to-close + click-backdrop-to-close.
 *
 * Props:
 *   @param {{ id: string, filename: string } | null} attachment
 *   @param {() => void} onClose
 */
import { useEffect } from "react";
import { X } from "lucide-react";
import { apiClient } from "@/api/apiClient";

export default function AttachmentLightbox({ attachment, onClose }) {
  useEffect(() => {
    if (!attachment) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    // Prevent the body from scrolling while the lightbox is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [attachment, onClose]);

  if (!attachment) return null;

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
      <img
        src={apiClient.attachments.urlFor(attachment.id)}
        alt={attachment.filename}
        className="max-w-full max-h-full rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
