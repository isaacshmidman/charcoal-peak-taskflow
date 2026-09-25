// @ts-nocheck
/**
 * @file DnD-Kit sensors + drag state + drag handlers for the Calendar
 * page. Encapsulates: activeTask (for DragOverlay), overlay-width
 * tracking (so the dragged card resizes when hovering Day timed/all-day
 * sections vs snaps back over Week/Month cells), and handleDragStart /
 * Over / End / Cancel.
 *
 * Drag-end translates a drop on a timed slot into a 15-min-snapped
 * task_time + carries the previous duration into task_end_time. While a
 * card is over a timed column, `dropPreview` says exactly where it would
 * land — computed by the same timedDropTarget the drop uses, so the
 * outline the views draw can't disagree with what gets saved.
 *
 * Read-only calendar items never move (see isReadOnlyTask).
 */
import { useRef, useState } from "react";
import {
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  minutesToTaskTime,
  parseTaskTime,
} from "@/lib/sort-helpers";
import { isReadOnlyTask } from "@/lib/task-filters";

const SNAP_MINUTES = 15;
const LAST_START = 24 * 60 - SNAP_MINUTES;
const LAST_END = 24 * 60 - 1; // 11:59 PM — "12:00AM" would read as before the start

/**
 * Where a card dropped on a timed column lands: its top edge, snapped to
 * the quarter hour, keeping the task's duration (an hour if it had none).
 * Null when the rects needed to place it are missing — the old fallback
 * of 0 silently moved such a task to midnight.
 *
 * @param {{ activeTop?: number | null, dropTop?: number | null, hourHeight?: number, task: any }} args
 * @returns {{ start: number, end: number } | null}
 */
export function timedDropTarget({ activeTop, dropTop, hourHeight = 44, task }) {
  if (activeTop == null || dropTop == null) return null;
  const offset = Math.max(0, activeTop - dropTop);
  const snapped = Math.round(((offset / hourHeight) * 60) / SNAP_MINUTES) * SNAP_MINUTES;
  const start = Math.min(LAST_START, Math.max(0, snapped));
  const prevStart = parseTaskTime(task?.task_time);
  const prevEnd = parseTaskTime(task?.task_end_time);
  const duration = prevStart != null && prevEnd != null && prevEnd > prevStart ? prevEnd - prevStart : 60;
  return { start, end: Math.min(LAST_END, start + duration) };
}

/** The drop target for a dnd-kit event over a timed column, or null. */
function targetFor(event) {
  const over = event.over;
  const data = over?.data?.current;
  const task = event.active?.data?.current?.task;
  if (!over || !task || data?.kind !== "timed") return null;
  const target = timedDropTarget({
    activeTop: event.active.rect?.current?.translated?.top,
    dropTop: over.rect?.top,
    hourHeight: data.hourHeight,
    task,
  });
  return target ? { dateStr: data.dateStr, ...target } : null;
}

export function useCalendarDnd({ updateTask, onTaskReschedule }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const [activeTask, setActiveTask] = useState(null);
  const [overlayWidth, setOverlayWidth] = useState(null);
  // { dateStr, start, end } while over a timed column; null otherwise.
  const [dropPreview, setDropPreview] = useState(null);
  const initialOverlayWidthRef = useRef(null);

  const handleDragStart = (event) => {
    const t = event.active?.data?.current?.task;
    if (t) setActiveTask(t);
    // Remember the dragged card's original rendered width so the overlay can
    // snap back to it when hovering over a non-calendar-section droppable.
    const rect = event.active?.rect?.current?.initial;
    initialOverlayWidthRef.current = rect?.width ?? null;
    setOverlayWidth(rect?.width ?? null);
  };

  const handleDragOver = (event) => {
    const overRect = event.over?.rect;
    const kind = event.over?.data?.current?.kind;
    // Only resize when hovering the two Day sections (timed / all-day).
    // For Week/Month we keep the card at its original width.
    if ((kind === "timed" || kind === "allday") && overRect?.width) {
      setOverlayWidth(overRect.width);
    } else {
      setOverlayWidth(initialOverlayWidthRef.current);
    }
  };

  // Fires on every pointer move during a drag; state only changes when the
  // landing slot does.
  const handleDragMove = (event) => {
    const next = targetFor(event);
    setDropPreview((prev) =>
      prev === next || (prev && next && prev.dateStr === next.dateStr && prev.start === next.start && prev.end === next.end)
        ? prev
        : next
    );
  };

  const handleDragEnd = (event) => {
    setActiveTask(null);
    setOverlayWidth(null);
    setDropPreview(null);
    initialOverlayWidthRef.current = null;
    const over = event.over;
    const task = event.active?.data?.current?.task;
    if (!over || !task) return;
    // Cards for read-only items aren't draggable; this is the backstop.
    if (isReadOnlyTask(task)) return;
    const overData = over.data?.current || {};
    const kind = overData.kind;

    if (kind === "allday") {
      const patch = { task_time: "", task_end_time: "" };
      if (overData.dateStr !== task.due_date) patch.due_date = overData.dateStr;
      updateTask(task.id, patch);
      return;
    }

    if (kind === "timed") {
      const target = targetFor(event);
      if (!target) return;
      updateTask(task.id, {
        due_date: target.dateStr,
        task_time: minutesToTaskTime(target.start),
        task_end_time: minutesToTaskTime(target.end),
      });
      return;
    }

    if (kind === "day") {
      if (overData.dateStr !== task.due_date) {
        onTaskReschedule(task, overData.dateStr);
      }
    }
  };

  const handleDragCancel = () => {
    setActiveTask(null);
    setOverlayWidth(null);
    setDropPreview(null);
    initialOverlayWidthRef.current = null;
  };

  return {
    sensors,
    activeTask,
    overlayWidth,
    dropPreview,
    handleDragStart,
    handleDragOver,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  };
}
