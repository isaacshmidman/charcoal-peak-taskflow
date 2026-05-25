// @ts-check
/**
 * @file Re-export shim. The implementation was split into focused
 * sub-modules under `backend/integrations/` to keep each file under
 * ~300 LOC. This path stays valid so every caller's existing
 * `from "./integrations.js"` import keeps resolving unchanged.
 *
 * See `backend/integrations/index.js` for the canonical export surface
 * (22 public symbols).
 */
export * from "./integrations/index.js";
