// @ts-nocheck
import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CheckSquare,
  Trash2,
  Calendar,
  ChevronDown,
  ChevronRight,
  Plus,
  ArrowUp,
  ArrowDown,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const parseDateLocal = (str) => new Date(str + "T00:00:00");

const colorBg = {
  red: "bg-red-50 border-red-100",
  orange: "bg-orange-50 border-orange-100",
  yellow: "bg-yellow-50 border-yellow-100",
  green: "bg-green-50 border-green-100",
  blue: "bg-blue-50 border-blue-100",
  violet: "bg-violet-50 border-violet-100",
  pink: "bg-pink-50 border-pink-100",
  teal: "bg-teal-50 border-teal-100",
  cyan: "bg-cyan-50 border-cyan-100",
  rose: "bg-rose-50 border-rose-100",
  slate: "bg-slate-50 border-slate-100",
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const toDateStr = (date) => format(date, "yyyy-MM-dd");

function buildRecurrenceShortLabel(task) {
  if (task.task_type !== "recurring" || !task.recurrence || task.recurrence === "none") return null;
  if (task.recurrence === "custom_days" && task.recurrence_days?.length) {
    return task.recurrence_days.map((d) => DAY_LABELS[d]).join(", ");
  }
  const labels = {
    daily: "Daily",
    weekdays: "Weekdays",
    weekly: "Weekly",
    biweekly: "Biweekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    yearly: "Yearly",
  };
  return labels[task.recurrence] || "Repeat";
}

const fromDateStr = (str) => new Date(str + "T00:00:00");

export default function TaskCard({
  task, priorities, subtasks = [],
  onToggleDone, onEdit, onDelete, onAddSubtask,
  onUpdate, onEditSubtask, onReorderSubtasks,
}) {
  const [subtasksExpanded, setSubtasksExpanded] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [optimisticDone, setOptimisticDone] = useState(false);
  const [optimisticUndone, setOptimisticUndone] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const swipeStartX = useRef(null);
  const swipeStartY = useRef(null);
  const swipeLocked = useRef(false);
  const didSwipe = useRef(false);
  const cardRef = useRef(null);
  const swipeXRef = useRef(0);

  // Returns the delete threshold: 2/5 of the card's width
  const getThreshold = () => {
    const w = cardRef.current?.offsetWidth;
    return w ? w * 2 / 5 : 120;
  };

  // Reset optimistic state whenever the server/cache status changes
  useEffect(() => {
    setOptimisticDone(false);
    setOptimisticUndone(false);
  }, [task.id, task.status, task.due_date, task.completed_at]);

  // Auto-expand subtasks when new ones are added
  const prevSubtaskCount = useRef(subtasks.length);
  useEffect(() => {
    if (subtasks.length > prevSubtaskCount.current) {
      setSubtasksExpanded(true);
    }
    prevSubtaskCount.current = subtasks.length;
  }, [subtasks.length]);

  const isDone = (task.status === "done" || optimisticDone) && !optimisticUndone;
  const priority = priorities.find((p) => p.id === task.priority_id);

  const handleToggle = () => {
    if (task.status !== "done") setOptimisticDone(true);
    else setOptimisticUndone(true);
    onToggleDone(task);
  };

  // Unified pointer-based swipe (works for both touch and mouse drag)
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const onStart = (e) => {
      if (e.type === 'mousedown' && e.button !== 0) return;
      swipeStartX.current = e.type === 'mousedown' ? e.clientX : e.touches[0].clientX;
      swipeStartY.current = e.type === 'mousedown' ? e.clientY : e.touches[0].clientY;
      swipeLocked.current = false;
      didSwipe.current = false;
      swipeXRef.current = 0;
      setSwiping(false);
      setSwipeX(0);
    };

    const onMove = (e) => {
    if (swipeStartX.current === null) return;
    const isTouch = e.type === 'touchmove';
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;
    if (!isTouch && e.buttons !== 1) {
      swipeStartX.current = null;
      return;
    }
    const dx = clientX - swipeStartX.current;
    const dy = clientY - swipeStartY.current;

    if (!swipeLocked.current) {
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      // Determine zone: middle 3/5 vs outer 1/5 on each side
      const cardW = cardRef.current?.offsetWidth || 300;
      const relX = swipeStartX.current - (cardRef.current?.getBoundingClientRect().left || 0);
      const oneFifth = cardW / 5;
      const inMiddleZone = relX > oneFifth && relX < cardW - oneFifth;

      // Middle zone: ratio 4:1 (very strict), outer zones: ratio 3:1 (stricter than old 2:1)
      const ratio = inMiddleZone ? 4 : 3;

      if (adx > 10 && adx > ady * ratio) {
        swipeLocked.current = true;
      } else if (ady > 6) {
        // User is scrolling vertically — abort
        swipeStartX.current = null;
        return;
      } else {
        return;
      }
    }

      if (e.cancelable) e.preventDefault();
      swipeXRef.current = dx;
      didSwipe.current = Math.abs(dx) > 10;
      setSwiping(true);
      setSwipeX(dx);
    };

    const onEnd = () => {
      if (swipeStartX.current === null) { setSwiping(false); setSwipeX(0); return; }
      if (Math.abs(swipeXRef.current) >= getThreshold()) {
        onDelete(task);
      }
      setSwiping(false);
      setSwipeX(0);
      swipeXRef.current = 0;
      swipeStartX.current = null;
      // didSwipe.current stays true briefly so click handlers can check it
      setTimeout(() => { didSwipe.current = false; }, 50);
    };

    // Touch
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    // Mouse
    el.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('blur', onEnd);
    document.addEventListener('mouseleave', onEnd);

    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('mousedown', onStart);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('blur', onEnd);
      document.removeEventListener('mouseleave', onEnd);
    };
  }, [task, onDelete]);

  const doneSubtasks = subtasks.filter((s) => s.status === "done").length;
  const recurrenceLabel = buildRecurrenceShortLabel(task);

  const cardBg = priority ? colorBg[priority.color] || colorBg.slate : "bg-white border-slate-100";

  // Overdue: has a due_date, not done, and date is in the past (before today)
  const isOverdue = !isDone && task.due_date && parseDateLocal(task.due_date) < new Date(new Date().setHours(0,0,0,0));

  // Date display: show time if task has task_time
  const dateDisplay = (() => {
    if (!task.due_date) return null;
    if (task.task_time) {
      return `${format(parseDateLocal(task.due_date), "MMM d")}, ${task.task_time}`;
    }
    return format(parseDateLocal(task.due_date), "MMM d");
  })();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.1 }}
      className="relative"
      data-testid={`task-card-${task.id}`}
      data-task-title={task.title || ""}
    >
      {/* Swipe delete background */}
      {swiping && Math.abs(swipeX) > 20 && (() => {
        const willDelete = Math.abs(swipeX) >= getThreshold();
        return (
          <div className={cn(
            "absolute inset-0 rounded-xl flex items-center px-5 pointer-events-none z-0 transition-colors duration-100",
            willDelete ? "bg-red-500" : "bg-red-100",
            swipeX > 0 ? "justify-start" : "justify-end"
          )}>
            <Trash2 className={cn("w-5 h-5 transition-colors duration-100", willDelete ? "text-white" : "text-red-400")} />
          </div>
        );
      })()}
      <div
        ref={cardRef}
        className={cn(
          "group rounded-xl border transition-all hover:shadow-sm flex overflow-hidden relative z-10 select-none",
          cardBg,
          isDone && "opacity-55",
          swiping ? "cursor-grabbing" : "cursor-grab"
        )}
        style={swiping ? { transform: `translateX(${swipeX}px)`, transition: "none" } : { transform: "translateX(0)", transition: "transform 0.2s ease" }}
      >
        {/* Overdue left bar */}
        {isOverdue && <div className="w-1 shrink-0 bg-red-400 rounded-l-xl" />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 px-3 py-2.5">
            {/* Completion button */}
            <button
              onPointerDown={(e) => { e.stopPropagation(); }}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleToggle(); }}
              data-testid={`task-toggle-${task.id}`}
              className={cn(
                "shrink-0 w-7 h-7 rounded-md border-2 flex items-center justify-center transition-all touch-manipulation",
                isDone && !optimisticUndone ? "bg-slate-900 border-slate-900 text-white" :
                "border-slate-300 hover:border-slate-500 bg-white/80"
              )}
            >
              {isDone && !optimisticUndone && <CheckSquare className="w-3.5 h-3.5 text-white" />}
            </button>

            {/* Title — clickable to edit */}
            <div
              className="flex-1 min-w-0 cursor-pointer py-1"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); if (didSwipe.current) return; onEdit(task); }}
            >
              <h3 className={cn(
                "text-sm font-medium text-slate-900 truncate",
                isDone && "line-through text-slate-400"
              )}>
                {task.title}
              </h3>
            </div>

            {/* Right side meta */}
            <div className="flex items-center gap-1.5 shrink-0 ml-1">
              {/* Tags — desktop only */}
              {task.tags?.length > 0 && (
                <div className="hidden sm:flex items-center gap-1">
                  {task.tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="text-[10px] font-medium text-slate-400 bg-white/70 px-1.5 py-0.5 rounded border border-slate-200">
                      {tag}
                    </span>
                  ))}
                  {task.tags.length > 2 && (
                    <span className="text-[10px] font-medium text-slate-400">+{task.tags.length - 2}</span>
                  )}
                </div>
              )}

              {/* Recurrence badge/dot */}
              {recurrenceLabel && (
                <RecurrenceBadge label={recurrenceLabel} />
              )}

              {/* Due date — inline popover */}
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  {task.due_date ? (
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="text-[11px] flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors text-slate-400 hover:bg-white/60"
                    >
                      <Calendar className="w-3 h-3" />
                      {dateDisplay}
                    </button>
                  ) : (
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="text-[11px] text-slate-300 hover:text-slate-400 px-1.5 py-0.5 rounded transition-colors"
                    >
                      <Calendar className="w-3 h-3" />
                    </button>
                  )}
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
                      }}>
                        Clear date
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>


            </div>
          </div>

          {/* Subtasks toggle */}
          {subtasks.length > 0 && (
            <div className="px-3 pb-2">
              <button
                onClick={() => setSubtasksExpanded(!subtasksExpanded)}
                className="text-[10px] text-slate-400 flex items-center gap-0.5"
              >
                {subtasksExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {doneSubtasks}/{subtasks.length} subtasks
              </button>
            </div>
          )}

          {/* Subtasks */}
          <AnimatePresence>
            {subtasksExpanded && subtasks.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="px-3 pb-3 ml-10 space-y-1.5 border-l-2 border-white/60 overflow-hidden"
              >
                {subtasks.map((sub, subIdx) => {
                  const subOverdue = sub.due_date && new Date(sub.due_date + "T00:00:00") < new Date(new Date().setHours(0,0,0,0)) && sub.status !== "done";
                  const moveSubtask = (dir) => {
                    if (!onReorderSubtasks) return;
                    const reordered = [...subtasks];
                    const newIdx = subIdx + dir;
                    if (newIdx < 0 || newIdx >= reordered.length) return;
                    [reordered[subIdx], reordered[newIdx]] = [reordered[newIdx], reordered[subIdx]];
                    onReorderSubtasks(reordered);
                  };
                  return (
                    <div
                      key={sub.id}
                      className="flex items-center gap-2 group/sub cursor-pointer"
                      onClick={() => { if (didSwipe.current) return; onEditSubtask ? onEditSubtask(sub) : onEdit(sub); }}
                    >
                      {onReorderSubtasks && (
                        <div className="flex flex-col gap-0.5 opacity-0 group-hover/sub:opacity-100 transition-opacity">
                          <button type="button" onClick={(e) => { e.stopPropagation(); moveSubtask(-1); }} disabled={subIdx === 0} className="disabled:opacity-20 text-slate-300 hover:text-slate-500 transition-colors">
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); moveSubtask(1); }} disabled={subIdx === subtasks.length - 1} className="disabled:opacity-20 text-slate-300 hover:text-slate-500 transition-colors">
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {subOverdue && <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />}
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleDone(sub); }}
                        className={cn(
                          "shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all touch-manipulation",
                          sub.status === "done" ? "bg-slate-900 border-slate-900 text-white" : "border-slate-300 hover:border-slate-500"
                        )}
                      >
                        {sub.status === "done" && <CheckSquare className="w-2.5 h-2.5" />}
                      </button>
                      <span className={cn("text-xs font-medium text-slate-900 flex-1 truncate", sub.status === "done" && "line-through text-slate-400")}>
                        {sub.title}
                      </span>
                      {sub.due_date && (
                        <span className={cn("text-[10px] shrink-0", subOverdue ? "text-red-400" : "text-slate-400")}>
                          {format(new Date(sub.due_date + "T00:00:00"), "MMM d")}{sub.task_time ? `, ${sub.task_time}` : ""}
                        </span>
                      )}
                      <button
                        className="opacity-0 group-hover/sub:opacity-100 text-slate-400 hover:text-red-400 transition-colors"
                        onClick={(e) => { e.stopPropagation(); if (didSwipe.current) return; onDelete(sub); }}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
                {onAddSubtask && (
                  <button
                    onClick={() => onAddSubtask(task)}
                    className="text-[10px] text-slate-400 hover:text-slate-600 flex items-center gap-1 mt-1 transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Add subtask
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// Shows badge when there's space (xs+), dot on very small screens
function RecurrenceBadge({ label }) {
  const isShort = label.length <= 15;
  if (isShort) {
    return (
      <>
        <span className="xs:hidden w-2 h-2 rounded-full bg-violet-600 shrink-0 inline-block" title={label} />
        <span className="hidden xs:inline text-[10px] font-medium text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded max-w-[120px] truncate shrink-0">
          {label}
        </span>
      </>
    );
  }
  return (
    <span className="w-2 h-2 rounded-full bg-violet-600 shrink-0 inline-block" title={label} />
  );
}
