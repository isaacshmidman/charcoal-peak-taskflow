// @ts-nocheck
/**
 * @file Swipe-a-row-away-to-delete, extracted from TaskCard so notes use
 * the very same gesture rather than a second copy of it.
 *
 * The fiddly parts are all about not stealing a scroll:
 * - Direction lock. A drag only becomes a swipe once it is clearly
 *   horizontal, and the required ratio is STRICTER in the middle of the
 *   row (4:1) than at the outer fifths (3:1) — the middle is where a
 *   vertical scroll usually starts, so it has to earn it. More than 6px
 *   of vertical movement first abandons the gesture outright.
 * - Threshold. Release past 2/5 of the row's width to delete.
 * - `didSwipe` stays true for a beat after release so a click handler on
 *   the row can tell a swipe from a tap.
 *
 * The caller owns the visuals; this owns the gesture and the numbers.
 *
 * @param {{ onDelete: () => void, enabled?: boolean }} opts
 * @returns {{ ref: import("react").RefObject<any>, swipeX: number, swiping: boolean, willDelete: boolean, didSwipeRef: import("react").RefObject<boolean> }}
 */
import { useEffect, useRef, useState } from "react";

export function useSwipeToDelete({ onDelete, enabled = true }) {
  const ref = useRef(null);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const startX = useRef(null);
  const startY = useRef(null);
  const locked = useRef(false);
  const didSwipeRef = useRef(false);
  const swipeXRef = useRef(0);

  const getThreshold = () => {
    const w = ref.current?.offsetWidth;
    return w ? (w * 2) / 5 : 120;
  };

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return undefined;

    const onStart = (e) => {
      if (e.type === "mousedown" && e.button !== 0) return;
      startX.current = e.type === "mousedown" ? e.clientX : e.touches[0].clientX;
      startY.current = e.type === "mousedown" ? e.clientY : e.touches[0].clientY;
      locked.current = false;
      didSwipeRef.current = false;
      swipeXRef.current = 0;
      setSwiping(false);
      setSwipeX(0);
    };

    const onMove = (e) => {
      if (startX.current === null) return;
      const isTouch = e.type === "touchmove";
      const clientX = isTouch ? e.touches[0].clientX : e.clientX;
      const clientY = isTouch ? e.touches[0].clientY : e.clientY;
      if (!isTouch && e.buttons !== 1) {
        startX.current = null;
        return;
      }
      const dx = clientX - startX.current;
      const dy = clientY - startY.current;

      if (!locked.current) {
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const cardW = ref.current?.offsetWidth || 300;
        const relX = startX.current - (ref.current?.getBoundingClientRect().left || 0);
        const oneFifth = cardW / 5;
        const inMiddleZone = relX > oneFifth && relX < cardW - oneFifth;
        const ratio = inMiddleZone ? 4 : 3;

        if (adx > 10 && adx > ady * ratio) {
          locked.current = true;
        } else if (ady > 6) {
          startX.current = null; // vertical scroll — let it go
          return;
        } else {
          return;
        }
      }

      if (e.cancelable) e.preventDefault();
      swipeXRef.current = dx;
      didSwipeRef.current = Math.abs(dx) > 10;
      setSwiping(true);
      setSwipeX(dx);
    };

    const onEnd = () => {
      if (startX.current === null) { setSwiping(false); setSwipeX(0); return; }
      if (Math.abs(swipeXRef.current) >= getThreshold()) onDelete();
      setSwiping(false);
      setSwipeX(0);
      swipeXRef.current = 0;
      startX.current = null;
      setTimeout(() => { didSwipeRef.current = false; }, 50);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("mousedown", onStart);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("blur", onEnd);
    document.addEventListener("mouseleave", onEnd);

    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("mousedown", onStart);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("blur", onEnd);
      document.removeEventListener("mouseleave", onEnd);
    };
  }, [enabled, onDelete]);

  const willDelete = Math.abs(swipeX) >= getThreshold();

  return { ref, swipeX, swiping, willDelete, didSwipeRef };
}
