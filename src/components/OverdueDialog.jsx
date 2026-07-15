// @ts-nocheck
/**
 * @file Overdue Tasks — a single-purpose mover. Lists every overdue task
 * (already ordered by the Today sort settings and colored by priority)
 * with a checkbox, and one action: move the checked ones to today.
 * "Cancel" always closes. Client-side over the ["tasks"] cache.
 */
import { useEffect, useState } from "react";
import { format } from "date-fns/format";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { colorBg } from "@/lib/colors";
import { cn } from "@/lib/utils";

export default function OverdueDialog({ open, onOpenChange, overdueTasks = [], priorities = [], onMoveToToday }) {
  const [checked, setChecked] = useState(() => new Set());

  // Everything checked by default each time the dialog opens.
  useEffect(() => {
    if (open) setChecked(new Set(overdueTasks.map((t) => t.id)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const colorFor = (task) => {
    const p = priorities.find((x) => x.id === task.priority_id);
    return p ? (colorBg[p.color] || colorBg.slate) : "bg-surface-card border-border-hairline";
  };

  const moveChecked = () => {
    onMoveToToday([...checked]);
    onOpenChange(false);
  };

  const n = overdueTasks.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="overdue-dialog">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Overdue Tasks
          </DialogTitle>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5" data-testid="overdue-count">
            {n} Overdue Task{n === 1 ? "" : "s"}
          </p>
        </DialogHeader>

        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {overdueTasks.map((task) => (
            <label
              key={task.id}
              className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer", colorFor(task))}
            >
              <Checkbox checked={checked.has(task.id)} onCheckedChange={() => toggle(task.id)} />
              <span className="text-sm text-slate-900 dark:text-slate-100 flex-1 min-w-0 truncate">
                {task.title}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 shrink-0 ml-1">
                {format(new Date(task.due_date + "T00:00:00"), "MMM d")}
              </span>
            </label>
          ))}
        </div>

        <div className="flex gap-2 pt-1">
          <Button
            onClick={moveChecked}
            disabled={checked.size === 0}
            className="flex-1"
            data-testid="overdue-move-today"
          >
            Move to today
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
