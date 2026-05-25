// @ts-nocheck
/**
 * @file Calendar Order — auto-discovers calendars from the task list,
 * merges with the user's saved order (newcomers appended
 * alphabetically), and exposes per-calendar reorder + visibility-on-
 * non-calendar-pages.
 *
 * Renders nothing when no calendars are discovered (first-time user
 * with no Google/Apple integrations).
 *
 * The two settings owned here:
 *   - calendar order: localStorage `calendarOrder` (sort key on non-
 *     Calendar pages when user picks "Calendar Order" in MultiSort)
 *   - per-calendar visibility on non-Calendar pages (Today, Active,
 *     Completed, Groupings). The Calendar page itself has its own
 *     visibility dropdown — untouched here.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Eye, EyeOff } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { cn } from "@/lib/utils";
import { deriveCalendars } from "@/components/calendar/CalendarVisibilityDropdown";
import {
  getCalendarOrder,
  getHiddenOnNonCalendarPages,
  mergeOrder,
  setCalendarOrder,
  setHiddenOnNonCalendarPages,
} from "@/lib/calendar-order";

export default function CalendarOrderSection() {
  const { data: tasksForCalendars = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiClient.entities.Task.list("-created_date", 5000),
  });
  const discoveredCalendars = useMemo(
    () => deriveCalendars(tasksForCalendars),
    [tasksForCalendars]
  );
  const [calendarOrderState, setCalendarOrderState] = useState(getCalendarOrder);
  const [calendarHiddenState, setCalendarHiddenState] = useState(
    getHiddenOnNonCalendarPages
  );
  const orderedCalendars = useMemo(
    () => mergeOrder(discoveredCalendars, calendarOrderState),
    [discoveredCalendars, calendarOrderState]
  );

  const moveCalendar = (idx, dir) => {
    const next = [...orderedCalendars];
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= next.length) return;
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    const keys = next.map((c) => c.key);
    setCalendarOrderState(keys);
    setCalendarOrder(keys);
  };

  const toggleCalendarHidden = (key) => {
    const next = new Set(calendarHiddenState);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCalendarHiddenState(next);
    setHiddenOnNonCalendarPages(next);
  };

  if (orderedCalendars.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Calendar Order</h2>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">
        Reorder for sorting, and toggle visibility on non-Calendar pages
        (Today, All Tasks, etc.). The Calendar page has its own filter.
      </p>
      <div className="space-y-2">
        {orderedCalendars.map((c, idx) => {
          const isHidden = calendarHiddenState.has(c.key);
          return (
            <div
              key={c.key}
              className="flex items-center gap-3 bg-white dark:bg-[#111111] border border-slate-100 dark:border-[#303030] rounded-xl px-3 py-2.5 hover:border-slate-200 dark:hover:border-[#454545] transition-colors"
            >
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => moveCalendar(idx, -1)}
                  disabled={idx === 0}
                  className="disabled:opacity-20 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 transition-colors"
                  aria-label="Move up"
                >
                  <ArrowUp className="w-3 h-3" />
                </button>
                <button
                  onClick={() => moveCalendar(idx, 1)}
                  disabled={idx === orderedCalendars.length - 1}
                  className="disabled:opacity-20 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 transition-colors"
                  aria-label="Move down"
                >
                  <ArrowDown className="w-3 h-3" />
                </button>
              </div>
              {/* Solid round dot to mirror Priority Levels styling
                  below — visual consistency. */}
              <span
                className="inline-block w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: c.color || "#94a3b8" }}
                aria-hidden
              />
              <span className="text-sm font-medium text-slate-900 dark:text-slate-100 flex-1 min-w-0 truncate">
                {c.label}
              </span>
              <button
                onClick={() => toggleCalendarHidden(c.key)}
                className={cn(
                  "shrink-0 transition-colors",
                  isHidden
                    ? "text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400"
                    : "text-emerald-500 hover:text-emerald-600"
                )}
                title={isHidden ? "Hidden on non-Calendar pages" : "Visible on non-Calendar pages"}
                aria-label={isHidden ? "Show on non-Calendar pages" : "Hide on non-Calendar pages"}
              >
                {isHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
