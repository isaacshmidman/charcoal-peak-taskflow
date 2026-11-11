// @ts-check
/**
 * @file Changes waiting to reach a connected calendar, kept in the database
 * (table `push_outbox`) so they outlive a failed call and a restart.
 *
 * Before this, a change went into a queue in memory and was tried once
 * (three times for "server busy"). If the calendar was unreachable, or the
 * server restarted before the queue emptied, the change was simply gone:
 * the task said one thing and the calendar kept saying another, with
 * nothing to put it right until the task was edited again.
 *
 * Now:
 *   - rememberPush writes a row before anything is sent;
 *   - settlePush removes it once every calendar has the change;
 *   - failPush keeps it and sets when to try again (RETRY_DELAYS_MS, about
 *     two days in all), or drops it at once when the calendar said the
 *     change itself is wrong (400/413/422: trying again can't help);
 *   - duePushes hands back what is due, read fresh: an edit is sent as the
 *     task is NOW, not as it was when the first try failed.
 *
 * One row per task. A newer change replaces an older one still waiting,
 * and carries a new token; an older try finishing late can't remove or
 * reschedule the newer row because its token no longer matches.
 */
import { randomUUID } from "node:crypto";
import { hydrateRecord } from "../store.js";
import { log } from "../log.js";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

/** How long to wait before each further try: 1 min, 5, 15, 1 h, 3, 6, 12, 24. */
export const RETRY_DELAYS_MS = [1, 5, 15, 60, 180, 360, 720, 1440].map((minutes) => minutes * 60_000);
/** A row just queued or just handed out isn't offered again for this long. */
const IN_FLIGHT_HOLD_MS = 2 * 60_000;
/** The calendar refused the change itself; sending it again changes nothing. */
const REFUSED_FOR_GOOD = new Set([400, 413, 422]);
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();

/**
 * Whether this person has a calendar a change could go to at all. Most
 * people don't, and for them nothing is written.
 *
 * @param {DB} db
 * @param {string} appId
 * @param {string} userId
 */
