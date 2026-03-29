// @ts-nocheck
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { CheckSquare } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const toDateStr = (date) => format(date, "yyyy-MM-dd");
const fromDateStr = (str) => new Date(str + "T00:00:00");

const RECURRENCE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

export default function CompactTaskCard({ task, priorities, onToggleDone, onEdit, onUpdate }) {
  const [dateOpen, setDateOpen] = useState(false);
  const [recurrenceOpen, setRecurrenceOpen] = useState(false);
  const [optimisticDone, setOptimisticDone] = useState(false);

  // Reset optimistic state when the task itself changes (e.g. recurring toggle moves the date)
  useEffect(() => { setOptimisticDone(false); }, [task.id, task.status, task.due_date]);

  const isDone = task.status === "done" || optimisticDone;
  const priority = priorities.find(p => p.id === task.priority_id);
  const isRecurring = task.task_type === "recurring" && task.recurrence && task.recurrence !== "none";

  const colorCardBg = {
    red: "bg-red-50 border-red-200", orange: "bg-orange-50 border-orange-200",
    yellow: "bg-yellow-50 border-yellow-200", green: "bg-green-50 border-green-200",
    blue: "bg-blue-50 border-blue-200", violet: "bg-violet-50 border-violet-200",
    pink: "bg-pink-50 border-pink-200", teal: "bg-teal-50 border-teal-200",
    cyan: "bg-cyan-50 border-cyan-200", rose: "bg-rose-50 border-rose-200",
    slate: "bg-slate-50 border-slate-200",
  };

  const cardStyle = priority ? (colorCardBg[priority.color] || colorCardBg.slate) : "bg-white border-slate-100";

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
          isDone ? "bg-slate-900 border-slate-900 text-white" : "border-slate-300 hover:border-slate-500 bg-white/80"
        )}
      >
        {isDone && <CheckSquare className="w-2.5 h-2.5" />}
      </button>

      {/* Title */}
      <span
        onClick={() => onEdit(task)}
        className={cn("flex-1 text-xs font-medium text-slate-900 truncate cursor-pointer", isDone && "line-through text-slate-400")}
      >
        {task.title}
      </span>

      {/* Right meta: recurrence dot + date — pushed all the way right */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {/* Recurrence dot */}
        {isRecurring && (
          <Popover open={recurrenceOpen} onOpenChange={setRecurrenceOpen}>
            <PopoverTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                title={task.recurrence}
                className="w-2 h-2 rounded-full bg-violet-600 shrink-0"
              />
            </PopoverTrigger>
            <PopoverContent className="w-40 p-2" align="end" onClick={(e) => e.stopPropagation()}>
              <p className="text-[10px] font-semibold text-slate-400 mb-1.5">Repeats</p>
              <div className="space-y-0.5">
                {RECURRENCE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      onUpdate && onUpdate(task, {
                        task_type: opt.value === "none" ? "one_time" : "recurring",
                        recurrence: opt.value === "none" ? "none" : opt.value,
                      });
                      setRecurrenceOpen(false);
                    }}
                    className={cn(
                      "w-full text-left text-xs px-2 py-1 rounded transition-colors",
                      task.recurrence === opt.value ? "bg-slate-900 text-white font-medium" : "text-slate-900 hover:bg-slate-50"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* Date chip */}
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "text-[10px] leading-none px-1 py-0.5 rounded transition-colors",
                task.due_date ? "text-slate-400" : "text-slate-300"
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
              <div className="p-2 border-t">
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