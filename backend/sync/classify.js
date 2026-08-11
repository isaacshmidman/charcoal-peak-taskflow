// @ts-check
/**
 * @file Decides whether an imported calendar item lands in Zephyrly as a
 * task or as a read-only event. ONE rule, shared by every provider —
 * Google and Apple previously each carried their own heuristic and drifted.
 *
 * The rule is the user's, not a guess. Google Calendar has no field that
 * says "this is a task", so guessing from the event's shape (all-day vs
 * timed, has guests, etc.) always misfires for somebody. Instead the
 * choice lives on the calendar: Settings → Configure calendars marks each
 * one Tasks or Events (`integration_calendars.item_kind`).
 *
 * Default is 'event'. A calendar contributes tasks only when it has been
 * deliberately opted in, which is what stops a connected account from
 * dumping every past meeting into the Overdue list.
 */
import { isWritableCalendar } from "../integrations/serialize.js";

/**
 * Google `eventType` values that are never a to-do, whatever the calendar
 * says. A birthday sitting on your task calendar is still a birthday.
 * Apple has no equivalent field and passes undefined, which reads as
 * "default" — the calendar's own kind then decides.
 */
const NEVER_TASK_EVENT_TYPES = new Set([
  "birthday",
  "fromGmail",
  "outOfOffice",
  "focusTime",
  "workingLocation",
]);

/**
 * @param {any} calendarRow  an integration_calendars row
 * @param {{ eventType?: string }} [event]
 * @returns {"task" | "event"}
 */
export function classifyCalendarItem(calendarRow, { eventType } = {}) {
  // No calendar row means we can't know the user's choice — assume event,
  // the safe side (events are read-only and never reach the date mover).
  if (!calendarRow) return "event";

  const type = String(eventType || "default");
  if (NEVER_TASK_EVENT_TYPES.has(type)) return "event";

  // Read-only calendars can never hold tasks: completing or re-dating a
  // task pushes the change back to the provider, and we have no write
  // access here. The API rejects marking these as Tasks; this is the
  // matching guard on the read path.
  if (!isWritableCalendar(calendarRow)) return "event";

  return calendarRow.item_kind === "task" ? "task" : "event";
}
