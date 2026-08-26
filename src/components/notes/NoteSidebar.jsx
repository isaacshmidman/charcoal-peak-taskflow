// @ts-nocheck
/**
 * @file Left pane of /Notes — the note list, Apple Notes style. Pure
 * presentation: sorting, filtering and selection all live in the page.
 *
 * Notes carry no tags, priority or pin, so there is nothing to group by
 * and no sort to choose: most-recently-edited first is the whole
 * ordering. Search and New note live in the page header with every other
 * nav's, so this pane is only the list.
 */
import { Trash2 } from "lucide-react";
import { rowKey } from "@/lib/row-key";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import { useSwipeToDelete } from "@/hooks/useSwipeToDelete";
import { cn } from "@/lib/utils";

/** First non-empty line of the body, for the preview row. */
function previewOf(note) {
  const text = (note.content_text || "").trim();
  if (!text) return "No additional text";
  const firstLine = text.split("\n").find((line) => line.trim());
  return (firstLine || "").trim().slice(0, 120) || "No additional text";
}

/**
 * One row. Its own component because the swipe gesture is a hook and
 * hooks can't live in a loop — and because the swipe is the SAME hook
 * the task cards use, so the feel and the red reveal match exactly.
 */
function NoteRow({ note, active, onSelect, onDelete }) {
  const { ref, swipeX, swiping, willDelete, didSwipeRef } = useSwipeToDelete({
    onDelete: () => onDelete(note),
  });

  return (
    <li className="relative">
      {/* Red reveal behind the row, same treatment as a task card. */}
      {swiping && Math.abs(swipeX) > 20 && (
        <div
          className={cn(
            "absolute inset-0 rounded-lg flex items-center px-4 pointer-events-none z-0 transition-colors duration-100",
            willDelete ? "bg-red-500" : "bg-red-100 dark:bg-[#2a1116]",
            swipeX > 0 ? "justify-start" : "justify-end"
          )}
        >
          <Trash2 className={cn("w-4 h-4 transition-colors duration-100", willDelete ? "text-white" : "text-red-400")} />
        </div>
      )}
      <button
        ref={ref}
        type="button"
        // didSwipeRef distinguishes a swipe from a tap, so swiping a row
        // away never also opens it.
        onClick={() => { if (!didSwipeRef.current) onSelect(note.id); }}
        data-testid={`note-row-${note.id}`}
        data-active={active ? "true" : undefined}
        className={cn(
          // A visible hairline so each card's extent is obvious — without
          // it the rows ran together into one undifferentiated column.
          "relative z-10 w-full select-none rounded-lg border px-2.5 py-2 text-left",
          swiping ? "cursor-grabbing" : "cursor-pointer",
          active
            ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
            : "border-border-hairline bg-surface-card hover:bg-slate-50 dark:hover:bg-[#1c1c1c]"
        )}
        style={
          swiping
            ? { transform: `translateX(${swipeX}px)`, transition: "none" }
            : { transform: "translateX(0)", transition: "transform 0.2s ease" }
        }
      >
        <p
          className={cn(
            "truncate text-xs font-medium",
            active
              ? "text-white dark:text-slate-900"
              : note.title?.trim()
                ? "text-slate-900 dark:text-slate-100"
                : "text-slate-400 dark:text-slate-500"
          )}
        >
          {note.title?.trim() || "New Note"}
        </p>
        <p
          className={cn(
            "truncate text-[11px]",
            active ? "text-white/70 dark:text-slate-900/70" : "text-slate-400 dark:text-slate-500"
          )}
        >
          {previewOf(note)}
        </p>
        <p
          className={cn(
            "mt-0.5 text-[10px]",
            active ? "text-white/50 dark:text-slate-900/50" : "text-slate-300 dark:text-slate-600"
          )}
        >
          {note.updated_date ? formatDistanceToNow(new Date(note.updated_date), { addSuffix: true }) : ""}
        </p>
      </button>
    </li>
  );
}

export default function NoteSidebar({
  notes = [],
  activeId,
  onSelect,
  onDelete,
  search,
  isLoading,
  className,
  style,
}) {
  return (
    <aside
      style={style}
      className={cn("h-full min-h-0 w-full flex-col border-border-hairline sm:shrink-0", className)}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="space-y-1.5 px-1 pt-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100 dark:bg-[#1a1a1a]" />
            ))}
          </div>
        ) : notes.length === 0 ? (
          <p className="px-2 pt-6 text-center text-xs text-slate-400 dark:text-slate-500">
            {search ? "Nothing matches." : "A quiet page. Write anything."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {notes.map((note) => (
              <NoteRow
                key={rowKey(note)}
                note={note}
                active={note.id === activeId}
                onSelect={onSelect}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
