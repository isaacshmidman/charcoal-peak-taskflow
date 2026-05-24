// @ts-nocheck
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { CheckSquare } from "lucide-react";
import { format } from "date-fns/format";
import { cn } from "@/lib/utils";
import { colorBg, isDarkColor } from "@/lib/colors";

const toDateStr = (date) => format(date, "yyyy-MM-dd");
const fromDateStr = (str) => new Date(str + "T00:00:00");

export default function CompactTaskCard({ task, priorities, onToggleDone, onEdit, onUpdate }) {
  const [dateOpen, setDateOpen] = useState(false);
  const [optimisticDone, setOptimisticDone] = useState(false);

  // Reset optimistic state when the task itself changes (e.g. recurring toggle moves the date)
  useEffect(() => { setOptimisticDone(false); }, [task.id, task.status, task.due_date]);

  const isDone = task.status === "done" || optimisticDone;
  const priority = priorities.find(p => p.id === task.priority_id);
  const isDarkCard = isDarkColor(priority?.color);
  const isRecurring = task.task_type === "recurring" && task.recurrence && task.recurrence !== "none";

  const cardStyle = priority ? (colorBg[priority.color] || colorBg.slate) : "bg-white dark:bg-[#111111] border-slate-100 dark:border-[#303030]";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.1 }}
      className={cn(
        "rounded-lg border px-2.5 py-2 flex items-center gap-2 hover:shadow-sm transition-all",
        cardStyle,
        isDone && "opacity-50"
      )}>
      {/* Checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); if (task.status !== "done") setOptimisticDone(true); onToggleDone(task); }}
        className={cn(
          "shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all",
          isDone ? "bg-slate-900 border-slate-900 text-white dark:bg-slate-100 dark:border-slate-100 dark:text-slate-900" : "border-slate-300 dark:border-slate-600 hover:border-slate-500 bg-white dark:bg-[#0c0c0c]"
        )}
      >
        {isDone && <CheckSquare className="w-2.5 h-2.5" />}
      </button>

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
}
