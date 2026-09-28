// @ts-check
/**
 * @file How task lists sort. Today, All Tasks, Groupings and the Calendar
 * each had their own copy of this comparator — identical in behaviour, so
 * a fix to one would silently miss the rest. They all use this now.
 *
 * Completed (lib/completedItems.js) and Recently Deleted (lib/trash-sort.js)
 * are NOT this: they sort differently shaped records, with their own date
 * rules (completion time, deletion time), so they keep their own.
 */
import { compareDueDateTime } from "@/lib/sort-helpers";
import { compareByCalendarOrder } from "@/lib/calendar-order";

/**
 * @typedef {{
 *   priorityOrderMap?: Record<string, number>,
 *   calendarIndexByKey?: Map<string, number> | null,
 * }} TaskSortContext
 */

/**
 * Compare two tasks on one sort key. Unknown keys and "none" compare equal.
 *
 * @param {any} a
 * @param {any} b
 * @param {string} key
 * @param {TaskSortContext} [ctx]
 * @returns {number}
 */
export function compareTasks(a, b, key, { priorityOrderMap = {}, calendarIndexByKey = null } = {}) {
  switch (key) {
    case "priority_asc":
    case "priority_desc": {
      const pa = priorityOrderMap[a.priority_id] ?? 99;
      const pb = priorityOrderMap[b.priority_id] ?? 99;
      return key === "priority_asc" ? pa - pb : pb - pa;
    }
    case "date_asc":
      return compareDueDateTime(a, b, "asc");
    case "date_desc":
      return compareDueDateTime(a, b, "desc");
    case "tag_az":
      return blanksLast(a.tags?.[0] || "", b.tags?.[0] || "");
    case "recurrence":
      return blanksLast(recurrenceOf(a), recurrenceOf(b));
    case "completed_first":
      return (a.status === "done" ? 0 : 1) - (b.status === "done" ? 0 : 1);
    case "uncompleted_first":
      return (a.status !== "done" ? 0 : 1) - (b.status !== "done" ? 0 : 1);
    case "calendar_order":
      return calendarIndexByKey ? compareByCalendarOrder(a, b, calendarIndexByKey) : 0;
    case "all_day_first":
      return (a.task_time ? 1 : 0) - (b.task_time ? 1 : 0);
    case "all_day_last":
      return (a.task_time ? 0 : 1) - (b.task_time ? 0 : 1);
    case "none":
    default:
      return 0;
  }
}

/**
 * Compare on each key in turn until one tells them apart.
 *
 * @param {any} a
 * @param {any} b
 * @param {string[]} sorts
 * @param {TaskSortContext} [ctx]
 */
export function compareTasksBy(a, b, sorts, ctx) {
  for (const key of sorts) {
    const result = compareTasks(a, b, key, ctx);
    if (result !== 0) return result;
  }
  return 0;
}

/** @param {any} task */
function recurrenceOf(task) {
  return task.task_type === "recurring" ? task.recurrence || "" : "";
}

/**
 * Alphabetical, with blanks after everything else.
 * @param {string} x
 * @param {string} y
 */
function blanksLast(x, y) {
  if (!x && y) return 1;
  if (x && !y) return -1;
  return x.localeCompare(y);
}
