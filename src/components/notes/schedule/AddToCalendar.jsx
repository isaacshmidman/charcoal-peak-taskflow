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
 * doesn't double it.
 *
 * A slot that only looks like a task already on that day — the same words,
 * leaving out little ones like "the", "at", "tmr" (backend/lib/similar-
 * tasks.js) — can be merged into it instead: the task keeps everything and
 * takes the slot's time, and no second task is added. By default the panel
 * asks, slot by slot, with a "Don't ask again" that says what will happen
 * from then on; the bottom of the panel changes that choice (saved to the
 * account). Tasks from a connected calendar, and repeating ones, are never
 * merged: it would move the real event, or every time it repeats.
 *
 * New tasks get what the task form gives a new task: the middle priority,
 * the account's reminder, no tags. Undo in the toast takes back what was
 * added and puts merged tasks back at their old times.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarPlus } from "lucide-react";
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
import { findSimilarTasks } from "@/lib/similar-tasks";
import { cn } from "@/lib/utils";

const dayLabel = (date) => format(fromDateStr(date), "EEE, MMM d");
const timeLabel = (time) => formatClock(parseClock(time) ?? 0);
const taskTimes = (task) => (task.task_time ? `${timeLabel(task.task_time)}${task.task_end_time ? ` – ${timeLabel(task.task_end_time)}` : ""}` : "no time");
const SIMILAR_KEY = ["scheduleSimilarTasks"];

/** The choice a match starts on: merge when it can, else leave the slot out. */
const firstChoice = (match) => (match.canMerge ? "merge" : "skip");

/**
 * @param {{ schedule: import("@/lib/schedule").Schedule }} props
 */
