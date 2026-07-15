// @ts-check
/**
 * @file Overdue computation for the Overdue Tasks dialog. Pure; `now`
 * injected for tests. Overdue = top-level, ours (not an imported calendar
 * event), not done, with a due_date strictly before today.
 */
import { isExternalEvent } from "@/lib/task-filters";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * @param {Array<Record<string, any>>} tasks
 * @param {{ now?: Date }} [options]
 * @returns {Array<Record<string, any>>}
 */
export function computeOverdue(tasks, { now = new Date() } = {}) {
  const today = dateStr(now);
  return tasks.filter(
    (t) => !t.parent_id && !isExternalEvent(t) && t.status !== "done" && t.due_date && t.due_date < today
  );
}
