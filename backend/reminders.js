// @ts-check
/**
 * @file A task's own reminder, stored as one short string in
 * `tasks.reminder`:
 *
 *   ""                  use the account's notification settings (default)
 *   "none"              never remind for this task
 *   "before:<minutes>"  timed task: this many minutes before its start
 *                       (0 = at the start); replaces the account offset
 *   "at:<9:00AM>"       all-day task: at this time of day; replaces the
 *                       account's all-day time, and fires even if the
 *                       account's all-day reminders are off
 *
 * Anything unrecognised reads as the default, so a bad value can never
 * silence or misfire a reminder.
 */
import { parseTaskTime } from "./push/shape.js";

export const MAX_BEFORE_MINUTES = 7 * 24 * 60;

/**
 * @typedef {{ kind: "default" } | { kind: "none" } | { kind: "before", minutes: number } | { kind: "at", minutes: number }} ReminderRule
 */

/**
 * @param {unknown} value
 * @returns {ReminderRule}
 */
export function parseReminder(value) {
  const text = String(value ?? "").trim();
  if (text === "none") return { kind: "none" };
  const before = /^before:(\d{1,5})$/.exec(text);
  if (before) {
    const minutes = Number(before[1]);
    if (minutes <= MAX_BEFORE_MINUTES) return { kind: "before", minutes };
  }
  const at = /^at:(.+)$/.exec(text);
  if (at) {
    const minutes = parseTaskTime(at[1]);
    if (minutes != null) return { kind: "at", minutes };
  }
  return { kind: "default" };
}
