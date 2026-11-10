import { forwardRef, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns/format";
import { cn } from "@/lib/utils";
import { colorCheck } from "@/lib/colors";
import { CalendarDays, Repeat } from "lucide-react";
import { fromDateStr } from "@/lib/dates";
import { DatePopover } from "@/components/tasks/TaskForm/parts";
import { spacedTime } from "@/components/tasks/TaskForm/TimeInput";

/** @typedef {import("@/types/tasks").TaskRecord} TaskRecord */
/** @typedef {import("@/types/tasks").PriorityOption} PriorityOption */

/**
 * @typedef {{
 *   task: TaskRecord,
 *   priorities: PriorityOption[],
 *   onToggleDone: (task: TaskRecord) => void,
 *   onEdit: (task: TaskRecord) => void,
 *   onUpdate: (task: TaskRecord, changes: Partial<TaskRecord>) => void,
 *   meta?: "date" | "time",
 * }} CompactTaskCardProps
 *
 * `meta` is what the right-hand end of the row says. "date" (the default)
 * is the due date. "time" is for a column that is already one day — the
 * date would be the same on every row, so the row shows its time of day
 * instead, or just a small calendar mark when it has none. Either way it
 * is the button that moves the task to another day.
 */

// forwardRef so <AnimatePresence mode="popLayout"> in Groupings can measure
// an exiting row and hold its box while it animates out — see TaskCard.
// The props typedef moved out of a @param and onto the const: attached to a
// forwardRef call, @param types nothing and props silently degrade to {}.
/** @type {import("react").ForwardRefExoticComponent<CompactTaskCardProps & import("react").RefAttributes<HTMLDivElement>>} */
const CompactTaskCard = forwardRef(function CompactTaskCard(
  { task, priorities, onToggleDone, onEdit, onUpdate, meta = "date" },
  ref
) {
  const [optimisticDone, setOptimisticDone] = useState(false);

  // Reset optimistic state when the task itself changes (e.g. recurring toggle moves the date)
  useEffect(() => { setOptimisticDone(false); }, [task.id, task.status, task.due_date]);

  const isDone = task.status === "done" || optimisticDone;
  const priority = priorities.find(p => p.id === task.priority_id);
  const isRecurring = task.task_type === "recurring" && task.recurrence && task.recurrence !== "none";

  // Priority is the colour of the tick box, as in the full task rows.
  const checkTone = priority ? colorCheck[priority.color] || colorCheck.slate : undefined;

  const dateText = task.due_date ? format(fromDateStr(task.due_date), "MMM d") : "";
  const metaText = meta === "time" ? (task.task_time ? spacedTime(task.task_time) : "") : dateText;

  return (
    <motion.div
      layout
      ref={ref}
      // No mount animation: rows render where they belong instead of
      // sliding up as a list loads. `exit` still plays on delete.
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.1 }}
      data-testid={`compact-task-${task.id}`}
      className={cn(
        "group/row flex items-center gap-2.5 bg-surface-card px-3 py-2 transition-colors hover:bg-ink-50 dark:hover:bg-night-raised",
        isDone && "opacity-50"
      )}>
      {/* Checkbox — the DS ink-fill primitive at its dense-row size */}
      <Checkbox
        size="sm"
        tone={checkTone}
        checked={isDone}
        aria-label={isDone ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
        onClick={(e) => e.stopPropagation()}
        onCheckedChange={() => { if (task.status !== "done") setOptimisticDone(true); onToggleDone(task); }}
      />

      {/* Title — a real button, so the keyboard can open the task too. */}
      <button
        type="button"
        onClick={() => onEdit(task)}
        title={task.title}
        className={cn(
          "min-w-0 flex-1 truncate rounded text-left text-[13px] font-medium text-ink-900 outline-none focus-visible:underline dark:text-ink-100",
          isDone && "text-ink-400 line-through dark:text-ink-500"
        )}
      >
        {task.title}
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {isRecurring && (
          <span title="Repeats" className="shrink-0 text-ink-400 dark:text-ink-500">
            <Repeat className="h-3 w-3" />
          </span>
        )}

        <DatePopover
          value={task.due_date || ""}
          onChange={(next) => { if (next) onUpdate?.(task, { due_date: next }); }}
          align="end"
        >
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Change the date of ${task.title}${dateText ? ` (${dateText})` : ""}`}
            title="Change the date"
            className={cn(
              "inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-[11px] tabular-nums leading-none text-ink-500 transition-colors hover:bg-selected hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900/20 dark:focus-visible:ring-sun-400/40"
            )}
          >
            {metaText || <CalendarDays className="h-3.5 w-3.5 text-ink-300 group-hover/row:text-ink-500 dark:text-ink-600 dark:group-hover/row:text-ink-400" />}
          </button>
        </DatePopover>
      </div>
    </motion.div>
  );
});

export default CompactTaskCard;
