// @ts-nocheck
/**
 * @file Files sub-page (Pri 5 of deferred attachment work) — search
 * every attachment across all the user's tasks by filename, and jump
 * to the parent task.
 *
 * Behavior:
 *   - Debounced search input (250ms). Empty query lists the most-recent
 *     attachments (a "browse all" view).
 *   - Each result: thumbnail (image) or file icon, filename, parent
 *     task title, size, and a download button.
 *   - Click an image's thumbnail → in-app lightbox.
 *   - Click any filename → navigate to /Calendar?task=<id>, which opens
 *     that task's edit form (same deep-link the notifications use).
 *
 * Read-only: deletion happens inside a task's own attachment list, not
 * here, to avoid accidental cross-task deletes from a search result.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Download, FileText, Image as ImageIcon, ImageOff, Loader2, Search } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import AttachmentLightbox from "@/components/tasks/AttachmentLightbox.jsx";

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Single search-result row with its own thumbnail-error fallback. */
function FileResultRow({ att, onPreview, onOpenTask }) {
  const [thumbError, setThumbError] = useState(false);
  const isImage = att.is_image;
  const showThumb = isImage && !thumbError;
  const thumbUrl = apiClient.attachments.urlFor(att.id, { thumb: true });

  const download = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const url = apiClient.attachments.urlFor(att.id, { download: true });
    const a = document.createElement("a");
    a.href = url;
    a.download = att.filename || "download";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <li className="flex items-center gap-3 px-3 py-2.5 min-w-0">
      {showThumb ? (
        <button
          type="button"
          onClick={() => onPreview(att)}
          className="shrink-0 w-10 h-10 rounded-md overflow-hidden bg-slate-100 dark:bg-[#161616] border border-slate-200 dark:border-[#343434]"
          title="Preview"
        >
          <img src={thumbUrl} alt="" className="w-full h-full object-cover" onError={() => setThumbError(true)} />
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

      <button
        type="button"
        onClick={() => onOpenTask(att.task_id)}
        className="flex-1 min-w-0 text-left"
        title={`Open “${att.task_title}”`}
      >
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate hover:underline">
          {att.filename}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">
          {att.task_title} · {formatSize(att.size_bytes)}
        </p>
      </button>

      <button
        type="button"
        onClick={download}
        className="shrink-0 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors p-1 -m-1 rounded"
        aria-label={`Download ${att.filename}`}
        title="Download"
      >
        <Download className="w-4 h-4" />
      </button>
    </li>
  );
}

export default function FilesSection() {
  const navigate = useNavigate();
  const [rawQuery, setRawQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [previewing, setPreviewing] = useState(null);
  const debounceRef = useRef(null);

  // Debounce the query so we don't fire a request per keystroke.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebounced(rawQuery.trim()), 250);
    return () => clearTimeout(debounceRef.current);
  }, [rawQuery]);

  const { data: results = [], isLoading, isFetching, error } = useQuery({
    queryKey: ["attachmentSearch", debounced],
    queryFn: () => apiClient.attachments.search(debounced),
  });

  const openTask = (taskId) => {
    // Same deep-link the notification click path uses — Calendar finds
    // the task in its full list and opens the edit form.
    navigate(`/Calendar?task=${encodeURIComponent(taskId)}`);
  };

  const heading = useMemo(
    () => (debounced ? `Results for “${debounced}”` : "Recent files"),
    [debounced]
  );

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
        <Input
          autoFocus
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          placeholder="Search files by name…"
          className="pl-9 h-10"
        />
      </div>

      {error ? (
        <p className="text-xs text-amber-600 dark:text-amber-300">
          Couldn't search files: {error.message || "network error"}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400">{heading}</h2>
            {isFetching && <Loader2 className="w-3 h-3 animate-spin text-slate-400 dark:text-slate-500" />}
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 px-1">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading…
            </div>
          ) : results.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 px-1">
              {debounced
                ? "No files match that name."
                : "No attachments yet. Drop a file into any task to see it here."}
            </p>
          ) : (
            <ul className="rounded-xl border border-slate-100 dark:border-[#303030] bg-white dark:bg-[#111111] divide-y divide-slate-100 dark:divide-[#303030] overflow-hidden">
              {results.map((att) => (
                <FileResultRow
                  key={att.id}
                  att={att}
                  onPreview={(a) => setPreviewing(a)}
                  onOpenTask={openTask}
                />
              ))}
            </ul>
          )}
        </>
      )}

      <AttachmentLightbox attachment={previewing} onClose={() => setPreviewing(null)} />
    </div>
  );
}
