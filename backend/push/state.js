// @ts-check
/**
 * @file Push-queue singletons. Every other backend/push/* sub-module
 * imports the helpers below — they MUST NOT declare their own Map/array,
 * or two queues would run side by side and break the rate limit.
 *
 * State:
 *   debounceTimers   — taskId → pending setTimeout handle.
 *   pushQueue        — FIFO of jobs to drain.
 *   queueRunning     — flag to prevent concurrent drains.
 *   lastPushAt       — epoch of most recent dispatch (rate-limit gate).
 *
 * There used to be a fifth: a 30-second "don't push this task" hold that
 * sync placed on every task it touched, to stop its own writes echoing
 * back to the calendar. Sync writes straight to the store and never
 * reaches the push hook, so there was no echo to stop; all the hold ever
 * did was throw away a real edit made within half a minute of a sync
 * touching the same task. It is gone.
 */
import { log } from "../log.js";

// Coalesce + rate-limit outbound writes per task. Google Calendar's per-user
// quota is ~600 reads/min and far stricter on writes; bulk operations from
// the user (e.g. mass-completing tasks) used to fire one PATCH each, which
// blew through the quota and produced the 403 the user hit.
//
// Strategy: queue per-task with a small debounce (so rapid edits collapse
// into a single push), then drain at most MAX_PUSH_PER_SEC across all
// integrations. Deletes still fire immediately because they aren't
// coalesce-able with subsequent upserts.
export const PUSH_DEBOUNCE_MS = 350;
export const MAX_PUSH_PER_SEC = 4; // generous — Google allows much more, but this
                                   // keeps us safely under per-minute quota even
                                   // during a 20-task bulk update.

/** @type {Map<string, NodeJS.Timeout>} taskId → pending debounce timer */
export const debounceTimers = new Map();

/** @type {Array<() => Promise<void>>} */
const pushQueue = [];
let queueRunning = false;
let lastPushAt = 0;

export function getPushQueueState() {
  return {
    debounced: debounceTimers.size,
    queued: pushQueue.length,
    running: queueRunning,
  };
}

export async function waitForPushIdle({ timeoutMs = 300_000, pollMs = 50 } = {}) {
  const startedAt = Date.now();
  while (true) {
    const state = getPushQueueState();
    if (state.debounced === 0 && state.queued === 0 && !state.running) {
      return;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `Timed out waiting for push queue to drain: debounced=${state.debounced}, queued=${state.queued}, running=${state.running}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * Add a job to the rate-limited push queue and start the drain loop.
 * The drain enforces an aggregate ceiling of MAX_PUSH_PER_SEC across
 * all integrations.
 *
 * @param {() => Promise<void>} job
 */
export function enqueueDrain(job) {
  pushQueue.push(job);
  if (queueRunning) return;
  queueRunning = true;
  setImmediate(drainQueue);
}

async function drainQueue() {
  try {
    while (pushQueue.length) {
      const minSpacing = Math.ceil(1000 / MAX_PUSH_PER_SEC);
      const now = Date.now();
      const wait = Math.max(0, lastPushAt + minSpacing - now);
      if (wait > 0) {
        await new Promise((r) => {
          const t = setTimeout(r, wait);
          t.unref?.();
        });
      }
      const job = pushQueue.shift();
      if (!job) break;
      lastPushAt = Date.now();
      try {
        await job();
      } catch (err) {
        // Already logged inside runPush; keep draining.
        log.warn(`[push] queued job error: ${err?.message || err}`);
      }
    }
  } finally {
    queueRunning = false;
  }
}
