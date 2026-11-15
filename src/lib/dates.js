// @ts-check
/**
 * @file Small date-string helpers shared across calendar + task UI.
 * Canonical replacement for the 6 inline copies that lived next to
 * each consumer before Phase 5. Wraps `date-fns/format` and a
 * local-time Date constructor so a "yyyy-MM-dd" string round-trips
 * cleanly without sliding by a day across timezones.
 */
import { format } from "date-fns/format";

/**
 * @param {Date} date
 * @returns {string} yyyy-MM-dd in local time
 */
export const toDateStr = (date) => format(date, "yyyy-MM-dd");

/**
 * @param {string} str  A "yyyy-MM-dd" string
 * @returns {Date}  Local-midnight Date for that date
 */
export const fromDateStr = (str) => new Date(str + "T00:00:00");

/** "9:00AM" → "9:00 AM", for reading. The stored value keeps no space. */
const spaced = (time) => String(time || "").replace(/\s*(AM|PM)$/i, " $1");

/**
 * A day the way a person would say it: Today, Tomorrow, Yesterday, the
 * weekday for the rest of the coming week, otherwise the date (with its
 * year only when that isn't this one).
 *
 * @param {string | null | undefined} dateStr  "yyyy-MM-dd"
 * @param {Date} [now]  injectable for tests
 * @returns {string} "" when there is no readable date
 */
export function dayLabel(dateStr, now = new Date()) {
  if (!dateStr) return "";
  const date = fromDateStr(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Rounded, so a day made 23 or 25 hours long by the clocks changing still counts as one.
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 7) return format(date, "EEE");
  return format(date, date.getFullYear() === today.getFullYear() ? "MMM d" : "MMM d, yyyy");
}

/**
 * A task's day and time for the end of its row. Today with a time is
 * just the time: on a list of today's tasks "Today" on every row says
 * nothing.
 *
 * @param {string | null | undefined} dateStr
 * @param {string | null | undefined} time  as stored, "9:00AM"
 * @param {Date} [now]
 */
export function dayTimeLabel(dateStr, time, now = new Date()) {
  const day = dayLabel(dateStr, now);
  if (!day || !time) return day;
  return day === "Today" ? spaced(time) : `${day}, ${spaced(time)}`;
}
