/**
 * Shared comparators so date-based sorts across pages consistently fall back
 * to `task_time` as a tiebreaker. Before this existed, `date_asc`/`date_desc`
 * only looked at `due_date` (yyyy-mm-dd) which meant two tasks on the same
 * day with different times sorted arbitrarily.
 */

/** @typedef {import("@/types/tasks").TaskRecord} TaskRecord */

/**
 * Parse a task_time string ("9:00AM", "11:45PM", "12:00AM") into minutes
 * since midnight. Returns null for empty / malformed input so callers can
 * distinguish "all-day" from timed.
 * @param {string | null | undefined} str
 * @returns {number | null}
 */
export function parseTaskTime(str) {
  if (!str || typeof str !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(str.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (hour === 12) hour = 0;
  if (meridiem === "PM") hour += 12;
  return hour * 60 + minute;
}

/**
 * Compare two task_time strings. Null/empty sorts AFTER timed entries
 * in both directions — all-day tasks drop to the end of the day's stack
 * so the time-ordered list is visually continuous.
 * @param {string | null | undefined} ta
 * @param {string | null | undefined} tb
 * @param {"asc" | "desc"} [direction]
 * @returns {number}
 */
export function compareTaskTime(ta, tb, direction = "asc") {
  const a = parseTaskTime(ta);
  const b = parseTaskTime(tb);
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return direction === "asc" ? a - b : b - a;
}

/**
 * Compare two tasks by (due_date, task_time). Tasks without a due_date
 * sort to the end; within a day, timed tasks precede all-day tasks (asc).
 * @param {TaskRecord} a
 * @param {TaskRecord} b
 * @param {"asc" | "desc"} [direction]
 * @returns {number}
 */
export function compareDueDateTime(a, b, direction = "asc") {
  const da = a?.due_date ? new Date(a.due_date + "T00:00:00").getTime() : null;
  const db = b?.due_date ? new Date(b.due_date + "T00:00:00").getTime() : null;
  if (da == null && db == null) return compareTaskTime(a?.task_time, b?.task_time, direction);
  if (da == null) return 1;
  if (db == null) return -1;
  if (da !== db) return direction === "asc" ? da - db : db - da;
  return compareTaskTime(a?.task_time, b?.task_time, direction);
}

/**
 * Next 15-minute boundary strictly after `now`. Used for defaulting
 * new-task start times in Day/Week views. e.g. 6:23 -> 6:30, 6:30 -> 6:45.
 * @param {Date} [now]
 * @returns {string}
 */
export function nextQuarterHour(now = new Date()) {
  const h = now.getHours();
  const m = now.getMinutes();
  const nextM = Math.ceil((m + 1) / 15) * 15;
  const totalH = h + Math.floor(nextM / 60);
  const finalM = nextM % 60;
  const h24 = totalH % 24;
  const ampm = h24 < 12 ? "AM" : "PM";
  const hour = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${hour}:${String(finalM).padStart(2, "0")}${ampm}`;
}

/**
 * Convert minutes-since-midnight to a canonical task_time string.
 * Inverse of parseTaskTime (wraps into [0, 24*60)).
 * @param {number} mins
 * @returns {string}
 */
export function minutesToTaskTime(mins) {
  const total = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const ampm = h24 < 12 ? "AM" : "PM";
  const hour = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${hour}:${String(m).padStart(2, "0")}${ampm}`;
}
