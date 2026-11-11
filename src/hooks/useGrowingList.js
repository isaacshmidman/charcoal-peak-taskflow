// @ts-check
/**
 * @file A long list, drawn a screenful or two at a time.
 *
 * A card is not cheap: its menus, its subtasks, and a layout animation
 * that measures every card on the page whenever one of them moves. With a
 * few hundred tasks, opening a page drew all of them and ticking one off
 * re-measured all of them, which is where "the whole thing runs slow" came
 * from. Almost none of those cards were on screen.
 *
 * So a list starts with its first `step` rows and a marker after the last
 * one. When the marker comes within about two screens of view, the next
 * `step` rows are added — always ahead of the scrolling, so there is
 * nothing to wait for and nothing to press. Sorting, filtering, counts and
 * "select all" work on the whole list as before; only the drawing is cut
 * short.
 *
 * Where the browser can't watch the marker (the unit-test one), the whole
 * list is drawn.
 */
import { useEffect, useRef, useState } from "react";

export const LIST_STEP = 60;

/** The nearest ancestor that scrolls up and down, or null for the page. */
function scrollerOf(element) {
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} [step]
 * @returns {{ shown: T[], more: boolean, markerRef: import("react").RefObject<any> }}
 *   `shown` to draw; when `more`, put an element with `markerRef` after
 *   the last row.
 */
export function useGrowingList(items, step = LIST_STEP) {
  const canWatch = typeof IntersectionObserver !== "undefined";
  const [count, setCount] = useState(step);
  const markerRef = useRef(null);
  const more = canWatch && count < items.length;

  useEffect(() => {
    const marker = markerRef.current;
    if (!more || !marker) return undefined;
    // Made afresh after every growth: a new watcher reports at once, so a
    // marker that is still near the screen keeps the list growing.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setCount((shown) => shown + step);
      },
      { root: scrollerOf(marker), rootMargin: "1600px 0px" }
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [more, count, step]);

  return { shown: more ? items.slice(0, count) : items, more, markerRef };
}
