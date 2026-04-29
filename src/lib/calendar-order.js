// @ts-nocheck
/**
 * Calendar order + non-Calendar-page visibility — single source of truth.
 *
 * The Calendar page has its own per-page visibility dropdown (see
 * `CalendarVisibilityDropdown.jsx`). This module covers the *other* pages
 * (Today, Active, Completed, Groupings) and the Settings UI for ordering.
 *
 * Calendar key format (matches calendarKeyForTask in
 * CalendarVisibilityDropdown):
 *   - Native Zephyrly task (no source_calendar_id): "zephyrly"
 *   - External:                                    "{provider}:{calId}"
 *
 * localStorage:
 *   - `calendar_order`  → JSON array of keys in user-defined order.
 *                         Unknown keys (newly-discovered calendars) are
 *                         appended after the last known key.
 *   - `calendar_hidden_global` → JSON array of keys hidden on
 *                         non-Calendar pages. Default empty (all visible).
 *
 * Why two separate hidden lists (global vs Calendar page)? The Calendar
 * page's filter is a power-user view ("just show me Work today"); the
 * non-Calendar pages need a stable "I never want school events in my
 * Today list" preference. Keeping them separate avoids one accidentally
 * clobbering the other.
 */

const ORDER_KEY = "calendar_order";
const HIDDEN_GLOBAL_KEY = "calendar_hidden_global";

// Wraps localStorage so private-mode / disabled-storage callers don't crash.
function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback)) return Array.isArray(parsed) ? parsed : fallback;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function getCalendarOrder() {
  return readJson(ORDER_KEY, []);
}
export function setCalendarOrder(arr) {
  writeJson(ORDER_KEY, [...arr]);
  notify();
}

export function getHiddenOnNonCalendarPages() {
  return new Set(readJson(HIDDEN_GLOBAL_KEY, []));
}
export function setHiddenOnNonCalendarPages(set) {
  writeJson(HIDDEN_GLOBAL_KEY, [...set]);
  notify();
}

/**
 * Given the saved order array + a list of currently-known calendar keys,
 * return the merged ordered list:
 *   - Known keys in saved order keep their saved positions
 *   - Newly-discovered keys are appended at the end (alphabetical by label
 *     when ties — caller passes `labelByKey` for that)
 *   - Saved keys not in the current list are pruned
 *
 * Pure function (no localStorage write) so callers can preview / persist
 * separately.
 *
 * @param {Array<{ key: string, label: string }>} calendars
 * @param {string[]} savedOrder
 * @returns {Array<{ key: string, label: string }>}
 */
export function mergeOrder(calendars, savedOrder) {
  const byKey = new Map(calendars.map((c) => [c.key, c]));
  const seen = new Set();
  const out = [];
  for (const k of savedOrder || []) {
    const c = byKey.get(k);
    if (!c) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  // Append newcomers in alpha order.
  const tail = calendars
    .filter((c) => !seen.has(c.key))
    .sort((a, b) => a.label.localeCompare(b.label));
  out.push(...tail);
  return out;
}

/**
 * Compare two task records by the configured calendar order. Returns
 * a stable integer suitable for Array.prototype.sort. Tasks whose
 * calendar isn't in the order list sort last (treated as Infinity).
 *
 * Performance note: callers usually compute a Map<key, index> once and
 * close over it instead of calling this in a tight loop. See
 * `compareByCalendarOrder` factory below.
 */
export function compareByCalendarOrder(a, b, indexByKey) {
  const ka = calendarKeyForTask(a);
  const kb = calendarKeyForTask(b);
  const ia = indexByKey.has(ka) ? indexByKey.get(ka) : Number.POSITIVE_INFINITY;
  const ib = indexByKey.has(kb) ? indexByKey.get(kb) : Number.POSITIVE_INFINITY;
  if (ia === ib) return 0;
  return ia - ib;
}

export function calendarKeyForTask(task) {
  const calId = task.source_calendar_id || "";
  const provider = task.source_provider || "";
  return calId ? `${provider}:${calId}` : "zephyrly";
}

// Subscribe to changes so consumer pages re-render after the user
// reorders or toggles in Settings without needing a route change.
const listeners = new Set();
function notify() {
  for (const fn of listeners) {
    try { fn(); } catch {}
  }
  // Also fire a window event so non-React subscribers (cross-tab) can react.
  try { window.dispatchEvent(new Event("calendarOrderChanged")); } catch {}
}
export function subscribeCalendarOrder(fn) {
  listeners.add(fn);
  // Cross-tab: fire when localStorage changes in another window.
  const onStorage = (e) => {
    if (e.key === ORDER_KEY || e.key === HIDDEN_GLOBAL_KEY) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}
