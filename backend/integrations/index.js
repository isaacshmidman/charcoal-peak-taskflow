// @ts-check
/**
 * @file Public surface of the integrations module. The original path
 * `backend/integrations.js` is a re-export shim that points here, so
 * every consumer's existing `from "./integrations.js"` keeps resolving
 * unchanged.
 *
 * If you add a new sub-module, re-export its public symbols from here
 * AND verify the existing 22-symbol surface is preserved (run
 * `node -e "import('./backend/integrations.js').then(m =>
 * console.log(Object.keys(m).sort().join('\n')))"`).
 */
export { ensureIntegrationsRuntimeReady } from "./runtime.js";
export { serializeIntegration, serializeIntegrationCalendar } from "./serialize.js";
export {
  listIntegrationsForUser,
  getIntegrationForUser,
  listIntegrationCalendars,
  getIntegrationCalendar,
} from "./queries.js";
export { ensureDefaultIntegration, setDefaultIntegration } from "./defaults.js";
export { setPrimaryCalendar } from "./primary.js";
export {
  setCalendarColor,
  refreshIntegrationCalendars,
  setEnabledCalendars,
  setCalendarItemKind,
  markCalendarSyncResult,
  clearCalendarSyncToken,
  markSyncResult,
} from "./calendars.js";
export {
  startGoogleConnect,
  completeGoogleConnect,
  getFreshAccessToken,
} from "./google-connect.js";
export { connectApple, getAppleCredentials } from "./apple-connect.js";
export { disconnectIntegration } from "./disconnect.js";
