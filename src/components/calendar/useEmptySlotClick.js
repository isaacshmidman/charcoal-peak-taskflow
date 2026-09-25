// @ts-check
/**
 * @file Click (or tap) empty calendar space to create a task there — the
 * Day and Week hour grids and their all-day strips.
 *
 * A click only counts when the press STARTED on empty space and barely
 * moved. That one rule keeps out everything that isn't "I meant to click
 * here":
 *   - dragging a task and dropping it in the same column (the browser then
 *     fires a click on the column, which would open a form after every
 *     move);
 *   - a press that began on a task card, a button or a link;
 *   - a mouse drag that became a scroll.
 * Touch scrolls never produce a click at all.
 *
 * With a mouse, hovering shows where the task would go ("+ 9:15 AM"). Not
 * on touch: there's no hover, and a stale ghost left behind by a tap would
 * be noise.
 */
import { useRef, useState } from "react";

/** Grid resolution for clicks: times snap down to the quarter hour. */
export const SLOT_MINUTES = 15;
/** How far a press may travel and still count as a click. */
const MAX_CLICK_TRAVEL_PX = 6;
/** Things that have their own click behaviour (cards are role="button"). */
const INTERACTIVE = 'button, a, input, textarea, select, [role="button"]';

/**
 * Minutes after midnight at a vertical offset into a 24-hour grid, snapped
 * down to the slot and kept inside the day.
 *
 * @param {number} offsetY
 * @param {number} hourHeight
 * @param {number} [slot]
 */
export function minutesAtOffset(offsetY, hourHeight, slot = SLOT_MINUTES) {
  const raw = (offsetY / hourHeight) * 60;
  const snapped = Math.floor(raw / slot) * slot;
  return Math.min(Math.max(snapped, 0), 24 * 60 - slot);
}

/**
 * Minutes after midnight in the task_time format, e.g. 555 → "9:15AM".
 * @param {number} minutes
 */
export function formatSlotTime(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const hour = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${hour}:${String(m).padStart(2, "0")}${h24 < 12 ? "AM" : "PM"}`;
}

/**
 * A friendlier label for the hover ghost: "9 AM", "9:15 AM".
 * @param {number} minutes
 */
export function slotLabel(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const hour = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h24 < 12 ? "AM" : "PM"}`;
}

/** @param {EventTarget | null} target */
const startsOnSomethingClickable = (target) =>
  target instanceof Element && Boolean(target.closest(INTERACTIVE));

/**
 * Handlers for an empty-space target. With `hourHeight`, the target is a
 * 24-hour grid and `onCreate` gets the minutes after midnight under the
 * click; without, it's an all-day area and `onCreate` gets null.
 *
 * @param {{ onCreate?: (minutes: number | null) => void, hourHeight?: number }} options
 */
export function useEmptySlotClick({ onCreate, hourHeight }) {
  /** @type {import("react").MutableRefObject<{ x: number, y: number } | null>} */
  const pressRef = useRef(null);
  const [hoverMinutes, setHoverMinutes] = useState(/** @type {number | null} */ (null));

  /** @param {{ clientY: number, currentTarget: Element }} e */
  const minutesAt = (e) =>
    hourHeight ? minutesAtOffset(e.clientY - e.currentTarget.getBoundingClientRect().top, hourHeight) : null;

  if (!onCreate) return { handlers: {}, hoverMinutes: null };

  return {
    hoverMinutes,
    handlers: {
      /** @param {import("react").PointerEvent<Element>} e */
      onPointerDown(e) {
        pressRef.current =
          e.button === 0 && !startsOnSomethingClickable(e.target) ? { x: e.clientX, y: e.clientY } : null;
      },
      /** @param {import("react").MouseEvent<Element>} e */
      onClick(e) {
        const press = pressRef.current;
        pressRef.current = null;
        if (!press || startsOnSomethingClickable(e.target)) return;
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > MAX_CLICK_TRAVEL_PX) return;
        setHoverMinutes(null);
        onCreate(minutesAt(e));
      },
      /** @param {import("react").PointerEvent<Element>} e */
      onPointerMove(e) {
        if (!hourHeight) return;
        const show = e.pointerType === "mouse" && e.buttons === 0 && !startsOnSomethingClickable(e.target);
        const next = show ? minutesAt(e) : null;
        setHoverMinutes((current) => (current === next ? current : next));
      },
      onPointerLeave() {
        setHoverMinutes(null);
      },
    },
  };
}
