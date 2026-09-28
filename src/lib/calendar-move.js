// @ts-check
/**
 * @file What a calendar move or resize changed, and how to say it — for
 * the "Moved … · Undo" toast. Pure, so the wording and the undo patch are
 * tested without a calendar.
 */
import { format } from "date-fns/format";

const MOVE_FIELDS = /** @type {const} */ (["due_date", "task_time", "task_end_time"]);

/**
 * The fields a move would actually change, with their values before and
 * after. Empty when nothing changes (e.g. dropped back where it was).
 *
 * @param {any} task
 * @param {Record<string, string>} patch
 * @returns {{ before: Record<string, string>, after: Record<string, string> }}
 */
export function moveChanges(task, patch) {
  /** @type {Record<string, string>} */
  const before = {};
  /** @type {Record<string, string>} */
  const after = {};
  for (const field of MOVE_FIELDS) {
    if (!(field in patch)) continue;
    const was = task?.[field] ?? "";
    const now = patch[field] ?? "";
    if (was !== now) {
      before[field] = was;
      after[field] = now;
    }
  }
  return { before, after };
}

/** "2:00PM" → "2:00 PM". */
const friendlyTime = (time) => String(time).replace(/(AM|PM)$/i, " $1");

/** @param {string} dateStr */
const friendlyDate = (dateStr) => format(new Date(`${dateStr}T00:00:00`), "EEE, MMM d");

/**
 * The toast line for a move, e.g. Moved “Standup” to Thu, Sep 24 at 2:00 PM.
 *
 * @param {any} task
 * @param {Record<string, string>} after  the changed fields (moveChanges().after)
 */
export function describeMove(task, after) {
  const rawTitle = String(task?.title || "Task");
  const title = `“${rawTitle.length > 32 ? `${rawTitle.slice(0, 31)}…` : rawTitle}”`;
  const date = after.due_date ?? task?.due_date ?? "";
  const time = "task_time" in after ? after.task_time : task?.task_time || "";

  // Only the end moved: a resize.
  if (Object.keys(after).length === 1 && "task_end_time" in after) {
    return `${title} now ends ${friendlyTime(after.task_end_time)}`;
  }
  if ("task_time" in after && !after.task_time) {
    return `Moved ${title} to all day ${friendlyDate(date)}`;
  }
  return time
    ? `Moved ${title} to ${friendlyDate(date)} at ${friendlyTime(time)}`
    : `Moved ${title} to ${friendlyDate(date)}`;
}
