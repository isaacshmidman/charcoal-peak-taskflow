// @ts-check
/**
 * @file Task → Google Calendar event-resource serialization, plus the
 * time helpers it depends on. Pure functions — no DB access, no HTTP.
 * Called by the Google branch of the runner (push/google.js) and by
 * the backfill-pushes one-shot script.
 */
import { taskToRruleLine } from "../recurrence-rrule.js";

/**
 * Build a Google Calendar event resource from a Task row. Returns null if
 * the task has no due_date (i.e. isn't on a calendar).
 *
 * @param {any} task
 * @param {string} timeZone — IANA tz for timed events
 * @param {string} [colorId] optional Google colorId override
 */
export function taskToEventBody(task, timeZone, colorId) {
  if (!task || !task.due_date) return null;

  const summary = String(task.title || "(Untitled task)").slice(0, 200);
  const description = String(task.description || "").slice(0, 5000);

  // Native recurrence → RFC 5545 RRULE. Google's REST shape expects the
  // RRULE in the `recurrence` array (one or more lines, each starting with
  // the property name). Unsupported imported recurrence rules still
  // round-trip through source_recurrence_rule; supported/native fields win.
  const rruleLine = taskToRruleLine(task);
  const recurrence = rruleLine ? [rruleLine] : undefined;

  // Optional priority-derived color. Google has a fixed palette of 11
  // colorIds (1..11); see priority-color.js for the Zephyrly→Google
  // mapping. Omit the field entirely when no priority/no mapping so the
  // event picks up the calendar's default color, not a hard-coded one.
  const colorField = colorId ? { colorId: String(colorId) } : {};
  const zephyrlyMetadata = task.id
    ? {
        extendedProperties: {
          private: {
            zephyrlyTaskId: String(task.id),
            zephyrlyAppId: String(task.app_id || ""),
          },
        },
      }
    : {};

  // All-day event — Google expects end.date to be exclusive (next day).
  if (!task.task_time) {
    return {
      summary,
      description,
      start: { date: task.due_date },
      end: { date: addOneDay(task.due_date) },
      ...(recurrence ? { recurrence } : {}),
      ...colorField,
      ...zephyrlyMetadata,
    };
  }

  const startMins = parseTaskTime(task.task_time);
  if (startMins == null) return null;
  const endParsed = parseTaskTime(task.task_end_time);
  const endMins = endParsed != null && endParsed > startMins
    ? endParsed
    : startMins + 60;
  const startDt = isoFromDateAndMinutes(task.due_date, startMins);
  const endDt = isoFromDateAndMinutes(task.due_date, endMins);
  if (!startDt || !endDt) return null;

  return {
    summary,
    description,
    start: { dateTime: startDt, timeZone },
    end: { dateTime: endDt, timeZone },
    ...(recurrence ? { recurrence } : {}),
    ...colorField,
    ...zephyrlyMetadata,
  };
}

export function addOneDay(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Convert a Zephyrly date + minutes-since-midnight into a floating ISO
 * wall-clock string. We emit no offset and let Google interpret it via the
 * event's `timeZone` field.
 */
export function isoFromDateAndMinutes(ymd, minutes) {
  const [y, m, d] = ymd.split("-").map(Number);
  if (![y, m, d].every(Number.isFinite)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d, 0, minutes));
  // Format: "YYYY-MM-DDTHH:MM:00" (no tz suffix — Google uses event.timeZone).
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:00`;
}

/**
 * Parse "H:MMAM|PM" → minutes since midnight. Matches the frontend helper
 * but we duplicate it here so the backend doesn't depend on /src.
 */
export function parseTaskTime(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ampm = m[3].toUpperCase();
  if (h === 12) h = 0;
  if (ampm === "PM") h += 12;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}
