// @ts-check
/**
 * @file Overdue computation for the Overdue Tasks dialog. Pure; `now`
 * injected for tests. Overdue = top-level, not done, with a due_date
 * strictly before today, and a real task rather than a calendar event.
 *
 * That last clause carries weight: the dialog's one action rewrites
 * due_date, and for a provider-imported row that write pushes back and
 * MOVES THE REAL CALENDAR EVENT. So "not an event" is a safety boundary,
 * not a tidiness filter.
 *
 * `source_kind` is the authority. After the per-calendar Tasks/Events
 * setting (backend/sync/classify.js), `source_kind !== "event"` means
 * exactly: a Zephyrly-native task, or an item from a calendar the user
 * deliberately marked as holding tasks. Callers additionally drop
 * user-hidden calendars — see Today.jsx.
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
