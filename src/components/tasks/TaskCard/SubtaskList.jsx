// @ts-nocheck
/**
 * @file Expandable subtask checklist within a TaskCard. Owns the
 * chevron toggle, the auto-expand-on-add behavior, the animated
 * open/close, per-subtask row (checkbox + title + due date + reorder +
 * delete), and the "Add subtask" trigger.
 *
 * State that moved here from TaskCard.jsx:
 *   - `subtasksExpanded` (was line 51 of original)
 *   - `prevSubtaskCount` ref + auto-expand effect (was lines 77–83)
 *
 * The parent's `didSwipeRef` is passed in so subtask click handlers
 * can still guard against accidental clicks during a horizontal swipe
 * on the parent card.
 */
// React default import is required: vitest's esbuild transform compiles
// JSX in this file to classic React.createElement calls (the app build
// uses the automatic runtime and doesn't need it).
import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns/format";
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function SubtaskList({
  task,
  subtasks,
  didSwipeRef,
  onToggleDone,
  onEdit,
  onEditSubtask,
  onDelete,
  onReorderSubtasks,
  onAddSubtask,
}) {
  const [subtasksExpanded, setSubtasksExpanded] = useState(false);
  const prevSubtaskCount = useRef(subtasks.length);

  useEffect(() => {
    if (subtasks.length > prevSubtaskCount.current) {
      setSubtasksExpanded(true);
    }
    prevSubtaskCount.current = subtasks.length;
  }, [subtasks.length]);

  const hasSubtasks = subtasks.length > 0;
  const showRows = subtasksExpanded && hasSubtasks;
  const doneSubtasks = subtasks.filter((s) => s.status === "done").length;
  const wasSwipe = () => !!didSwipeRef?.current;

  // OUTER collapse — the whole section (chevron row + subtask rows)
  // animates closed when the LAST subtask is deleted, instead of
  // unmounting at a render boundary. The early
  // `if (!subtasks.length) return null` we used to have made
  // TaskCard's root `motion.div layout` see a discrete height drop
  // at that boundary and scale-animate the card — squashing the
  // card's text during the contraction. With a CSS grid collapse the
  // height change happens gradually BETWEEN framer snapshots, so the
  // projection tree never sees a jump and the text never distorts.
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows] duration-200 ease-out",
        hasSubtasks ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      )}
      inert={hasSubtasks ? undefined : ""}
      aria-hidden={!hasSubtasks}
    >
      <div className="overflow-hidden min-h-0">
        <div className="px-3 pb-2">
          <button
            onClick={() => setSubtasksExpanded(!subtasksExpanded)}
            className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-0.5"
          >
            {subtasksExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {doneSubtasks}/{subtasks.length} subtasks
          </button>
        </div>

        {/* INNER collapse — the user-driven expand/collapse. Pure CSS
            grid-rows transition (0fr ↔ 1fr, the Radix-accordion trick)
            instead of a framer height tween, for the same reason as
            above: CSS changes height between framer snapshots, so the
            root card's layout projection never contests it and the
            cards below reflow natively every frame. Content stays
            mounted; `inert` keeps it out of the tab order. */}
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-out",
            showRows ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          )}
          inert={showRows ? undefined : ""}
          aria-hidden={!showRows}
        >
          <div className="overflow-hidden min-h-0">
            <div
              className={cn(
                "px-3 pb-3 ml-10 space-y-1.5 transition-opacity duration-200",
                showRows ? "opacity-100" : "opacity-0"
              )}
            >
            {/* Per-item AnimatePresence so deleting a subtask collapses
                its row before siblings reflow. layout="position" (NOT
                bare `layout`) on the rows: position-only FLIP translates
                siblings into place without the scale transforms that
                visibly stretch text mid-animation. */}
            <AnimatePresence initial={false}>
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
                  <motion.div
                    key={sub.id}
                    layout="position"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    transition={{
                      duration: 0.15,
                      ease: "easeOut",
                      layout: { duration: 0.15, ease: "easeOut" },
                    }}
                    className="flex items-center gap-2 group/sub cursor-pointer overflow-hidden"
                    onClick={() => { if (wasSwipe()) return; onEditSubtask ? onEditSubtask(sub) : onEdit(sub); }}
                  >
                    {onReorderSubtasks && (
                      <div className="flex flex-col gap-0.5 opacity-0 group-hover/sub:opacity-100 transition-opacity">
                        <button type="button" onClick={(e) => { e.stopPropagation(); moveSubtask(-1); }} disabled={subIdx === 0} className="disabled:opacity-20 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 transition-colors">
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); moveSubtask(1); }} disabled={subIdx === subtasks.length - 1} className="disabled:opacity-20 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 transition-colors">
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    {subOverdue && <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />}
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleDone(sub); }}
                      className={cn(
                        "shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all touch-manipulation",
                        sub.status === "done" ? "bg-slate-900 border-slate-900 text-white dark:bg-slate-100 dark:border-slate-100 dark:text-slate-900" : "border-slate-300 dark:border-slate-600 hover:border-slate-500 bg-white dark:bg-[#0c0c0c]"
                      )}
                    >
                      {sub.status === "done" && <CheckSquare className="w-2.5 h-2.5" />}
                    </button>
                    <span className={cn("text-xs font-medium text-slate-900 dark:text-slate-100 flex-1 truncate", sub.status === "done" && "line-through text-slate-400 dark:text-slate-500")}>
                      {sub.title}
                    </span>
                    {sub.due_date && (
                      <span className={cn("text-[10px] shrink-0", subOverdue ? "text-red-400" : "text-slate-400 dark:text-slate-500")}>
                        {format(new Date(sub.due_date + "T00:00:00"), "MMM d")}{sub.task_time ? `, ${sub.task_time}` : ""}
                      </span>
                    )}
                    <button
                      className="opacity-0 group-hover/sub:opacity-100 text-slate-400 dark:text-slate-500 hover:text-red-400 dark:hover:text-red-300 transition-colors"
                      onClick={(e) => { e.stopPropagation(); if (wasSwipe()) return; onDelete(sub); }}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
              {onAddSubtask && (
                <button
                  onClick={() => onAddSubtask(task)}
                  className="text-[10px] text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 flex items-center gap-1 mt-1 transition-colors"
                >
                  <Plus className="w-3 h-3" /> Add subtask
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
