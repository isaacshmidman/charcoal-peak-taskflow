// @ts-nocheck
/**
 * @file Review — a calm daily/weekly look at what happened and what
 * carries over. Entirely client-side (the ["tasks"] cache). The daily
 * tab lists overdue tasks with checkboxes and one gentle bulk action:
 * move the checked ones to today. "Leave them" is always equal-weight —
 * reassurance, never pressure.
 */
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns/format";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { computeDailyReview, computeWeeklyReview } from "@/lib/reviewStats";
import { cn } from "@/lib/utils";

function summaryLine({ doneYesterday, doneToday, waiting }) {
  const parts = [];
  if (doneYesterday) parts.push(`${doneYesterday} finished yesterday`);
  if (doneToday) parts.push(`${doneToday} finished today`);
  const done = parts.length ? parts.join(", ") + "." : "Nothing finished yet.";
  if (!waiting.length) return `${done} Nothing waiting. The slate is clean.`;
  return `${done} ${waiting.length} waiting from before — move ${waiting.length === 1 ? "it" : "them"} to today?`;
}

export default function ReviewDialog({ open, onOpenChange, tasks, onMoveToToday }) {
  const [tab, setTab] = useState("daily");
  const [checked, setChecked] = useState(() => new Set());

  const daily = useMemo(() => computeDailyReview(tasks), [tasks]);
  const weekly = useMemo(() => computeWeeklyReview(tasks), [tasks]);

  // Everything checked by default each time the dialog opens.
  useEffect(() => {
    if (open) {
      setTab("daily");
      setChecked(new Set(daily.waiting.map((t) => t.id)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const moveChecked = () => {
    onMoveToToday([...checked]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="review-dialog">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold flex items-center gap-3">
            Review
            <span className="flex gap-1 ml-auto">
              {["daily", "weekly"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={cn(
                    "px-2 py-0.5 rounded-lg text-[11px] font-medium transition-colors",
                    tab === k
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                  )}
                >
                  {k === "daily" ? "Daily" : "Weekly"}
                </button>
              ))}
            </span>
          </DialogTitle>
        </DialogHeader>

        {tab === "daily" ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="review-summary">
              {summaryLine(daily)}
            </p>

            {daily.waiting.length > 0 && (
              <>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {daily.waiting.map((task) => (
                    <label
                      key={task.id}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border-hairline bg-surface-card cursor-pointer"
                    >
                      <Checkbox
                        checked={checked.has(task.id)}
                        onCheckedChange={() => toggle(task.id)}
                      />
                      <span className="text-sm text-slate-900 dark:text-slate-100 flex-1 truncate">
                        {task.title}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                        {format(new Date(task.due_date + "T00:00:00"), "MMM d")}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={moveChecked}
                    disabled={checked.size === 0}
                    className="flex-1"
                    data-testid="review-move-today"
                  >
                    Move to today
                  </Button>
                  <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)}>
                    Leave them
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {weekly.doneThisWeek
                ? `The week settled: ${weekly.doneThisWeek} done.`
                : "A quiet week so far."}
            </p>
            {weekly.busiestTag && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Most of it was #{weekly.busiestTag.name} ({weekly.busiestTag.count}).
              </p>
            )}
            {weekly.oldestWaiting && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Longest waiting: “{weekly.oldestWaiting.title}” since{" "}
                {format(new Date(weekly.oldestWaiting.due_date + "T00:00:00"), "MMM d")}.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
