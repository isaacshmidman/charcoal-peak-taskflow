// @ts-nocheck
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Dropdown letting the user hide/show specific calendars (Zephyrly,
 * Google calendars, Apple calendars) in the Calendar nav. Stored as a
 * Set of "hidden keys" in localStorage so the default — all visible —
 * stays cheap and forgiving (an unknown calendar key is implicitly
 * visible). Used to filter tasks in Calendar.jsx and any nav that
 * surfaces external events.
 *
 * Calendar key format:
 *   - Zephyrly-native task (no source_calendar_id): "zephyrly"
 *   - External:                                      "{provider}:{calId}"
 *
 * @param {{
 *   calendars: Array<{ key: string, label: string, color?: string }>,
 *   hidden: Set<string>,
 *   onChange: (next: Set<string>) => void,
 * }} props
 */
export default function CalendarVisibilityDropdown({ calendars, hidden, onChange }) {
  const allShown = hidden.size === 0;
  const someHidden = hidden.size > 0 && hidden.size < calendars.length;

  const toggle = (key) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  const showAll = () => onChange(new Set());
  const hideAll = () => onChange(new Set(calendars.map((c) => c.key)));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-9 w-9 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200",
            !allShown && "text-slate-700 dark:text-slate-200"
          )}
          title="Show / hide calendars"
          aria-label="Show / hide calendars"
        >
          {allShown ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-2">
        <div className="flex items-center justify-between px-1.5 pb-1.5 border-b border-slate-100 dark:border-slate-800">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Calendars</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={showAll}
              className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              All
            </button>
            <button
              type="button"
              onClick={hideAll}
              className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              None
            </button>
          </div>
        </div>
        {calendars.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-slate-500 px-2 py-3 text-center">
            No calendars to filter.
          </p>
        ) : (
          <ul className="max-h-72 overflow-y-auto pt-1">
            {calendars.map((c) => {
              const isHidden = hidden.has(c.key);
              return (
                <li key={c.key}>
                  <label
                    className="flex items-center gap-2 px-1.5 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => toggle(c.key)}
                      className="h-3.5 w-3.5 accent-slate-700"
                    />
                    {c.color ? (
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm shrink-0 border border-slate-200 dark:border-slate-700"
                        style={{ backgroundColor: c.color }}
                        aria-hidden
                      />
                    ) : null}
                    <span className="text-xs text-slate-700 dark:text-slate-200 truncate flex-1 min-w-0">
                      {c.label}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Build the unique-calendars list from tasks. Skipping subtasks. Stable
 * order: Zephyrly first, then external grouped by provider, alpha within.
 */
export function deriveCalendars(tasks) {
  const map = new Map();
  for (const t of tasks || []) {
    if (t.parent_id) continue;
    const calId = t.source_calendar_id || "";
    const provider = t.source_provider || "";
    const key = calId ? `${provider}:${calId}` : "zephyrly";
    if (map.has(key)) continue;
    if (!calId) {
      map.set(key, { key, label: "Zephyrly", color: "" });
    } else {
      map.set(key, {
        key,
        label: t.source_calendar_name || calId,
        color: t.source_color_hex || "",
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === "zephyrly") return -1;
    if (b.key === "zephyrly") return 1;
    return a.label.localeCompare(b.label);
  });
}

export function calendarKeyForTask(task) {
  const calId = task.source_calendar_id || "";
  const provider = task.source_provider || "";
  return calId ? `${provider}:${calId}` : "zephyrly";
}
