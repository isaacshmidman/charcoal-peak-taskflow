// @ts-check
/**
 * @file Re-export shim. The implementation was split into focused
 * sub-modules under `backend/push/` to keep each file under ~300 LOC.
 * This path stays valid so every caller's existing `from "./push.js"`
 * import keeps resolving unchanged.
 *
 * See `backend/push/index.js` for the canonical export surface
 * (5 public symbols).
 *
 * Singletons (suppressUntil Map, pushQueue Array, debounceTimers Map,
 * rate-limit state) live ONLY in `backend/push/state.js`. Every other
 * sub-module imports the helpers there rather than declaring its own
 * copies — otherwise suppressPush() called from sync.js wouldn't be
 * visible to runPush()'s isSuppressed() check (loop-prevention bug).
 */
export * from "./push/index.js";
