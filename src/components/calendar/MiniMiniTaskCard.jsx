import { useState, useEffect } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Check, CalendarDays, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { colorBg, isDarkColor, mixHexColor } from "@/lib/colors";
import { useTheme } from "@/lib/ThemeProvider";
import { isReadOnlyTask } from "@/lib/task-filters";

/** @typedef {import("@/types/tasks").TaskRecord & { source_kind?: string | null, source_color_hex?: string | null }} TaskRecord */
/** @typedef {import("@/types/tasks").PriorityOption} PriorityOption */

/**
 * Ultra-compact task chip for month-calendar day cells.
 * Smaller than CompactTaskCard: priority color bg, title, optional purple
 * recurrence dot, tiny checkbox to mark done. Click opens TaskForm.
 * Draggable between days.
 *
 * @param {{
 *   task: TaskRecord,
 *   priorities: PriorityOption[],
 *   onClick: (task: TaskRecord) => void,
 *   onToggleDone?: (task: TaskRecord) => void,
 *   fillHeight?: boolean,
 * }} props
 */
export default function MiniMiniTaskCard({ task, priorities, onClick, onToggleDone, fillHeight = false }) {
  const { isDark } = useTheme();
  const priority = priorities.find((p) => p.id === task.priority_id);
  const colorKey = priority?.color || "slate";
  const isRecurring =
    task.task_type === "recurring" && task.recurrence && task.recurrence !== "none";

  // Source-aware: tasks imported from a calendar provider use the calendar's
  // own hex color and (for non-task items) hide the checkbox.
  const sourceHex = task.source_color_hex || null;
  const isExternalEvent = task.source_kind === "event";
  const showCheckbox = !!onToggleDone && !isExternalEvent;

  const [optimisticDone, setOptimisticDone] = useState(false);
  useEffect(() => { setOptimisticDone(false); }, [task.id, task.status]);
  const isDone = task.status === "done" || optimisticDone;

  // Read-only calendar items can be opened (view-only) but not dragged:
  // a drop would move Zephyrly's copy while the real event stays put.
  const readOnly = isReadOnlyTask(task);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { taskId: task.id, task },
    disabled: readOnly,
  });

  const dark = sourceHex ? false : isDarkColor(colorKey);
  // A connected calendar's own colour, thinned into the surface it sits on
  // (night-card in the dark) so it reads like the priority tints beside it.
  const hexBg = sourceHex ? mixHexColor(sourceHex, isDark ? "#1b1a17" : "#ffffff", isDark ? 0.26 : 0.16) : null;
  const hexBorder = sourceHex ? mixHexColor(sourceHex, isDark ? "#1b1a17" : "#ffffff", isDark ? 0.42 : 0.3) : null;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        if (isDragging) return;
        e.stopPropagation();
        onClick(task);
      }}
      className={cn(
        "group rounded border px-1.5 py-0.5 flex gap-1 cursor-pointer",
        fillHeight ? "items-start h-full" : "items-center",
        "text-[10px] leading-tight select-none touch-none",
        // Hex-source tasks override Tailwind palette via inline style below.
        !sourceHex && (colorBg[colorKey] || colorBg.slate),
        isDragging && "opacity-40",
        isDone && "opacity-60"
      )}
      style={
        sourceHex
          ? { backgroundColor: hexBg, borderColor: hexBorder }
          : undefined
      }
      title={task.title}
    >
      {showCheckbox && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (task.status !== "done") setOptimisticDone(true);
            onToggleDone(task);
          }}
          className={cn(
            "shrink-0 w-3 h-3 rounded-sm border flex items-center justify-center transition-all",
            isDone
              ? "bg-sun-400 border-sun-500 text-ink-900 dark:border-sun-400"
              : dark
                ? "border-white bg-white dark:bg-night-sunken hover:bg-white dark:hover:bg-night-high"
                : "border-ink-400 bg-white dark:bg-night-sunken hover:border-ink-600"
          )}
          aria-label={isDone ? "Mark incomplete" : "Mark done"}
        >
          {isDone && <Check className="w-2.5 h-2.5" strokeWidth={3.5} />}
        </button>
      )}
      {isExternalEvent && !showCheckbox && (
        <CalendarDays
          className="w-2.5 h-2.5 shrink-0 text-ink-500 dark:text-ink-400"
          aria-hidden
        />
      )}
      <span
        className={cn(
          "truncate flex-1",
          dark ? "text-white dark:text-ink-100" : "text-ink-900 dark:text-ink-100",
          isDone && "line-through"
        )}
      >
        {task.title}
      </span>
      {isRecurring && (
        <Repeat className="w-2.5 h-2.5 shrink-0 text-ink-500 dark:text-ink-400" aria-hidden />
      )}
    </div>
  );
}
