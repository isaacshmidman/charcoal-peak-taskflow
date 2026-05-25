// @ts-check
/**
 * @file Re-export shim. The implementation was split into focused
 * sub-modules under `backend/sync/` to keep each file under ~300 LOC.
 * This path stays valid so every caller's existing `from "./sync.js"`
 * import keeps resolving unchanged.
 *
 * See `backend/sync/index.js` for the canonical export surface
 * (4 public symbols).
 *
 * Singletons (`inFlight` Set + tick timer handles) live ONLY in
 * `backend/sync/state.js`. Every other sub-module imports from there
 * rather than declaring its own copies — otherwise two concurrent
 * ticks could double-sync the same integration.
 */
export * from "./sync/index.js";
