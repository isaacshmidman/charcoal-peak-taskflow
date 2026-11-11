// @ts-check
/**
 * @file Reading a calendar's whole window, once a day.
 *
 * The first read of a calendar takes 30 days back and 90 days ahead, so
 * connecting an account doesn't pour years of events into the task list.
 * After that, sync only asks "what changed?". Put together, those two leave
 * a hole: an event that already existed further than 90 days ahead when
 * the calendar was connected is never mentioned again unless somebody
 * edits it, so it never shows up here, even on the day it happens.
 *
 * So once a day each calendar's window is read in full as well. Events
 * already known and unchanged cost nothing (their fingerprint matches);
 * the ones that have come into range are added. The "what changed?" cursor
 * is kept, so deletions keep arriving the usual way.
 */

/** @typedef {import("node:sqlite").DatabaseSync} DB */

export const WINDOW_READ_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{ window_listed_at?: string | null }} calendarRow
 * @param {number} [now]
 */
export function windowIsDue(calendarRow, now = Date.now()) {
  const last = calendarRow.window_listed_at ? Date.parse(calendarRow.window_listed_at) : NaN;
  return !Number.isFinite(last) || now - last >= WINDOW_READ_EVERY_MS;
}

/**
 * @param {DB} db
 * @param {string} integrationId
 * @param {string} externalCalendarId
 */
export function markWindowRead(db, integrationId, externalCalendarId) {
  db.prepare(
    `UPDATE integration_calendars SET window_listed_at = ? WHERE integration_id = ? AND external_calendar_id = ?`
  ).run(new Date().toISOString(), integrationId, externalCalendarId);
}
