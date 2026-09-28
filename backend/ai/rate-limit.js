// @ts-check
/**
 * @file Sliding-window limits for AI connections, in memory. One server
 * process, a handful of people: a map of recent timestamps is plenty, and
 * a restart forgetting them is harmless.
 */

/** @type {Map<string, number[]>} */
const windows = new Map();

/** Changes one connection may make per hour. */
export const WRITES_PER_HOUR = 100;
/** Requests one connection may send per minute. */
export const REQUESTS_PER_MINUTE = 120;

/**
 * Take a slot if one is free.
 * @param {string} key
 * @param {number} limit
 * @param {number} windowMs
 * @returns {{ ok: boolean, retryAfterMs: number }}
 */
export function takeSlot(key, limit, windowMs) {
  const now = Date.now();
  const recent = (windows.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    windows.set(key, recent);
    return { ok: false, retryAfterMs: windowMs - (now - recent[0]) };
  }
  recent.push(now);
  windows.set(key, recent);
  return { ok: true, retryAfterMs: 0 };
}

/** For tests. */
export function resetRateLimits() {
  windows.clear();
}
