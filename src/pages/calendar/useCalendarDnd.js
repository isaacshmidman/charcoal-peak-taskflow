// @ts-nocheck
/**
 * @file DnD-Kit sensors + drag state + drag handlers for the Calendar
 * page. Encapsulates: activeTask (for DragOverlay), overlay-width
 * tracking (so the dragged card resizes when hovering Day timed/all-day
 * sections vs snaps back over Week/Month cells), and handleDragStart /
 * Over / End / Cancel.
 *
 * Drag-end translates a drop on a timed slot into a 15-min-snapped
 * task_time + carries the previous duration into task_end_time.
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
import { isExternalEvent } from "@/lib/task-filters";
import { showDeleteToast } from "@/components/tasks/DeleteToast";

export function useCalendarDnd({ updateTask, onTaskReschedule }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const [activeTask, setActiveTask] = useState(null);
  const [overlayWidth, setOverlayWidth] = useState(null);
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

  const handleDragEnd = (event) => {
    setActiveTask(null);
    setOverlayWidth(null);
    initialOverlayWidthRef.current = null;
    const over = event.over;
    const task = event.active?.data?.current?.task;
    if (!over || !task) return;
    const overData = over.data?.current || {};
    const kind = overData.kind;

    if (kind === "unscheduled") {
      // Dropping into the tray clears the schedule. Recurring tasks are a
      // no-op — due_date drives series advancement (getNextRecurringDueDate),
      // so unscheduling one silently breaks its series. External calendar
      // events aren't ours to unschedule.
      if (isExternalEvent(task)) return;
      if (task.task_type === "recurring") {
        showDeleteToast({ label: "Recurring tasks keep their date", hideUndo: true });
        return;
      }
      if (task.due_date || task.task_time) {
        updateTask(task.id, { due_date: "", task_time: "", task_end_time: "" });
      }
      return;
    }

    if (kind === "allday") {
      const patch = { task_time: "", task_end_time: "" };
      if (overData.dateStr !== task.due_date) patch.due_date = overData.dateStr;
      updateTask(task.id, patch);
      return;
    }

    if (kind === "timed") {
      const dropRect = over.rect;
      const activeRect = event.active.rect?.current?.translated;
      const hourHeight = overData.hourHeight || 44;
      const yInDrop = activeRect && dropRect
        ? Math.max(0, activeRect.top - dropRect.top)
        : 0;
      const rawMins = (yInDrop / hourHeight) * 60;
      const snapped = Math.round(rawMins / 15) * 15;
      const clamped = Math.min(23 * 60 + 45, Math.max(0, snapped));
      const startStr = minutesToTaskTime(clamped);

      const prevStart = parseTaskTime(task.task_time);
      const prevEnd = parseTaskTime(task.task_end_time);
      const durationMin =
        prevStart != null && prevEnd != null && prevEnd > prevStart
          ? prevEnd - prevStart
          : 60;
      const endStr = minutesToTaskTime(Math.min(24 * 60, clamped + durationMin));

      updateTask(task.id, {
        due_date: overData.dateStr,
        task_time: startStr,
        task_end_time: endStr,
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
    initialOverlayWidthRef.current = null;
  };

  return {
    sensors,
    activeTask,
    overlayWidth,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
