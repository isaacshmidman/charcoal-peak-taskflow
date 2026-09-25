// @ts-check
/**
 * @file Drag an event's bottom edge to change when it ends (Day and Week).
 *
 * Plain pointer events rather than dnd-kit: this isn't moving the task,
 * just stretching it. The handle sits beside the card (TimedEventBlock),
 * not inside it, so a press on it never reaches the card's dnd-kit
 * listeners and pulling the edge can't turn into a move. Pointer capture
 * keeps the resize going when the pointer leaves the handle, and routes
 * the closing click to the handle, where it's swallowed.
 *
 * The end snaps to the quarter hour, stays at least 15 minutes after the
 * start and ends by 11:59 PM. Escape cancels. Nothing is saved until the
 * pointer comes up, and only if the end actually changed.
 */
import { useEffect, useRef, useState } from "react";

export const RESIZE_SNAP_MINUTES = 15;
const LAST_END = 24 * 60 - 1;

/**
 * The end time for a resize: the original end moved by the pointer's
 * travel, snapped to the quarter hour and kept within the day.
 *
 * @param {{ startMin: number, originalEnd: number, deltaY: number, hourHeight: number }} args
 */
export function resizedEnd({ startMin, originalEnd, deltaY, hourHeight }) {
  const raw = originalEnd + (deltaY / hourHeight) * 60;
  const snapped = Math.round(raw / RESIZE_SNAP_MINUTES) * RESIZE_SNAP_MINUTES;
  return Math.min(LAST_END, Math.max(startMin + RESIZE_SNAP_MINUTES, snapped));
}

/**
 * @param {{
 *   startMin: number,
 *   endMin: number,
 *   hourHeight: number,
 *   onResize?: (endMin: number) => void,
 * }} options
 */
export function useResizeDuration({ startMin, endMin, hourHeight, onResize }) {
  /** @type {import("react").MutableRefObject<{ startY: number, pointerId: number } | null>} */
  const dragRef = useRef(null);
  const [previewEnd, setPreviewEnd] = useState(/** @type {number | null} */ (null));
  const previewRef = useRef(/** @type {number | null} */ (null));

  const stop = () => {
    dragRef.current = null;
    previewRef.current = null;
    setPreviewEnd(null);
  };

  // Escape abandons a resize in progress.
  const resizing = previewEnd != null;
  useEffect(() => {
    if (!resizing) return undefined;
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        stop();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [resizing]);

  const handleProps = {
    /** @param {import("react").PointerEvent<HTMLElement>} e */
    onPointerDown(e) {
      if (e.button !== 0) return;
      // Keep the press from the grid beneath (click-to-create, hover
      // outline); it also marks itself data-no-create for the same reason.
      e.stopPropagation();
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      dragRef.current = { startY: e.clientY, pointerId: e.pointerId };
      previewRef.current = endMin;
      setPreviewEnd(endMin);
    },
    /** @param {import("react").PointerEvent<HTMLElement>} e */
    onPointerMove(e) {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      e.stopPropagation();
      const next = resizedEnd({ startMin, originalEnd: endMin, deltaY: e.clientY - drag.startY, hourHeight });
      if (next !== previewRef.current) {
        previewRef.current = next;
        setPreviewEnd(next);
      }
    },
    /** @param {import("react").PointerEvent<HTMLElement>} e */
    onPointerUp(e) {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      e.stopPropagation();
      const next = previewRef.current;
      stop();
      if (next != null && next !== endMin) onResize?.(next);
    },
    onPointerCancel() {
      stop();
    },
    /** @param {import("react").MouseEvent<HTMLElement>} e */
    onClick(e) {
      // The click that ends a resize belongs to no one — not the grid's
      // click-to-create.
      e.stopPropagation();
      e.preventDefault();
    },
  };

  return { previewEnd, resizing, handleProps };
}
