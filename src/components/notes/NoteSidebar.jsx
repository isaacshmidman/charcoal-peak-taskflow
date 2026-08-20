// @ts-nocheck
/**
 * @file Left pane of /Notes — the note list, Apple Notes style. Pure
 * presentation: sorting, filtering and selection all live in the page.
 *
 * Notes carry no tags, priority or pin any more, so there is nothing to
 * group by and no sort to choose: most-recently-edited first is the whole
 * ordering.
 */
import { Plus, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** First non-empty line of the body, for the preview row. */
function previewOf(note) {
  const text = (note.content_text || "").trim();
  if (!text) return "No additional text";
  const firstLine = text.split("\n").find((line) => line.trim());
  return (firstLine || "").trim().slice(0, 120) || "No additional text";
}

export default function NoteSidebar({
  notes = [],
  activeId,
  onSelect,
  onNew,
  search,
  onSearchChange,
  isLoading,
  className,
  style,
}) {
  return (
    <aside
      style={style}
      className={cn("h-full min-h-0 w-full flex-col border-border-hairline sm:shrink-0", className)}
    >
      <div className="flex items-center gap-2 px-3 pb-2 pt-1">
        <div className="relative flex-1 min-w-0">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search"
            data-testid="note-search"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Button
          onClick={onNew}
          size="icon"
          aria-label="New note"
          title="New note"
          data-testid="new-note-button"
          className="h-8 w-8 shrink-0 bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
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
          <ul className="space-y-0.5">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => onSelect(note.id)}
                  data-testid={`note-row-${note.id}`}
                  data-active={note.id === activeId ? "true" : undefined}
                  className={cn(
                    "w-full rounded-lg px-2.5 py-2 text-left transition-colors",
                    note.id === activeId
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "hover:bg-slate-100 dark:hover:bg-[#1c1c1c]"
                  )}
                >
                  <p
                    className={cn(
                      "truncate text-xs font-medium",
                      note.id === activeId
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
                      note.id === activeId
                        ? "text-white/70 dark:text-slate-900/70"
                        : "text-slate-400 dark:text-slate-500"
                    )}
                  >
                    {previewOf(note)}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-[10px]",
                      note.id === activeId
                        ? "text-white/50 dark:text-slate-900/50"
                        : "text-slate-300 dark:text-slate-600"
                    )}
                  >
                    {note.updated_date
                      ? formatDistanceToNow(new Date(note.updated_date), { addSuffix: true })
                      : ""}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