export default function AddToCalendar({ schedule }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const today = toDateStr(new Date());
  const tomorrow = toDateStr(addDays(new Date(), 1));
  const [date, setDate] = useState(today);
  const [picking, setPicking] = useState(false);
  // Slots the person left out, by id.
  const [leftOut, setLeftOut] = useState(() => new Set());
  const [adding, setAdding] = useState(false);
  // The prompt: what to do with each slot like a task already on the day.
  const [asking, setAsking] = useState(false);
  const [choices, setChoices] = useState(() => new Map());
  const [dontAsk, setDontAsk] = useState(false);
  const { createTask, updateTask, deleteTasks } = useOfflineMutation();

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
  const { data: similarChoice = "ask" } = useQuery({
    queryKey: SIMILAR_KEY,
    queryFn: () => apiClient.scheduleDefaults.getSimilarTasks(),
    enabled: open,
    retry: false,
  });
  const saveSimilarChoice = async (choice) => {
    const before = queryClient.getQueryData(SIMILAR_KEY) || "ask";
    queryClient.setQueryData(SIMILAR_KEY, choice);
    try {
      queryClient.setQueryData(SIMILAR_KEY, await apiClient.scheduleDefaults.setSimilarTasks(choice));
    } catch {
      queryClient.setQueryData(SIMILAR_KEY, before);
      showDeleteToast({ label: "Couldn’t save that choice. Check your connection and try again.", hideUndo: true, duration: 5000 });
    }
  };

  const rows = useMemo(
    () =>
      slotsAsTasks(schedule, date).map((task) => {
        const there = alreadyOnCalendar(tasks, task);
        return { ...task, there, on: !there && !leftOut.has(task.slotId) };
      }),
    [schedule, date, tasks, leftOut]
  );
  const toAdd = rows.filter((row) => row.on);
  const matches = useMemo(() => (similarChoice === "keep" ? [] : findSimilarTasks(toAdd, tasks)), [toAdd, tasks, similarChoice]);
  const matchBySlot = new Map(matches.map((match) => [match.slotId, match]));

  /** What each slot comes to: "add", "merge" or "skip". */
  const planFor = (chosen) =>
    toAdd.map((row) => {
      const match = matchBySlot.get(row.slotId);
      const choice = !match ? "add" : chosen.get(row.slotId) ?? firstChoice(match);
      return { row, match, action: choice === "keep" ? "add" : choice };
    });
  // Without asking, a match is merged if it can be, and left out if not.
  const automatic = () => new Map(matches.map((match) => [match.slotId, firstChoice(match)]));
  const count = (plan) => ({
    add: plan.filter((p) => p.action === "add").length,
    merge: plan.filter((p) => p.action === "merge").length,
  });
  const summary = ({ add, merge }) =>
    [add && `Add ${add} ${add === 1 ? "task" : "tasks"}`, merge && `${add ? "merge" : "Merge"} ${merge}`].filter(Boolean).join(" · ");

  const run = async (plan) => {
    if (adding) return;
    setAdding(true);
    // The task form's default: the middle priority by order.
    const sorted = [...priorities].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    const priority = sorted[Math.floor(sorted.length / 2)] || sorted[0] || null;
    const created = [];
    const merged = [];
    try {
      for (const { row, match, action } of plan) {
        const { slotId, there, on, ...task } = row;
        if (action === "merge") {
          merged.push({ id: match.task.id, task_time: match.task.task_time || "", task_end_time: match.task.task_end_time || "" });
          await updateTask(match.task.id, { task_time: task.task_time, task_end_time: task.task_end_time });
        } else if (action === "add") {
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
      }
    } finally {
      setAdding(false);
    }
    setOpen(false);
    const parts = [
      created.length && `added ${created.length} ${created.length === 1 ? "task" : "tasks"}`,
      merged.length && `merged ${merged.length} into ${merged.length === 1 ? "a task" : "tasks"} already there`,
    ].filter(Boolean);
    const said = parts.length ? parts.join(" and ") : "left every slot out";
    showDeleteToast({
      label: `${said[0].toUpperCase()}${said.slice(1)} on ${dayLabel(date)}.`,
      onUndo: parts.length
        ? async () => {
            if (created.length) await deleteTasks(created, { skipDeletedRecord: true });
            for (const { id, ...times } of merged) await updateTask(id, times);
          }
        : undefined,
      duration: 6000,
    });
  };

  const start = () => {
    if (!toAdd.length) return;
    if (matches.length && similarChoice === "ask") {
      setChoices(new Map());
      setDontAsk(false);
      setAsking(true);
      return;
    }
    run(planFor(automatic()));
  };

  const confirmAsked = () => {
    const plan = planFor(choices);
    if (dontAsk) saveSimilarChoice(plan.some((p) => p.action === "merge") ? "merge" : "keep");
    run(plan);
  };

  const pickDay = (next) => {
    setDate(next);
    setPicking(false);
  };

  const askedPlan = planFor(choices);
  const askedCounts = count(askedPlan);
  const wouldMerge = askedPlan.some((p) => p.action === "merge");

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setLeftOut(new Set());
          setPicking(false);
          setAsking(false);
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
        {asking ? (
          <SimilarPrompt
            date={date}
            plan={askedPlan}
            onChoose={(slotId, choice) => setChoices((current) => new Map(current).set(slotId, choice))}
            dontAsk={dontAsk}
            onDontAsk={setDontAsk}
            wouldMerge={wouldMerge}
            onBack={() => setAsking(false)}
            onConfirm={confirmAsked}
            confirmLabel={summary(askedCounts) || "Done"}
            busy={adding}
          />
        ) : (
          <>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Add to calendar</p>
              <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
                Each slot with something in it becomes a task at its times, on the day you choose.
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Day</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip selected={date === today && !picking} onClick={() => pickDay(today)}>
                  Today
                </Chip>
                <Chip selected={date === tomorrow && !picking} onClick={() => pickDay(tomorrow)}>
                  Tomorrow
                </Chip>
                <Chip selected={picking || (date !== today && date !== tomorrow)} onClick={() => setPicking((p) => !p)} testId="add-to-calendar-pick">
                  {date !== today && date !== tomorrow ? dayLabel(date) : "Pick a day"}
                </Chip>
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
              onClick={start}
              disabled={!toAdd.length || adding}
              data-testid="add-to-calendar-confirm"
              className="h-9 w-full bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
            >
              {!toAdd.length
                ? "Nothing to add"
                : matches.length && similarChoice === "merge"
                  ? `${summary(count(planFor(automatic())))} on ${dayLabel(date)}`
                  : `Add ${toAdd.length} ${toAdd.length === 1 ? "task" : "tasks"} to ${dayLabel(date)}`}
            </Button>

            <div className="space-y-1.5 border-t border-border-hairline pt-3">
              <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">When a slot looks like a task already on that day</p>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="When a slot looks like a task already on that day">
                {[
                  ["ask", "Ask me"],
                  ["merge", "Merge"],
                  ["keep", "Keep both"],
                ].map(([value, label]) => (
                  <Chip key={value} role="radio" selected={similarChoice === value} onClick={() => saveSimilarChoice(value)} testId={`similar-${value}`}>
                    {label}
                  </Chip>
                ))}
              </div>
              <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
                Alike means the same words, leaving out little ones like “the”, “at” or “tmr”. Merging moves the task you have to the slot’s time instead
                of adding another.
              </p>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The prompt: each slot that looks like a task already on the day. */
function SimilarPrompt({ date, plan, onChoose, dontAsk, onDontAsk, wouldMerge, onBack, onConfirm, confirmLabel, busy }) {
  const asked = plan.filter((p) => p.match);
  return (
    <div className="space-y-3" data-testid="similar-prompt">
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="-ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-[#1f1f1f] dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Already on {dayLabel(date)}?</p>
          <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
            {asked.length === 1 ? "This slot looks like a task you already have that day." : "These slots look like tasks you already have that day."}
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {asked.map(({ row, match, action }) => {
          const options = match.canMerge
            ? [
                ["merge", "Merge"],
                ["keep", "Keep both"],
              ]
            : [
                ["skip", "Skip this slot"],
                ["keep", "Keep both"],
              ];
          const shown = action === "add" ? "keep" : action;
          return (
            <li key={row.slotId} className="space-y-1.5 rounded-md border border-border-hairline p-2" data-testid="similar-match">
              <div className="text-xs">
                <p className="text-slate-900 dark:text-slate-100">
                  <span className="font-medium">{row.title}</span>
                  <span className="text-slate-500 dark:text-slate-400"> · {timeLabel(row.task_time)} – {timeLabel(row.task_end_time)}</span>
                </p>
                <p className="text-slate-500 dark:text-slate-400">
                  looks like “{match.task.title}” · {taskTimes(match.task)}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`What to do with ${row.title}`}>
                {options.map(([value, label]) => (
                  <Chip key={value} role="radio" selected={shown === value} onClick={() => onChoose(row.slotId, value)}>
                    {label}
                  </Chip>
                ))}
              </div>
              <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
                {!match.canMerge
                  ? match.why === "calendar"
                    ? "It’s from a connected calendar, so it can’t be moved here."
                    : "It repeats, so merging would move every time it comes round."
                  : shown === "merge"
                    ? `“${match.task.title}” moves to ${timeLabel(row.task_time)} – ${timeLabel(row.task_end_time)}; no new task.`
                    : `“${row.title}” is added as its own task.`}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="space-y-0.5">
        {/* Not a <label> around the checkbox: see the slot rows. */}
        <div className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-200" onClick={() => onDontAsk(!dontAsk)}>
          <Checkbox size="sm" checked={dontAsk} aria-label="Don’t ask again" onClick={(event) => event.stopPropagation()} onCheckedChange={onDontAsk} />
          Don’t ask again
        </div>
        {dontAsk && (
          <p className="pl-6 text-[11px] leading-snug text-slate-400 dark:text-slate-500" data-testid="dont-ask-note">
            {wouldMerge
              ? "From now on, slots like tasks already there are merged without asking."
              : "From now on, slots like tasks already there are added on their own without asking."}{" "}
            Change it at the bottom of Add to calendar.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onBack} className="h-9">
          Back
        </Button>
        <Button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          data-testid="similar-confirm"
          className="h-9 flex-1 bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

function Chip({ selected, onClick, children, testId, role }) {
  return (
    <button
      type="button"
      role={role}
      aria-pressed={role ? undefined : selected}
      aria-checked={role === "radio" ? selected : undefined}
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
