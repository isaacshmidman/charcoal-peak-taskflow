// @ts-check
/**
 * @file Public entrypoint for outbound push. Hooked into server.js
 * after Task CRUD operations:
 *   - debounce repeated upserts on the same task into a single push
 *   - deletes bypass debounce (their snapshot is already gone)
 *   - fan out to provider runners (Google or Apple) per-integration
 *   - every change is written to the outbox first and removed when it has
 *     arrived, so one that fails (or is cut off by a restart) is sent
 *     again later instead of being lost (push/outbox.js)
 */
import {
  enqueueDrain,
  debounceTimers,
  PUSH_DEBOUNCE_MS,
} from "./state.js";
import { log } from "../log.js";
import { pushOneGoogle } from "./google.js";
import { pushOneApple } from "./apple.js";
import { duePushes, failPush, hasCalendarToPushTo, rememberPush, settlePush } from "./outbox.js";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

/**
 * Public entrypoint. Hooked into server.js after Task CRUD.
 *
 * @param {DB} db
 * @param {import("../config.js").backendConfig} config
 * @param {{
 *   op: "upsert" | "delete",
 *   appId: string,
 *   taskSnapshot: any,   // the task row (for upsert) or last-known state (for delete)
 * }} payload
 */
export function enqueueTaskPush(db, config, payload) {
  if (!config.integrationsEnabled) return;
  if (!payload || !payload.taskSnapshot) return;
  // Items that came from a calendar the person can't write to are never
  // sent back to it.
  if (
    payload.taskSnapshot.source_provider &&
    payload.taskSnapshot.source_writable === false
  ) {
    return;
  }

  const taskId = payload.taskSnapshot.id;
  // Nobody to tell: most people have no calendar connected.
  if (!hasCalendarToPushTo(db, payload.appId, payload.taskSnapshot.created_by_id)) return;
  // Written down first, so it survives a failed call or a restart. If the
  // note itself can't be written, the change still goes out the old way:
  // saving a task must never fail over this.
  let token;
  try {
    token = rememberPush(db, payload);
  } catch (err) {
    log.warn(`[push] couldn't note task ${taskId} in the outbox: ${err?.message || err}`);
  }
  const queued = { ...payload, token };

  // Deletes need their own queue slot — they can't be debounced into a
  // subsequent upsert because the snapshot is already gone.
  if (payload.op === "delete") {
    const pending = debounceTimers.get(taskId);
    if (pending) {
      // An edit still waiting out its debounce would otherwise go out
      // AFTER this delete and put the event back.
      clearTimeout(pending);
      debounceTimers.delete(taskId);
    }
    enqueueDrain(() => runPush(db, config, queued));
    return;
  }

  // Debounce upserts: rapid sequential mutations on the same task collapse
  // into one final push. Cancel any existing timer for this task.
  const existing = debounceTimers.get(taskId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    debounceTimers.delete(taskId);
    enqueueDrain(() => runPush(db, config, queued));
  }, PUSH_DEBOUNCE_MS);
  // Don't keep the process alive just for this timer.
  timer.unref?.();
  debounceTimers.set(taskId, timer);
}

/**
 * Send again whatever is due in the outbox: changes a calendar didn't take
 * earlier, and changes that were queued when the server last stopped.
 * Called on every sync tick.
 *
 * @param {DB} db
 * @param {import("../config.js").backendConfig} config
 * @returns {number} how many were put back in the queue
 */
export function retryDuePushes(db, config) {
  if (!config.integrationsEnabled) return 0;
  const due = duePushes(db);
  for (const payload of due) enqueueDrain(() => runPush(db, config, payload));
  return due.length;
}

/**
 * @param {DB} db
 * @param {import("../config.js").backendConfig} config
 * @param {{ op: "upsert" | "delete", appId: string, taskSnapshot: any, token?: string, retry?: boolean }} payload
 */
async function runPush(db, config, { op, appId, taskSnapshot, token, retry = false }) {
  const integrations = /** @type {any[]} */ (
    db
      .prepare(
        `SELECT * FROM calendar_integrations
         WHERE app_id = ? AND user_id = ? AND status = 'active'
           AND provider IN ('google', 'apple')`
      )
      .all(appId, taskSnapshot.created_by_id || "")
  );
  if (integrations.length === 0) {
    settlePush(db, taskSnapshot.id, token);
    return;
  }

  // If the task already has an existing event mapping on a given integration,
  // we always keep round-tripping it on that integration (the user expects
  // edits to propagate where the event lives). For a brand-new task with no
  // mappings, we ONLY push to the user's default integration so connecting
  // both Google and Apple doesn't silently fan out duplicates.
  const mappedIntegrationIds = new Set(
    /** @type {any[]} */ (
      db
        .prepare(
          `SELECT integration_id FROM external_event_map WHERE task_id = ?`
        )
        .all(taskSnapshot.id)
    ).map((r) => r.integration_id)
  );

  const eligible = integrations.filter((integration) => {
    if (mappedIntegrationIds.has(integration.id)) return true;
    // Imported tasks always round-trip on the integration that owns them,
    // identified by source_provider matching.
    if (
      taskSnapshot.source_provider &&
      taskSnapshot.source_provider === integration.provider &&
      taskSnapshot.source_calendar_id
    ) {
      return true;
    }
    return !!integration.is_default;
  });

  /** @type {{ integrationId: string, error: unknown } | null} */
  let failure = null;
  for (const integration of eligible) {
    try {
      await pushOne(db, config, { op, integration, taskSnapshot, retry });
    } catch (err) {
      // Marked on the connection already; the other calendars still get theirs.
      failure = failure || { integrationId: integration.id, error: err };
      log.warn(
        `[push] integration ${integration.id} task ${taskSnapshot.id}: ${err.message}`
      );
    }
  }
  if (failure) failPush(db, { taskId: taskSnapshot.id, token, ...failure });
  else settlePush(db, taskSnapshot.id, token);
}

async function pushOne(db, config, { op, integration, taskSnapshot, retry }) {
  // Don't push back at calendars the user can't write to (Birthdays, Holidays,
  // shared read-only calendars). Inbound sync still imports them as 'event'-
  // kind tasks marked source_writable=false.
  if (taskSnapshot.source_writable === false) return;

  // Apple integrations write a different shape (CalDAV PUT/DELETE of ICS
  // bodies). The mapping table layout is the same, so we only fork the
  // network shape — read-side helpers below stay shared.
  if (integration.provider === "apple") {
    await pushOneApple(db, integration, taskSnapshot, op);
    return;
  }
  await pushOneGoogle(db, config, { op, integration, taskSnapshot, retry });
}
