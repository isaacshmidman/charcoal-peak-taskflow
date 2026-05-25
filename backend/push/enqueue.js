// @ts-check
/**
 * @file Public entrypoint for outbound push. Hooked into server.js
 * after Task CRUD operations:
 *   - debounce repeated upserts on the same task into a single push
 *   - deletes bypass debounce (their snapshot is already gone)
 *   - check suppression up front to break inbound→outbound loops
 *   - fan out to provider runners (Google or Apple) per-integration
 */
import {
  isSuppressed,
  enqueueDrain,
  debounceTimers,
  PUSH_DEBOUNCE_MS,
} from "./state.js";
import { log } from "../log.js";
import { pushOneGoogle } from "./google.js";
import { pushOneApple } from "./apple.js";

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
  if (isSuppressed(payload.taskSnapshot.id)) return;
  // Tasks created by the inbound sync (source_provider!=null) only need to
  // be echoed back if the user later edited them — but the suppression
  // window above already covers that. We don't push events at all back to
  // Google's read-only calendars.
  if (
    payload.taskSnapshot.source_provider &&
    payload.taskSnapshot.source_writable === false
  ) {
    return;
  }

  const taskId = payload.taskSnapshot.id;

  // Deletes need their own queue slot — they can't be debounced into a
  // subsequent upsert because the snapshot is already gone.
  if (payload.op === "delete") {
    enqueueDrain(() => runPush(db, config, payload));
    return;
  }

  // Debounce upserts: rapid sequential mutations on the same task collapse
  // into one final push. Cancel any existing timer for this task.
  const existing = debounceTimers.get(taskId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    debounceTimers.delete(taskId);
    enqueueDrain(() => runPush(db, config, payload));
  }, PUSH_DEBOUNCE_MS);
  // Don't keep the process alive just for this timer.
  timer.unref?.();
  debounceTimers.set(taskId, timer);
}

async function runPush(db, config, { op, appId, taskSnapshot }) {
  const integrations = /** @type {any[]} */ (
    db
      .prepare(
        `SELECT * FROM calendar_integrations
         WHERE app_id = ? AND user_id = ? AND status = 'active'
           AND provider IN ('google', 'apple')`
      )
      .all(appId, taskSnapshot.created_by_id || "")
  );
  if (integrations.length === 0) return;

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

  for (const integration of eligible) {
    try {
      await pushOne(db, config, { op, integration, taskSnapshot });
    } catch (err) {
      // Per-integration failure already logged + marked; keep going.
      log.warn(
        `[push] integration ${integration.id} task ${taskSnapshot.id}: ${err.message}`
      );
    }
  }
}

async function pushOne(db, config, { op, integration, taskSnapshot }) {
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
  await pushOneGoogle(db, config, { op, integration, taskSnapshot });
}
