// @ts-check
/**
 * @file Push-queue singletons. Every other backend/push/* sub-module
 * imports the helpers below — they MUST NOT declare their own Set/Map/
 * array, because if they did the suppression + rate-limit state would
 * fragment and suppressPush() from sync.js would no longer be visible
 * to runPush()'s isSuppressed() check (the loop-prevention bug).
 *
 * State:
 *   suppressUntil    — taskId → expiry epoch ms. Drives isSuppressed().
 *   debounceTimers   — taskId → pending setTimeout handle.
 *   pushQueue        — FIFO of jobs to drain.
 *   queueRunning     — flag to prevent concurrent drains.
 *   lastPushAt       — epoch of most recent dispatch (rate-limit gate).
 */
import { log } from "../log.js";

export const SUPPRESS_MS = 30 * 1000;

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

/** @type {Map<string, number>} taskId → expiresAt epoch ms */
const suppressUntil = new Map();

/** @type {Map<string, NodeJS.Timeout>} taskId → pending debounce timer */
export const debounceTimers = new Map();

/** @type {Array<() => Promise<void>>} */
const pushQueue = [];
let queueRunning = false;
let lastPushAt = 0;

/**
 * Called by the inbound sync after it applies a Google event to a task. The
 * subsequent `updateEntityRecord` triggers our push hook — we skip that push
 * so we don't echo the change back to Google.
 */
export function suppressPush(taskId, ttlMs = SUPPRESS_MS) {
  if (!taskId) return;
  suppressUntil.set(taskId, Date.now() + ttlMs);
  // Opportunistic cleanup of expired entries so the map doesn't grow.
  if (suppressUntil.size > 256) {
    const now = Date.now();
    for (const [k, v] of suppressUntil) if (v <= now) suppressUntil.delete(k);
  }
}

export function isSuppressed(taskId) {
  const exp = suppressUntil.get(taskId);
  if (!exp) return false;
  if (exp <= Date.now()) {
    suppressUntil.delete(taskId);
    return false;
  }
  return true;
}

export function getPushQueueState() {
  return {
    debounced: debounceTimers.size,
    queued: pushQueue.length,
    running: queueRunning,
  };
}

export async function waitForPushIdle({ timeoutMs = 300_000, pollMs = 50 } = {}) {
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
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
