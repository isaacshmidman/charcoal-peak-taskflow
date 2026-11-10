/**
 * @file "Do this once the mouse button (or finger) is up."
 *
 * Leaving a box often tidies it — a typed tag becomes a chip, a typed
 * subtask joins the list. That changes the layout, and it happens on
 * mouse-DOWN, because that is when the box loses focus. The control being
 * clicked then slides out from under the pointer before the button comes
 * up, and the click lands on something else, or on nothing.
 *
 * `afterPress(fn)` runs `fn` straight away when nothing is pressed (Tab,
 * Enter, a script), and otherwise holds it until the press is over: at
 * the click, just BEFORE the clicked control hears about it — so a Save
 * button pressed straight after typing still sees the change — or, when
 * the press doesn't end in a click (a drag, a release somewhere else),
 * a moment after the button comes up.
 *
 * Not at the release itself: the browser works out what was clicked from
 * where the button came up, and it looks after the release handlers have
 * run. Moving things there loses the click just the same.
 */
import { flushSync } from "react-dom";

let pressed = false;
/** @type {Array<() => void>} */
const waiting = [];

function flush() {
  if (!waiting.length) return;
  const fns = waiting.splice(0);
  flushSync(() => {
    for (const fn of fns) fn();
  });
}

function release() {
  pressed = false;
  // The click, if there is one, comes first and flushes; this catches the
  // press that never becomes a click.
  if (waiting.length) setTimeout(flush, 0);
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => { pressed = true; }, true);
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);
  // Capture, on the window: ahead of every handler on the page.
  window.addEventListener("click", flush, true);
  // A press that ends outside the window never reports its release.
  window.addEventListener("blur", release);
}

/** @param {() => void} fn */
export function afterPress(fn) {
  if (pressed) waiting.push(fn);
  else fn();
}
