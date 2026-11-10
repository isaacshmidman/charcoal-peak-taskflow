import { forwardRef, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns/format";
import { cn } from "@/lib/utils";
import { colorCheck } from "@/lib/colors";
import { Repeat } from "lucide-react";
import { fromDateStr, toDateStr } from "@/lib/dates";

/** @typedef {import("@/types/tasks").TaskRecord} TaskRecord */
/** @typedef {import("@/types/tasks").PriorityOption} PriorityOption */

/**
 * @typedef {{
 *   task: TaskRecord,
 *   priorities: PriorityOption[],
 *   onToggleDone: (task: TaskRecord) => void,
 *   onEdit: (task: TaskRecord) => void,
 *   onUpdate: (task: TaskRecord, changes: Partial<TaskRecord>) => void,
 * }} CompactTaskCardProps
 */

// forwardRef so <AnimatePresence mode="popLayout"> in Groupings can measure
// an exiting row and hold its box while it animates out — see TaskCard.
// The props typedef moved out of a @param and onto the const: attached to a
// forwardRef call, @param types nothing and props silently degrade to {}.
/** @type {import("react").ForwardRefExoticComponent<CompactTaskCardProps & import("react").RefAttributes<HTMLDivElement>>} */
const CompactTaskCard = forwardRef(function CompactTaskCard(
  { task, priorities, onToggleDone, onEdit, onUpdate },
  ref
) {
  const [dateOpen, setDateOpen] = useState(false);
  const [optimisticDone, setOptimisticDone] = useState(false);

  // Reset optimistic state when the task itself changes (e.g. recurring toggle moves the date)
  useEffect(() => { setOptimisticDone(false); }, [task.id, task.status, task.due_date]);

  const isDone = task.status === "done" || optimisticDone;
  const priority = priorities.find(p => p.id === task.priority_id);
  const isRecurring = task.task_type === "recurring" && task.recurrence && task.recurrence !== "none";

  // Priority is the colour of the tick box, as in the full task rows.
  const checkTone = priority ? colorCheck[priority.color] || colorCheck.slate : undefined;

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
      className={cn(
        "px-3 py-2 flex items-center gap-2.5 bg-surface-card hover:bg-ink-50 dark:hover:bg-night-raised transition-colors",
        isDone && "opacity-50"
      )}>
      {/* Checkbox — the DS ink-fill primitive at its dense-row size */}
      <Checkbox
        size="sm"
        tone={checkTone}
        checked={isDone}
        onClick={(e) => e.stopPropagation()}
        onCheckedChange={() => { if (task.status !== "done") setOptimisticDone(true); onToggleDone(task); }}
      />

      {/* Title */}
      <span
        onClick={() => onEdit(task)}
        className={cn(
          "flex-1 text-[13px] font-medium truncate cursor-pointer text-ink-900 dark:text-ink-100",
          isDone && "line-through text-ink-400 dark:text-ink-500"
        )}
      >
        {task.title}
      </span>

      {/* Right meta: recurrence dot + date — pushed all the way right */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {/* Recurrence dot — display only, not clickable */}
        {isRecurring && (
          <span title={task.recurrence} className="text-ink-400 dark:text-ink-500 shrink-0">
            <Repeat className="w-3 h-3" />
          </span>
        )}

        {/* Date chip */}
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "text-[11px] tabular-nums leading-none px-1 py-0.5 rounded transition-colors hover:bg-selected",
                task.due_date ? "text-ink-500 dark:text-ink-400" : "text-ink-300 dark:text-ink-600"
              )}
            >
              {task.due_date ? format(fromDateStr(task.due_date), "MMM d") : "–"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end" onClick={(e) => e.stopPropagation()}>
            <CalendarPicker
              mode="single"
              selected={task.due_date ? fromDateStr(task.due_date) : undefined}
              onSelect={(date) => {
                onUpdate && onUpdate(task, { due_date: date ? toDateStr(date) : "" });
                setDateOpen(false);
              }}
              showOutsideDays fixedWeeks
            />
            {task.due_date && (
              <div className="p-2 border-t border-ink-200 dark:border-night-line">
                <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => {
                  onUpdate && onUpdate(task, { due_date: "" });
                  setDateOpen(false);
                }}>Clear</Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </motion.div>
  );
});

export default CompactTaskCard;
