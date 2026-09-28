// @ts-nocheck
/**
 * @file One timed event on the Day/Week hour grid: positioned from its
 * layout slot, and — unless it's from a read-only calendar — with a strip
 * along its bottom edge that can be dragged to change when it ends
 * (useResizeDuration). Both views render events through this, so they
 * can't drift apart.
 */
import MiniMiniTaskCard from "./MiniMiniTaskCard";
import { slotLabel, timeRangeLabel } from "./useEmptySlotClick";
import { useResizeDuration } from "./useResizeDuration";
import { isReadOnlyTask } from "@/lib/task-filters";
import { cn } from "@/lib/utils";

export default function TimedEventBlock({
  layout, // { task, startMin, endMin, col, cols, colSpan } from layoutTimedTasks
  hourHeight,
  minHeight,
  priorities,
  onTaskClick,
  onToggleDone,
  onResize, // (task, endMinutes) => void
}) {
  const { task, startMin, endMin, col, cols, colSpan } = layout;
  const canResize = Boolean(onResize) && !isReadOnlyTask(task);
  const { previewEnd, resizing, handleProps } = useResizeDuration({
    startMin,
    endMin,
    hourHeight,
    onResize: (end) => onResize?.(task, end),
  });
  const shownEnd = previewEnd ?? endMin;

  // Width = colSpan / cols (not 1 / cols) so events expand into empty
  // adjacent columns. See layoutTimedTasks.
  const widthPct = ((colSpan || 1) / cols) * 100;
  const leftPct = (col / cols) * 100;

  return (
    <div
      data-testid={`calendar-event-${task.id}`}
      className={cn("group/event absolute px-0.5", resizing && "z-30")}
      style={{
        top: (startMin / 60) * hourHeight,
        height: Math.max(minHeight, ((shownEnd - startMin) / 60) * hourHeight),
        left: `${leftPct}%`,
        width: `${widthPct}%`,
      }}
    >
      <MiniMiniTaskCard
        task={task}
        priorities={priorities}
        onClick={onTaskClick}
        onToggleDone={onToggleDone}
        fillHeight
      />

      {canResize && (
        <div
          {...handleProps}
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Change when ${task.title || "this task"} ends`}
          aria-valuemin={startMin + 15}
          aria-valuemax={24 * 60 - 1}
          aria-valuenow={shownEnd}
          aria-valuetext={`Ends ${slotLabel(shownEnd)}`}
          tabIndex={0}
          title="Drag (or use ↑/↓) to change the end time"
          data-testid={`calendar-resize-${task.id}`}
          data-no-create=""
          // A strip across the bottom edge: easy to grab, invisible until
          // hovered or focused. touch-none so a finger drags it instead of
          // scrolling.
          className="group/handle absolute inset-x-1 bottom-0 flex h-2 cursor-ns-resize touch-none items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-slate-500 dark:focus-visible:ring-slate-300"
        >
          <span
            className={cn(
              "mb-0.5 h-0.5 w-6 rounded-full bg-slate-500/70 transition-opacity dark:bg-slate-300/70",
              resizing ? "opacity-100" : "opacity-0 group-hover/event:opacity-100 group-focus-visible/handle:opacity-100"
            )}
          />
        </div>
      )}

      {resizing && (
        <div
          data-testid="calendar-resize-time"
          className="pointer-events-none absolute left-0.5 top-full z-40 mt-1 whitespace-nowrap rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow dark:bg-slate-100 dark:text-slate-900"
        >
          {timeRangeLabel(startMin, shownEnd)}
        </div>
      )}
    </div>
  );
}
