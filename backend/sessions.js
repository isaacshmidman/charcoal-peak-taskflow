// @ts-check
/**
 * @file The places an account is signed in (Settings → Signed-in devices):
 * listed with the device and when it was last used, and each can be signed
 * out, or all but this one — what to do after a lost phone or a shared
 * computer. AI apps are separate (Settings → Connected apps).
 */
import { HttpError } from "./http.js";

/** How stale "last active" may get before a request refreshes it. */
export const TOUCH_EVERY_MS = 10 * 60 * 1000;

/**
 * "Safari on iPhone", "Chrome on Windows", "Zephyrly on Mac" — from the
 * browser's user agent. Best effort; unknowns say so.
 * @param {string} userAgent
 */
export function deviceLabel(userAgent) {
  const ua = String(userAgent || "");
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /CrOS/.test(ua)
          ? "Chromebook"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Windows/.test(ua)
              ? "Windows"
              : /Linux/.test(ua)
                ? "Linux"
                : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "";
  if (browser && system) return `${browser} on ${system}`;
  return browser || system || "Unknown device";
}

/**
 * @param {any} db
 * @param {{ appId: string, userId: string, currentId: string }} who
 */
export function listSessions(db, { appId, userId, currentId }) {
  return db
    .prepare(
      `SELECT id, user_agent, ip_address, auth_provider, created_date, updated_date FROM sessions
       WHERE app_id = ? AND user_id = ? AND expires_at > ? ORDER BY updated_date DESC`
    )
    .all(appId, userId, new Date().toISOString())
    .map((/** @type {any} */ row) => ({
      id: row.id,
      device: deviceLabel(row.user_agent),
      ip_address: row.ip_address || "",
      signed_in_with: row.auth_provider || "",
      signed_in_at: row.created_date,
      last_active_at: row.updated_date,
      current: row.id === currentId,
    }));
}

/**
 * Sign out one of the person's own sessions.
 * @param {any} db
 * @param {{ appId: string, userId: string, id: string }} input
 */
export function revokeSession(db, { appId, userId, id }) {
  const result = db.prepare(`DELETE FROM sessions WHERE app_id = ? AND user_id = ? AND id = ?`).run(appId, userId, id);
  if (!result.changes) throw new HttpError(404, "That sign-in isn't there any more.", "not_found");
}

/**
 * Sign out everywhere but here. Returns how many.
 * @param {any} db
 * @param {{ appId: string, userId: string, currentId: string }} input
 */
export function revokeOtherSessions(db, { appId, userId, currentId }) {
  return db.prepare(`DELETE FROM sessions WHERE app_id = ? AND user_id = ? AND id != ?`).run(appId, userId, currentId).changes;
}
