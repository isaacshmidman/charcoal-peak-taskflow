// @ts-nocheck
/**
 * @file Calendar page filtering + visibility state hook. Owns:
 *   - hiddenCalendars Set (persisted to localStorage)
 *   - calendarsList memo (derived from the task list)
 *   - viewRange memo (start/end Date for the active view)
 *   - filteredTasks memo (search + visibility + multi-sort + time
 *     tiebreaker)
 *   - scopedCount memo (count within the active viewRange)
 */
import { useMemo, useState } from "react";
import {
  endOfMonth,
} from "date-fns/endOfMonth";
import { endOfWeek } from "date-fns/endOfWeek";
import { endOfYear } from "date-fns/endOfYear";
import { isWithinInterval } from "date-fns/isWithinInterval";
import { startOfDay } from "date-fns/startOfDay";
import { startOfMonth } from "date-fns/startOfMonth";
import { startOfWeek } from "date-fns/startOfWeek";
import { startOfYear } from "date-fns/startOfYear";
import { deriveCalendars } from "@/components/calendar/CalendarVisibilityDropdown";
import { calendarKeyForTask } from "@/lib/calendar-order";
import {
  compareDueDateTime,
  compareTaskTime,
} from "@/lib/sort-helpers";

export function useCalendarFilters({ tasks, view, anchorDate, search, sorts, priorityOrderMap }) {
  const [hiddenCalendars, setHiddenCalendars] = useState(() => {
    try {
      const raw = localStorage.getItem("calendar_hidden_calendars");
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  });

  const handleHiddenCalendarsChange = (next) => {
    setHiddenCalendars(next);
    try {
      localStorage.setItem("calendar_hidden_calendars", JSON.stringify([...next]));
    } catch {}
  };

  const calendarsList = useMemo(() => deriveCalendars(tasks), [tasks]);

  const viewRange = useMemo(() => {
    if (view === "day") return { start: startOfDay(anchorDate), end: startOfDay(anchorDate) };
    if (view === "week") {
      return {
        start: startOfWeek(anchorDate, { weekStartsOn: 0 }),
        end: endOfWeek(anchorDate, { weekStartsOn: 0 }),
      };
    }
    if (view === "month") {
      return { start: startOfMonth(anchorDate), end: endOfMonth(anchorDate) };
    }
    return { start: startOfYear(anchorDate), end: endOfYear(anchorDate) };
  }, [view, anchorDate]);

  // Apply search + user sorts + time tiebreaker.
  const compareFn = (a, b, sortValue) => {
    const pa = priorityOrderMap[a.priority_id] ?? 99;
    const pb = priorityOrderMap[b.priority_id] ?? 99;
    const ta = a.tags?.[0] || "";
    const tb = b.tags?.[0] || "";
    const ra = a.task_type === "recurring" ? a.recurrence || "" : "";
    const rb = b.task_type === "recurring" ? b.recurrence || "" : "";
    switch (sortValue) {
      case "priority_asc": return pa - pb;
      case "priority_desc": return pb - pa;
      case "date_asc": return compareDueDateTime(a, b, "asc");
      case "date_desc": return compareDueDateTime(a, b, "desc");
      case "tag_az":
        if (!ta && tb) return 1;
        if (ta && !tb) return -1;
        return ta.localeCompare(tb);
      case "recurrence":
        if (!ra && rb) return 1;
        if (ra && !rb) return -1;
        return ra.localeCompare(rb);
      case "completed_first":
        return (a.status === "done" ? 0 : 1) - (b.status === "done" ? 0 : 1);
      case "uncompleted_first":
        return (a.status !== "done" ? 0 : 1) - (b.status !== "done" ? 0 : 1);
      case "all_day_first": {
        // "All-day" = no task_time set. We compare 0/1 booleans so all-day
        // sorts ahead of timed; timed-vs-timed ties fall through to other
        // sorts (and ultimately the time tiebreaker after this switch).
        const aAllDay = !a.task_time ? 0 : 1;
        const bAllDay = !b.task_time ? 0 : 1;
        return aAllDay - bAllDay;
      }
      case "all_day_last": {
        const aAllDay = !a.task_time ? 1 : 0;
        const bAllDay = !b.task_time ? 1 : 0;
        return aAllDay - bAllDay;
      }
      case "none":
      default: return 0;
    }
  };

  const filteredTasks = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = tasks.filter((t) => {
      if (t.parent_id) return false;
      // Hide tasks belonging to a calendar the user has un-checked in
      // the visibility dropdown.
      if (hiddenCalendars.size > 0 && hiddenCalendars.has(calendarKeyForTask(t))) {
        return false;
      }
      if (!q) return true;
      return (
        t.title?.toLowerCase().includes(q) ||
        t.tags?.some((tag) => tag.toLowerCase().includes(q))
      );
    });
    const sorted = [...filtered].sort((a, b) => {
      for (const sv of sorts) {
        const r = compareFn(a, b, sv);
        if (r !== 0) return r;
      }
      return compareTaskTime(a.task_time, b.task_time, "asc");
    });
    return sorted;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, search, sorts, priorityOrderMap, hiddenCalendars]);

  const scopedCount = useMemo(() => {
    if (!filteredTasks?.length) return 0;
    return filteredTasks.filter((t) => {
      if (!t.due_date) return false;
      const d = new Date(t.due_date + "T00:00:00");
      return isWithinInterval(d, viewRange);
    }).length;
  }, [filteredTasks, viewRange]);

  return {
    hiddenCalendars,
    setHiddenCalendars: handleHiddenCalendarsChange,
    calendarsList,
    viewRange,
    filteredTasks,
    scopedCount,
  };
}
