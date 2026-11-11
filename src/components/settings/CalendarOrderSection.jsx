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
import { Eye, EyeOff } from "lucide-react";
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
import { ReorderButtons, SettingsSection } from "./parts";

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
    <SettingsSection
      label="Calendar order"
      footnote="The order used when you sort by calendar. The eye hides a calendar's tasks on Today, All Tasks and the other lists; the Calendar page has its own filter."
    >
      <div className="ds-list">
        {orderedCalendars.map((c, idx) => {
          const isHidden = calendarHiddenState.has(c.key);
          return (
            <div key={c.key} className="flex min-h-[2.75rem] items-center gap-3 py-1.5 pl-4 pr-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: c.color || "#94a3b8" }}
                aria-hidden
              />
              <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", isHidden ? "text-ink-400 dark:text-ink-500" : "text-ink-900 dark:text-ink-100")}>
                {c.label}
              </span>
              <button
                type="button"
                onClick={() => toggleCalendarHidden(c.key)}
                className={cn(
                  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-ink-100 dark:hover:bg-night-high",
                  isHidden
                    ? "text-ink-300 hover:text-ink-700 dark:text-ink-600 dark:hover:text-ink-200"
                    : "text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-ink-100"
                )}
                title={isHidden ? "Hidden on the list pages" : "Shown on the list pages"}
                aria-label={isHidden ? `Show ${c.label} on the list pages` : `Hide ${c.label} on the list pages`}
                aria-pressed={!isHidden}
              >
                {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <ReorderButtons
                name={c.label}
                onUp={() => moveCalendar(idx, -1)}
                onDown={() => moveCalendar(idx, 1)}
                first={idx === 0}
                last={idx === orderedCalendars.length - 1}
              />
            </div>
          );
        })}
      </div>
    </SettingsSection>
  );
}
