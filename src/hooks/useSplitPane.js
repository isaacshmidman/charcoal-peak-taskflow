// @ts-nocheck
/**
 * @file Draggable split-view divider with magnetic detents — the
 * interaction the Calendar day view uses between its timed and all-day
 * columns, extracted so Notes can use the same one instead of a second
 * near-copy of it.
 *
 * Free drag tracks the pointer 1:1. Near a detent the divider latches
 * with HYSTERESIS — the latch-out radius is larger than the latch-in
 * radius, so it can't oscillate at the boundary, and that oscillation is
 * exactly what reads as jitter. A short width transition ("glide") is
 * enabled ONLY when the rendered size jumps discontinuously (latch,
 * unlatch, release-settle), so the snap eases into place while free drag
 * stays transition-free and perfectly responsive.
 *
 * The caller owns layout; this owns the number and the gesture.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * @param {object} opts
 * @param {string} opts.storageKey            localStorage key for the persisted size
 * @param {number} opts.minSize               px floor for the resizable pane
 * @param {number} [opts.defaultSize]         px used when nothing is stored
 * @param {number} [opts.maxFraction]         cap as a fraction of the container
 * @param {number[]} [opts.snapFractions]     detents as container fractions
 * @param {boolean} [opts.fromEnd]            true when the resizable pane is on the
 *   RIGHT, so dragging left grows it (the calendar's all-day column). Notes'
 *   sidebar is on the left, so it leaves this false.
 */
export function useSplitPane({
  storageKey,
  minSize,
  defaultSize = 192,
  maxFraction = 0.8,
  snapFractions = [0.3, 0.5, 0.7],
  fromEnd = false,
}) {
  const containerRef = useRef(null);
  const glideTimerRef = useRef(null);
  const [glide, setGlide] = useState(false);
  const [snapped, setSnapped] = useState(false);

  const [size, setSize] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const n = raw ? Number(raw) : NaN;
      // Validate against a loose upper bound; the real per-drag max is
      // container-based, and this only needs to not reject a stored snap.
      const loose = typeof window === "undefined"
        ? Infinity
        : Math.max(minSize, Math.floor(window.innerWidth * maxFraction));
      if (Number.isFinite(n) && n >= minSize && n <= loose) return n;
    } catch {
      // fall through
    }
    return defaultSize;
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(size));
    } catch {
      // ignore
    }
  }, [storageKey, size]);

  const beginGlide = useCallback(() => {
    setGlide(true);
    if (glideTimerRef.current) clearTimeout(glideTimerRef.current);
    glideTimerRef.current = setTimeout(() => setGlide(false), 170);
  }, []);

  useEffect(() => () => {
    if (glideTimerRef.current) clearTimeout(glideTimerRef.current);
  }, []);

  /** Drag-time geometry: container-based bounds + detent pixel positions. */
  const measureDragGeometry = useCallback(() => {
    const containerW =
      containerRef.current?.getBoundingClientRect().width ||
      (typeof window !== "undefined" ? window.innerWidth : 1024);
    const minW = minSize;
    const maxW = Math.max(minW, Math.floor(containerW * maxFraction));
    const snaps = snapFractions
      .map((f) => Math.round(containerW * f))
      .filter((px) => px >= minW && px <= maxW);
    // Latch-in within ~2% of the row; latch-out needs ~12px more.
    const snapIn = Math.max(10, Math.round(containerW * 0.02));
    const snapOut = snapIn + 12;
    return { minW, maxW, snaps, snapIn, snapOut, containerW };
  }, [maxFraction, minSize, snapFractions]);

  const startResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = size;
    const { minW, maxW, snaps, snapIn, snapOut } = measureDragGeometry();
    let latched = null;        // px of the currently-latched detent
    let lastDesired = startW;  // free (unlatched) size at the pointer

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    const onMove = (ev) => {
      const dx = fromEnd ? startX - ev.clientX : ev.clientX - startX;
      const desired = Math.max(minW, Math.min(maxW, startW + dx));
      lastDesired = desired;

      if (latched != null && Math.abs(desired - latched) > snapOut) {
        latched = null;
        setSnapped(false);
        beginGlide(); // ease OUT of the detent
      }
      if (latched == null) {
        for (const px of snaps) {
          if (Math.abs(desired - px) <= snapIn) {
            latched = px;
            setSnapped(true);
            beginGlide(); // ease INTO the detent
            break;
          }
        }
      }
      setSize(latched != null ? latched : desired);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setSnapped(false);
      if (latched == null) {
        // Released near (but not inside) a detent → settle onto it.
        let best = null;
        for (const px of snaps) {
          const d = Math.abs(lastDesired - px);
          if (d <= snapIn && (best == null || d < Math.abs(lastDesired - best))) {
            best = px;
          }
        }
        if (best != null) {
          beginGlide();
          setSize(best);
        }
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [beginGlide, fromEnd, measureDragGeometry, size]);

  /** Double-click the divider → jump straight to 50/50. */
  const resetSplit = useCallback(() => {
    const { minW, maxW, containerW } = measureDragGeometry();
    beginGlide();
    setSize(Math.max(minW, Math.min(maxW, Math.round(containerW * 0.5))));
  }, [beginGlide, measureDragGeometry]);

  return { size, setSize, containerRef, startResize, resetSplit, snapped, glide };
}
