// @ts-check
/**
 * @file Public surface of the Apple iCloud Calendar provider. The
 * original path `backend/providers/apple-calendar.js` is a re-export
 * shim that points here, so every consumer's existing import keeps
 * resolving unchanged.
 *
 * 10 public exports — verify after changes with
 *   node -e "import('./backend/providers/apple-calendar.js').then(m =>
 *   console.log(Object.keys(m).sort().join('\n')))"
 */
export { discoverAppleCalendars } from "./discovery.js";
export { listEventsIncremental } from "./sync.js";
export { parseVEvent, mapVEventToTaskInput } from "./events.js";
export { buildVEvent } from "./ics.js";
export {
  putEvent,
  deleteEvent,
  setCalendarColor,
  eventHrefForUid,
  newEventUid,
} from "./write.js";
