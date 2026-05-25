// @ts-check
/**
 * @file Sync-loop singletons. Every other backend/sync/* sub-module
 * imports the helpers below — they MUST NOT declare their own Set or
 * timer refs. If they did, two concurrent ticks could double-sync the
 * same integration, OR stopSyncLoop() would only clear half the timers
 * and the loop would keep firing.
 *
 * State:
 *   inFlight             — integration IDs currently syncing.
 *   intervalHandle       — the setInterval() handle for the tick loop.
 *   initialTimeoutHandle — the boot-time one-shot timer.
 */
import { log } from "../log.js";
import { syncIntegration } from "./coordinator.js";

// Ensure we don't run two sync cycles for the same integration simultaneously.
const inFlight = new Set();

/** @type {NodeJS.Timeout | null} */
let intervalHandle = null;
/** @type {NodeJS.Timeout | null} */
let initialTimeoutHandle = null;

/**
 * Start the background poller.
 *
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {import("../config.js").backendConfig} config
 */
export function startSyncLoop(db, config) {
  if (!config.integrationsEnabled) {
    return { stop() {} };
  }
  if (intervalHandle) return { stop: stopSyncLoop };

  // Run once at boot (delayed) so the server starts listening immediately.
  const initialDelay = Math.min(30_000, config.syncIntervalMs);
  initialTimeoutHandle = setTimeout(() => {
    initialTimeoutHandle = null;
    runAllDueSyncs(db, config).catch((err) => {
      log.warn("[sync] initial tick failed:", err.message);
    });
  }, initialDelay);
  initialTimeoutHandle.unref?.();

  intervalHandle = setInterval(() => {
    runAllDueSyncs(db, config).catch((err) => {
      log.warn("[sync] tick failed:", err.message);
    });
  }, config.syncIntervalMs);
  // Don't keep the process alive just for the sync timer.
  intervalHandle.unref?.();

  return { stop: stopSyncLoop };
}

export function stopSyncLoop() {
  if (initialTimeoutHandle) {
    clearTimeout(initialTimeoutHandle);
    initialTimeoutHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function runAllDueSyncs(db, config) {
  const rows = db
    .prepare(`SELECT * FROM calendar_integrations WHERE status = 'active'`)
    .all();
  for (const row of rows) {
    if (inFlight.has(row.id)) continue;
    inFlight.add(row.id);
    try {
      await syncIntegration(db, config, row);
    } catch (err) {
      // Log without tokens; integration row already marked with last_error.
      log.warn(`[sync] integration ${row.id} failed:`, err.message);
    } finally {
      inFlight.delete(row.id);
    }
  }
}
