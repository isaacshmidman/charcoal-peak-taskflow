// @ts-check
/**
 * @file Keyboard-shortcut core — pure helpers + the semantic-event bus.
 *
 * Architecture: ONE global keydown listener (useGlobalShortcuts, mounted
 * in Layout) parses every keystroke. Page-specific actions are delivered
 * as CustomEvents on window ("shortcut:*") that pages subscribe to via
 * useShortcutEvent — pages never parse keys themselves, so there is a
 * single source of truth for bindings and conflicts are impossible.
 *
 * Ground rules enforced by the listener:
 *  - Single-letter shortcuts NEVER fire while typing (inputs, textareas,
 *    selects, contenteditable — incl. the TipTap editor) or while any
 *    Radix dialog/alert-dialog is open.
 *  - No browser-reserved combos (Cmd+1..9, Cmd+W/T/R/L are untouched).
 *  - Mac shows ⌘ in help; the code treats metaKey/ctrlKey as "Mod".
 */

import { DEFAULT_NAV_ORDER, sanitizeNavOrder } from "@/lib/navigation";

/** Semantic events pages can subscribe to (via useShortcutEvent). */
export const SHORTCUT_EVENTS = {
  newTask: "shortcut:new-task",
  editTask: "shortcut:edit-task", // detail: { id } — palette → page TaskForm
  review: "shortcut:review",
  search: "shortcut:search",
  undoDelete: "shortcut:undo-delete",
  calendarView: "shortcut:calendar-view",   // detail: "day"|"week"|"month"|"year"
  calendarToday: "shortcut:calendar-today",
  calendarStep: "shortcut:calendar-step",   // detail: -1 | 1
  calendarSync: "shortcut:calendar-sync",
  groupingsView: "shortcut:groupings-view", // detail: "date"|"tag"
};

/** `g` + letter → route. Gmail/Linear-style "go to" sequences. */
export const G_SEQUENCES = {
  h: "/Home",
  t: "/Today",
  a: "/Active",
  g: "/Groupings",
  c: "/Calendar",
  d: "/Completed", // d for "done"
  n: "/Notes",
  s: "/Settings",
};

/** How long a pending `g` prefix stays alive. */
export const SEQUENCE_TIMEOUT_MS = 1500;

/**
 * True when the event target is an editable surface — typing there must
 * never trigger single-letter shortcuts.
 * @param {EventTarget | null} target
 */
export function isTypingTarget(target) {
  const el = /** @type {HTMLElement | null} */ (target);
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  // Covers descendants of contenteditable hosts in browsers where
  // isContentEditable is unreliable on the deepest target.
  if (typeof el.closest === "function" && el.closest('[contenteditable="true"]')) return true;
  return false;
}

/** True when any Radix dialog / alert-dialog is open — it owns the keys. */
export function isModalOpen() {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
    )
  );
}

/**
 * Resolve a digit key (1–5) to a nav path following the user's SIDEBAR
 * ORDER (the same localStorage `navOrder` the sidebar renders from), so
 * 1 is always whatever is first on screen.
 *
 * @param {string} digit  "1".."5"
 * @param {string[]} [order]  injectable for tests
 * @returns {string | null}
 */
export function navPathForDigit(digit, order) {
  const idx = Number.parseInt(digit, 10) - 1;
  if (!Number.isInteger(idx) || idx < 0) return null;
  let navOrder = order;
  if (!navOrder) {
    try {
      const saved = localStorage.getItem("navOrder");
      navOrder = saved ? sanitizeNavOrder(JSON.parse(saved)) : DEFAULT_NAV_ORDER;
    } catch {
      navOrder = DEFAULT_NAV_ORDER;
    }
  }
  return navOrder[idx] || null;
}

/**
 * A request made a moment before anyone was there to hear it: pages load
 * their code on first use, so "+" can be pressed while the page is still
 * arriving. It waits here, briefly, for that page and no other.
 * @type {{ name: string, detail: any, path: string, at: number } | null}
 */
let waiting = null;
// Long enough for a page's code to arrive on a slow connection. It is
// only ever handed to the page it was pressed on, so waiting is safe.
const WAIT_MS = 15000;
/** Requests worth keeping: the ones a person would press again. */
const KEPT = new Set(["shortcut:new-task"]);
/** @type {Map<string, number>} */
const listening = new Map();

/**
 * Dispatch a semantic shortcut event.
 * @param {string} name  one of SHORTCUT_EVENTS
 * @param {any} [detail]
 */
export function emitShortcut(name, detail) {
  if (KEPT.has(name) && !listening.get(name)) {
    waiting = { name, detail, path: window.location.pathname, at: Date.now() };
    return;
  }
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * A page saying it now hears an event (hooks/useShortcutEvent.js). Returns
 * what to call when it stops. A request that was waiting for this page is
 * handed over.
 * @param {string} name
 * @param {(detail: any) => void} deliver
 */
export function hearShortcut(name, deliver) {
  listening.set(name, (listening.get(name) || 0) + 1);
  const kept = waiting;
  if (kept && kept.name === name) {
    waiting = null;
    if (Date.now() - kept.at <= WAIT_MS && kept.path === window.location.pathname) deliver(kept.detail);
  }
  return () => listening.set(name, Math.max(0, (listening.get(name) || 0) - 1));
}

/** True on Apple platforms — used by the help overlay's ⌘/Ctrl labels. */
export function isMacLike() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
}
