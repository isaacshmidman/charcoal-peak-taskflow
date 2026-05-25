// @ts-check
/**
 * @file Re-export shim. The implementation was split into focused
 * sub-modules under `backend/providers/apple/` to keep each file under
 * ~300 LOC. This path stays valid so every caller's existing
 * `from "./providers/apple-calendar.js"` import keeps resolving
 * unchanged.
 *
 * See `backend/providers/apple/index.js` for the canonical export
 * surface (10 public symbols).
 */
export * from "./apple/index.js";
