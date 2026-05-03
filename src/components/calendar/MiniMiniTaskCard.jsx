// @ts-nocheck
import { useState, useEffect } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CheckSquare, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { colorBg, isDarkColor, hexToRgba } from "@/lib/colors";

/**
 * Ultra-compact task chip for month-calendar day cells.
 * Smaller than CompactTaskCard: priority color bg, title, optional purple
 * recurrence dot, tiny checkbox to mark done. Click opens TaskForm.
 * Draggable between days.
 *
 * @param {{
 *   task: any,
 *   priorities: Array<{id: string, color?: string}>,
 *   onClick: (task: any) => void,
 *   onToggleDone?: (task: any) => void,
 * }} props
 */
export default function MiniMiniTaskCard({ task, priorities, onClick, onToggleDone, fillHeight = false }) {
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

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { taskId: task.id, task },
  });

  const dark = sourceHex ? false : isDarkColor(colorKey);
  const hexBg = sourceHex ? hexToRgba(sourceHex, 0.18) : null;
  const hexBorder = sourceHex ? hexToRgba(sourceHex, 0.45) : null;

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
              ? "bg-slate-900 border-slate-900 text-white dark:bg-slate-100 dark:border-slate-100 dark:text-slate-900"
              : dark
                ? "border-white/60 bg-white/20 dark:bg-white/10 hover:bg-white/40 dark:hover:bg-white/20"
                : "border-slate-400 bg-white/80 dark:bg-slate-900/80 hover:border-slate-600"
          )}
          aria-label={isDone ? "Mark incomplete" : "Mark done"}
        >
          {isDone && <CheckSquare className="w-2 h-2" />}
        </button>
      )}
      {isExternalEvent && !showCheckbox && (
        <CalendarDays
          className="w-2.5 h-2.5 shrink-0 text-slate-500 dark:text-slate-400"
          aria-hidden
        />
      )}
      <span
        className={cn(
          "truncate flex-1",
          dark ? "text-white dark:text-slate-100" : "text-slate-900 dark:text-slate-100",
          isDone && "line-through"
        )}
      >
        {task.title}
      </span>
      {isRecurring && (
        <span className="w-1.5 h-1.5 rounded-full bg-violet-600 shrink-0" />
      )}
    </div>
  );
}
