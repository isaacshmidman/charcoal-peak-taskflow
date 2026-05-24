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
