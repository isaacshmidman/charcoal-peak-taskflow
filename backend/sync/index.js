// @ts-check
/**
 * @file Public surface of the sync module. Original `backend/sync.js`
 * is a re-export shim that points here.
 *
 * 4 public exports — verify after changes with
 *   node -e "import('./backend/sync.js').then(m =>
 *   console.log(Object.keys(m).sort().join('\n')))"
 */
export { startSyncLoop, stopSyncLoop } from "./state.js";
export { syncIntegration } from "./coordinator.js";
export { mapGoogleEventToTaskInput } from "./google-inbound.js";
