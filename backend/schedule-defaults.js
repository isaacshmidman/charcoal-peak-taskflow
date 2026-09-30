// @ts-check
/**
 * @file The settings a person pinned for their schedules — where every new
 * schedule starts (backend/lib/schedule.js scheduleFromDefaults). Kept with
 * their other preferences on the user row, so they follow them to every
 * device.
 */
import { cleanDefaults } from "./lib/schedule.js";

/**
 * @param {string | null | undefined} raw
 * @returns {Record<string, any>}
 */
function parsePreferences(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {any} db
 * @param {{ appId: string, userId: string }} who
 * @returns {import("./lib/schedule.js").ScheduleDefaults}
 */
export function getScheduleDefaults(db, { appId, userId }) {
  const row = db.prepare(`SELECT preferences_json FROM users WHERE app_id = ? AND id = ?`).get(appId, userId);
  return cleanDefaults(parsePreferences(row?.preferences_json).scheduleDefaults);
}

/**
 * Replace the pinned settings (only the ones that make sense are kept).
 * @param {any} db
 * @param {{ appId: string, userId: string, defaults: unknown }} input
 */
export function setScheduleDefaults(db, { appId, userId, defaults }) {
  const row = db.prepare(`SELECT preferences_json FROM users WHERE app_id = ? AND id = ?`).get(appId, userId);
  const preferences = parsePreferences(row?.preferences_json);
  const cleaned = cleanDefaults(defaults);
  preferences.scheduleDefaults = cleaned;
  db.prepare(`UPDATE users SET preferences_json = ?, updated_date = ? WHERE app_id = ? AND id = ?`).run(
    JSON.stringify(preferences),
    new Date().toISOString(),
    appId,
    userId
  );
  return cleaned;
}
