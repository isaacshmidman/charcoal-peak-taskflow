// @ts-check
/**
 * @file Re-export shim. The implementation was split into focused
 * sub-modules under `backend/push/` to keep each file under ~300 LOC.
 * This path stays valid so every caller's existing `from "./push.js"`
 * import keeps resolving unchanged.
 *
 * See `backend/push/index.js` for the canonical export surface
 * (7 public symbols).
 *
 * Singletons (pushQueue Array, debounceTimers Map, rate-limit state) live
 * ONLY in `backend/push/state.js`.
 */
export * from "./push/index.js";
