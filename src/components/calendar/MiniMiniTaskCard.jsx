import { useState, useEffect } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Check, CalendarDays, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { colorBg, colorEdge, isDarkColor, mixHexColor } from "@/lib/colors";
import { useTheme } from "@/lib/ThemeProvider";
import { isReadOnlyTask } from "@/lib/task-filters";

/** @typedef {import("@/types/tasks").TaskRecord & { source_kind?: string | null, source_color_hex?: string | null }} TaskRecord */
/** @typedef {import("@/types/tasks").PriorityOption} PriorityOption */

/**
 * The chip a task or event is on the calendar: a soft tint of its colour,
 * the colour itself down the left edge, and the title. Click opens it;
 * drag moves it to another day or time.
 *
 * The tick box is not part of the chip at rest. A month of chips each with
 * its own box reads as a form to fill in, so the box shows only where it
 * can be used: under the pointer, on the chip the keyboard is on, and on a
 * task that is already done. It sits over the right end of the chip, so
 * nothing moves when it appears. A screen with no pointer to hover with
 * (a phone) has no "under the pointer", so there the box is always shown.
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
        "group relative rounded border border-l-2 px-1.5 py-0.5 flex gap-1 cursor-pointer",
        fillHeight ? "items-start h-full" : "items-center",
        "text-[10px] leading-tight select-none touch-none",
        // Hex-source tasks override Tailwind palette via inline style below.
        !sourceHex && (colorBg[colorKey] || colorBg.slate),
        !sourceHex && (colorEdge[colorKey] || colorEdge.slate),
        // Room for the tick box wherever it is always shown, so the title
        // ends before it instead of running underneath.
        showCheckbox && (isDone ? "pr-5" : "[@media(hover:none)]:pr-5"),
        isDragging && "opacity-40",
        isDone && "opacity-60"
      )}
      style={
        sourceHex
          ? { backgroundColor: hexBg, borderColor: hexBorder, borderLeftColor: sourceHex }
          : undefined
      }
      title={task.title}
    >
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
      {showCheckbox && (
        <button
          type="button"
          data-testid={`calendar-tick-${task.id}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (task.status !== "done") setOptimisticDone(true);
            onToggleDone(task);
          }}
          className={cn(
            "absolute right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-sm border outline-none transition-opacity",
            "focus-visible:ring-2 focus-visible:ring-ink-500 dark:focus-visible:ring-ink-300",
            fillHeight ? "top-0.5" : "top-1/2 -translate-y-1/2",
            isDone
              ? "bg-sun-400 border-sun-500 text-ink-900 dark:border-sun-400"
              : cn(
                  "border-ink-400 bg-white hover:border-ink-700 dark:border-ink-500 dark:bg-night-sunken dark:hover:border-ink-300",
                  // Out of sight until the pointer or the keyboard is on the chip.
                  "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
                )
          )}
          aria-label={isDone ? "Mark incomplete" : "Mark done"}
        >
          {isDone && <Check className="w-2.5 h-2.5" strokeWidth={3.5} />}
        </button>
      )}
    </div>
  );
}
