/**
 * Shared task filters that decide which records appear in which views.
 *
 * Calendar-imported "events" (Holidays, Birthdays, calendar appointments,
 * etc.) carry `source_kind === "event"`. They should be visible only in the
 * Calendar view — never in Today, Active (All Tasks), Groupings, Completed,
 * or Recently Deleted.
 */

/** @typedef {import("@/types/tasks").TaskRecord & { source_kind?: string | null }} TaskRecord */

/**
 * True when a record represents a non-task event imported from a provider.
 * @param {TaskRecord | null | undefined} record
 * @returns {boolean}
 */
export function isExternalEvent(record) {
  return !!record && record.source_kind === "event";
}

/**
 * Filter out external (provider) events. Safe to pass any iterable shape.
 * @template T
 * @param {T} records
 * @returns {T}
 */
export function excludeExternalEvents(records) {
  if (!Array.isArray(records)) return records;
  return /** @type {T} */ (records.filter((r) => !isExternalEvent(r)));
}

/**
 * Whether a task matches what's typed in a search box: its title, any tag,
 * or its description. Case-insensitive substring; a blank query matches
 * everything. One definition so every page searches the same fields —
 * before this, each page had its own copy and none looked at descriptions.
 *
 * Calendar imports can store HTML descriptions, so tags are flattened out
 * first; otherwise searching "b" or "div" would match markup.
 *
 * @param {TaskRecord | null | undefined} task
 * @param {string | null | undefined} query
 * @returns {boolean}
 */
export function taskMatchesSearch(task, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  if (!task) return false;
  if (String(task.title || "").toLowerCase().includes(q)) return true;
  if ((task.tags || []).some((tag) => String(tag).toLowerCase().includes(q))) return true;
  const description = String(task.description || "");
  if (!description) return false;
  return description.replace(/<[^>]*>/g, " ").toLowerCase().includes(q);
}
