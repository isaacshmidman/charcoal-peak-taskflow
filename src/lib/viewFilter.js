// @ts-check
/**
 * @file Saved-view filtering. Consolidates the title/tag search predicate
 * that Today/Active/Groupings each inline today, and adds the SavedView
 * predicates: tags (any-of), priorities (any-of), due window, status.
 *
 * A view's `filters` shape (stored as JSON on the SavedView entity):
 *   { tags?: string[], priority_ids?: string[],
 *     due?: "any"|"today"|"week"|"overdue"|"none", status?: "active"|"done"|"all" }
 * Absent/empty fields don't constrain. `now` is injected for tests.
 */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** The shared search predicate: case-insensitive title OR tag substring. */
export function taskMatchesQuery(task, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  if (String(task.title || "").toLowerCase().includes(q)) return true;
  return (task.tags || []).some((tag) => String(tag).toLowerCase().includes(q));
}

/**
 * @param {Record<string, any>} task
 * @param {Record<string, any>} filters
 * @param {{ now?: Date }} [options]
 */
export function taskMatchesView(task, filters = {}, { now = new Date() } = {}) {
  const { tags, priority_ids: priorityIds, due = "any", status = "active" } = filters;

  if (status === "active" && task.status === "done") return false;
  if (status === "done" && task.status !== "done") return false;

  if (Array.isArray(tags) && tags.length) {
    const taskTags = (task.tags || []).map((t) => String(t).toLowerCase());
    if (!tags.some((t) => taskTags.includes(String(t).toLowerCase()))) return false;
  }

  if (Array.isArray(priorityIds) && priorityIds.length) {
    if (!priorityIds.includes(task.priority_id)) return false;
  }

  if (due !== "any") {
    const today = dateStr(now);
    if (due === "none") return !task.due_date;
    if (!task.due_date) return false;
    if (due === "today") return task.due_date === today;
    if (due === "overdue") return task.due_date < today && task.status !== "done";
    if (due === "week") {
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
      return task.due_date >= today && task.due_date < dateStr(end);
    }
  }

  return true;
}

/** True when a filters object actually constrains anything. */
export function isEmptyViewFilters(filters = {}) {
  return (
    !(filters.tags && filters.tags.length) &&
    !(filters.priority_ids && filters.priority_ids.length) &&
    (!filters.due || filters.due === "any") &&
    (!filters.status || filters.status === "active")
  );
}
