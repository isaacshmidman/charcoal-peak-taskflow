// @ts-nocheck
/**
 * @file "Add to calendar" for a note's schedule, beside Advanced settings in
 * the note's header. Each slot with something in it becomes a task on the
 * day chosen, at its times (backend/lib/schedule.js slotsAsTasks) — so it
 * shows on the Calendar, and reaches a connected Google or Apple calendar
 * the way any task does.
 *
 * The day is the person's choice: today, tomorrow, or any day from the
 * calendar. Every slot can be left out, and one already on that day (same
 * title and times) is left out by itself, so adding a schedule twice
 * doesn't double it. Undo in the toast takes back what was added.
 *
 * Tasks get what the task form gives a new task: the middle priority, the
 * account's reminder, no tags.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus } from "lucide-react";
import { addDays } from "date-fns/addDays";
import { format } from "date-fns/format";
import { apiClient } from "@/api/apiClient";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { showDeleteToast } from "@/components/tasks/DeleteToast";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { fromDateStr, toDateStr } from "@/lib/dates";
import { alreadyOnCalendar, formatClock, parseClock, slotsAsTasks } from "@/lib/schedule";
import { cn } from "@/lib/utils";

const dayLabel = (date) => format(fromDateStr(date), "EEE, MMM d");
const timeLabel = (time) => formatClock(parseClock(time) ?? 0);

/**
 * @param {{ schedule: import("@/lib/schedule").Schedule }} props
 */
export default function AddToCalendar({ schedule }) {
  const [open, setOpen] = useState(false);
  const today = toDateStr(new Date());
  const tomorrow = toDateStr(addDays(new Date(), 1));
  const [date, setDate] = useState(today);
  const [picking, setPicking] = useState(false);
  // Slots the person left out, by id.
  const [leftOut, setLeftOut] = useState(() => new Set());
  const [adding, setAdding] = useState(false);
  const { createTask, deleteTasks } = useOfflineMutation();

  // The same caches the rest of the app reads.
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiClient.entities.Task.list("-created_date", 5000),
    enabled: open,
  });
  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => apiClient.entities.Priority.list("order", 50),
    enabled: open,
  });

  const rows = useMemo(
    () =>
      slotsAsTasks(schedule, date).map((task) => {
        const there = alreadyOnCalendar(tasks, task);
        return { ...task, there, on: !there && !leftOut.has(task.slotId) };
      }),
    [schedule, date, tasks, leftOut]
  );
  const toAdd = rows.filter((row) => row.on);

  const add = async () => {
    if (!toAdd.length || adding) return;
    setAdding(true);
    // The task form's default: the middle priority by order.
    const sorted = [...priorities].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    const priority = sorted[Math.floor(sorted.length / 2)] || sorted[0] || null;
    const created = [];
    try {
      for (const { slotId, there, on, ...task } of toAdd) {
        const saved = await createTask({
          ...task,
          status: "todo",
          task_type: "one_time",
          recurrence: "none",
          priority_id: priority?.id || "",
          tags: [],
          reminder: "",
          description: "",
          description_json: "",
        });
        if (saved?.id) created.push(saved.id);
      }
    } finally {
      setAdding(false);
    }
    setOpen(false);
    showDeleteToast({
      label: `Added ${created.length} ${created.length === 1 ? "task" : "tasks"} to ${dayLabel(date)}.`,
      onUndo: () => deleteTasks(created, { skipDeletedRecord: true }),
      duration: 6000,
    });
  };

  const pickDay = (next) => {
    setDate(next);
    setPicking(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setLeftOut(new Set());
          setPicking(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Add to calendar"
          title="Add to calendar"
          data-testid="schedule-add-to-calendar"
          className="h-8 w-8 shrink-0 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
        >
          <CalendarPlus className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className="max-h-[var(--radix-popover-content-available-height)] w-[min(20rem,calc(100vw-2rem))] space-y-3 overflow-y-auto border-border-hairline bg-surface-card p-4"
        data-testid="add-to-calendar-panel"
      >
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Add to calendar</p>
          <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
            Each slot with something in it becomes a task at its times, on the day you choose.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Day</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <DayChoice selected={date === today && !picking} onClick={() => pickDay(today)}>
              Today
            </DayChoice>
            <DayChoice selected={date === tomorrow && !picking} onClick={() => pickDay(tomorrow)}>
              Tomorrow
            </DayChoice>
            <DayChoice selected={picking || (date !== today && date !== tomorrow)} onClick={() => setPicking((p) => !p)} testId="add-to-calendar-pick">
              {date !== today && date !== tomorrow ? dayLabel(date) : "Pick a day"}
            </DayChoice>
          </div>
          {picking && (
            <div className="flex justify-center rounded-md border border-border-hairline">
              <Calendar
                mode="single"
                selected={fromDateStr(date)}
                defaultMonth={fromDateStr(date)}
                onSelect={(day) => {
                  if (day) pickDay(toDateStr(day));
                }}
                showOutsideDays
                fixedWeeks
              />
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Slots</p>
          {rows.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Nothing to add yet. Write what’s happening in a slot first.</p>
          ) : (
            <ul className="space-y-0.5" data-testid="add-to-calendar-slots">
              {rows.map((row) => {
                const toggle = (checked) =>
                  setLeftOut((current) => {
                    const next = new Set(current);
                    if (checked) next.delete(row.slotId);
                    else next.add(row.slotId);
                    return next;
                  });
                return (
                <li key={row.slotId}>
                  {/* Not a <label>: the checkbox is a button, and a label
                      clicks its button a second time, undoing the tick. */}
                  <div
                    onClick={() => {
                      if (!row.there) toggle(!row.on);
                    }}
                    className={cn(
                      "flex items-start gap-2 rounded-md px-1.5 py-1 text-xs",
                      row.there ? "text-slate-400 dark:text-slate-500" : "cursor-pointer text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-[#161616]"
                    )}
                  >
                    <Checkbox
                      size="sm"
                      checked={row.on}
                      disabled={row.there}
                      aria-label={`Add ${row.title}`}
                      onClick={(event) => event.stopPropagation()}
                      onCheckedChange={toggle}
                    />
                    <span className="w-[7.5rem] shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                      {timeLabel(row.task_time)} – {timeLabel(row.task_end_time)}
                    </span>
                    <span className="min-w-0 flex-1 break-words">
                      {row.title}
                      {row.there && <span className="block text-[10px]">Already on this day</span>}
                    </span>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </div>

        <Button
          type="button"
          onClick={add}
          disabled={!toAdd.length || adding}
          data-testid="add-to-calendar-confirm"
          className="h-9 w-full bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
        >
          {toAdd.length ? `Add ${toAdd.length} ${toAdd.length === 1 ? "task" : "tasks"} to ${dayLabel(date)}` : "Nothing to add"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function DayChoice({ selected, onClick, children, testId }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "h-7 rounded-md border px-2 text-xs transition-colors",
        selected
          ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
          : "border-border-hairline text-slate-600 hover:border-border-strong dark:text-slate-300"
      )}
    >
      {children}
    </button>
  );
}
