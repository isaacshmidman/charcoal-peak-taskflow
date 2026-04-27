// @ts-nocheck
/**
 * Shared task filters that decide which records appear in which views.
 *
 * Calendar-imported "events" (Holidays, Birthdays, calendar appointments,
 * etc.) carry `source_kind === "event"`. They should be visible only in the
 * Calendar view — never in Today, Active (All Tasks), Groupings, Completed,
 * or Recently Deleted.
 */

/** True when a record represents a non-task event imported from a provider. */
export function isExternalEvent(record) {
  return !!record && record.source_kind === "event";
}

/** Filter out external (provider) events. Safe to pass any iterable shape. */
export function excludeExternalEvents(records) {
  if (!Array.isArray(records)) return records;
  return records.filter((r) => !isExternalEvent(r));
}