export function hasCalendarToPushTo(db, appId, userId) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM calendar_integrations
         WHERE app_id = ? AND user_id = ? AND status = 'active' AND provider IN ('google', 'apple') LIMIT 1`
      )
      .get(appId, userId || "")
  );
}

/**
 * Note a change before sending it. Returns the token that later settles it.
 *
 * @param {DB} db
 * @param {{ op: "upsert" | "delete", appId: string, taskSnapshot: any }} payload
 * @param {number} [now]
 */
export function rememberPush(db, { op, appId, taskSnapshot }, now = Date.now()) {
  const token = randomUUID();
  db.prepare(
    `INSERT INTO push_outbox (
       task_id, app_id, user_id, op, snapshot_json, token, attempts,
       next_attempt_at, last_error, failed_integration_id, created_date, updated_date
     ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?, ?)
     ON CONFLICT(task_id) DO UPDATE SET
       op = excluded.op,
       snapshot_json = excluded.snapshot_json,
       token = excluded.token,
       attempts = 0,
       next_attempt_at = excluded.next_attempt_at,
       last_error = NULL,
       failed_integration_id = NULL,
       created_date = excluded.created_date,
       updated_date = excluded.updated_date`
  ).run(
    String(taskSnapshot.id),
    appId,
    String(taskSnapshot.created_by_id || ""),
    op,
    JSON.stringify(taskSnapshot),
    token,
    iso(now + IN_FLIGHT_HOLD_MS),
    iso(now),
    iso(now)
  );
  return token;
}

/**
 * Every calendar has the change.
 *
 * @param {DB} db
 * @param {string} taskId
 * @param {string | undefined} token
 */
export function settlePush(db, taskId, token) {
  if (!token) return;
  db.prepare(`DELETE FROM push_outbox WHERE task_id = ? AND token = ?`).run(taskId, token);
}

/**
 * A calendar didn't take the change. Says what became of it.
 *
 * @param {DB} db
 * @param {{ taskId: string, token: string | undefined, integrationId: string, error: unknown }} failure
 * @param {number} [now]
 * @returns {"waiting" | "dropped" | "superseded"}
 */
export function failPush(db, { taskId, token, integrationId, error }, now = Date.now()) {
  if (!token) return "superseded";
  const row = /** @type {any} */ (
    db.prepare(`SELECT attempts FROM push_outbox WHERE task_id = ? AND token = ?`).get(taskId, token)
  );
  if (!row) return "superseded";

  const status = /** @type {any} */ (error)?.statusCode;
  const attempts = Number(row.attempts) + 1;
  if (REFUSED_FOR_GOOD.has(status) || attempts > RETRY_DELAYS_MS.length) {
    db.prepare(`DELETE FROM push_outbox WHERE task_id = ? AND token = ?`).run(taskId, token);
    log.warn(
      `[push] giving up on task ${taskId} for integration ${integrationId} after ${attempts} ${attempts === 1 ? "try" : "tries"}`
    );
    return "dropped";
  }
  db.prepare(
    `UPDATE push_outbox
     SET attempts = ?, next_attempt_at = ?, last_error = ?, failed_integration_id = ?, updated_date = ?
     WHERE task_id = ? AND token = ?`
  ).run(
    attempts,
    iso(now + RETRY_DELAYS_MS[attempts - 1]),
    String(/** @type {any} */ (error)?.message || "push_failed").slice(0, 200),
    integrationId,
    iso(now),
    taskId,
    token
  );
  return "waiting";
}

/**
 * The changes whose turn it is, each as it should be sent now. Handing
 * one out holds it back for a couple of minutes, so two sweeps can't both
 * send it.
 *
 * @param {DB} db
 * @param {number} [now]
 * @returns {Array<{ op: "upsert" | "delete", appId: string, taskSnapshot: any, token: string, retry: true }>}
 */
export function duePushes(db, now = Date.now()) {
  const rows = /** @type {any[]} */ (
    db.prepare(`SELECT * FROM push_outbox WHERE next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 50`).all(iso(now))
  );
  const due = [];
  for (const row of rows) {
    let taskSnapshot;
    if (row.op === "delete") {
      try {
        taskSnapshot = JSON.parse(row.snapshot_json);
      } catch {
        taskSnapshot = null;
      }
    } else {
      // An edit goes out as the task is now. A task that has been deleted
      // since has its own "delete" row, or needs nothing.
      const current = db.prepare(`SELECT * FROM tasks WHERE id = ? AND app_id = ?`).get(row.task_id, row.app_id);
      taskSnapshot = current ? hydrateRecord("Task", current) : null;
    }
    if (!taskSnapshot) {
      db.prepare(`DELETE FROM push_outbox WHERE task_id = ? AND token = ?`).run(row.task_id, row.token);
      continue;
    }
    db.prepare(`UPDATE push_outbox SET next_attempt_at = ? WHERE task_id = ? AND token = ?`).run(
      iso(now + IN_FLIGHT_HOLD_MS),
      row.task_id,
      row.token
    );
    due.push({ op: row.op, appId: row.app_id, taskSnapshot, token: row.token, retry: /** @type {true} */ (true) });
  }
  return due;
}

/**
 * Whether a change to this task made here is still on its way out. While
 * it is, the calendar's copy is the older one and must not be written over
 * the task; ours is about to replace it there.
 *
 * @param {DB} db
 * @param {string} taskId
 */
export function pushIsWaiting(db, taskId) {
  return Boolean(db.prepare(`SELECT 1 FROM push_outbox WHERE task_id = ? AND op = 'upsert'`).get(taskId));
}

/**
 * How many changes a calendar has refused and is still owed. Shown in
 * Settings, so a problem doesn't vanish the moment the next sync succeeds.
 *
 * @param {DB} db
 * @param {string} integrationId
 */
export function waitingChanges(db, integrationId) {
  const row = /** @type {any} */ (
    db.prepare(`SELECT COUNT(*) AS n FROM push_outbox WHERE failed_integration_id = ? AND attempts > 0`).get(integrationId)
  );
  return Number(row?.n || 0);
}
