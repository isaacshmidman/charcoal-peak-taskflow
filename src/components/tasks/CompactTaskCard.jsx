import { forwardRef, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns/format";
import { cn } from "@/lib/utils";
import { colorBg, isDarkColor } from "@/lib/colors";
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
  const isDarkCard = isDarkColor(priority?.color);
  const isRecurring = task.task_type === "recurring" && task.recurrence && task.recurrence !== "none";

  const cardStyle = priority ? (colorBg[priority.color] || colorBg.slate) : "bg-surface-card border-border-hairline";

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
        "rounded-lg border px-2.5 py-2 flex items-center gap-2 hover:shadow-sm transition-all",
        cardStyle,
        isDone && "opacity-50"
      )}>
      {/* Checkbox — the DS ink-fill primitive at its dense-row size */}
      <Checkbox
        size="sm"
        checked={isDone}
        onClick={(e) => e.stopPropagation()}
        onCheckedChange={() => { if (task.status !== "done") setOptimisticDone(true); onToggleDone(task); }}
      />

      {/* Title */}
      <span
        onClick={() => onEdit(task)}
        className={cn(
          "flex-1 text-xs font-medium truncate cursor-pointer",
          isDarkCard ? "text-white dark:text-slate-100" : "text-slate-900 dark:text-slate-100",
          isDone && "line-through text-slate-400 dark:text-slate-500"
        )}
      >
        {task.title}
      </span>

      {/* Right meta: recurrence dot + date — pushed all the way right */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {/* Recurrence dot — display only, not clickable */}
        {isRecurring && (
          <span
            title={task.recurrence}
            className="w-2 h-2 rounded-full bg-violet-600 shrink-0"
          />
        )}

        {/* Date chip */}
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "text-[10px] leading-none px-1 py-0.5 rounded transition-colors hover:bg-white dark:hover:bg-[#222222]",
                task.due_date ? "text-slate-400 dark:text-slate-500" : "text-slate-300 dark:text-slate-600"
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
              <div className="p-2 border-t border-slate-200 dark:border-[#303030]">
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
