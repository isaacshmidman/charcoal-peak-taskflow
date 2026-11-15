// @ts-nocheck
/**
 * @file What goes inside each block on Home. Every one is a small view
 * of something another page shows in full, and says where: its heading
 * is the link there (see pages/Home.jsx for which).
 *
 * The numbers come from lib/home-blocks.js. Nothing is worked out here.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { addDays } from "date-fns/addDays";
import { format } from "date-fns/format";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import CompactTaskCard from "@/components/tasks/CompactTaskCard";
import TitleTokenInput from "@/components/tasks/QuickAdd/TitleTokenInput";
import { spacedTime } from "@/components/tasks/TaskForm/TimeInput";
import { showDeleteToast } from "@/components/tasks/DeleteToast";
import { taskPagePath } from "@/hooks/useTagFilter";
import { toDateStr } from "@/lib/dates";
import { cn } from "@/lib/utils";

const quiet = "px-3.5 pb-4 pt-0.5 text-[13px] text-ink-400 dark:text-ink-500";
const moreLink =
  "block border-t border-border-hairline px-3.5 py-2 text-[12px] text-ink-500 outline-none transition-colors hover:text-ink-900 focus-visible:underline dark:text-ink-400 dark:hover:text-ink-100";

/** The current minute of the day, kept current, so "already over" is true as the day goes on. */
function useMinuteOfDay() {
  const read = () => { const now = new Date(); return now.getHours() * 60 + now.getMinutes(); };
  const [minute, setMinute] = useState(read);
  useEffect(() => {
    const timer = setInterval(() => setMinute(read()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return minute;
}

/**
 * A short list of task rows with "and N more" under it.
 * @param {{ tasks: any[], most: number, to: string, empty: string, meta?: "date" | "time", late?: boolean, ui: any, priorities: any[] }} props
 */
export function TaskRows({ tasks, most, to, empty, meta = "date", late = false, ui, priorities }) {
  if (!tasks.length) return <p className={quiet}>{empty}</p>;
  const shown = tasks.slice(0, most);
  const rest = tasks.length - shown.length;
  return (
    <div className="overflow-hidden rounded-b-xl border-t border-border-hairline">
      <div className="divide-y divide-border-hairline">
        {shown.map((task) => (
          <CompactTaskCard
            key={task.id}
            task={task}
            priorities={priorities}
            onToggleDone={ui.toggleDone}
            onEdit={ui.edit}
            onUpdate={ui.update}
            meta={meta}
            late={late}
          />
        ))}
      </div>
      {rest > 0 && (
        <Link to={to} className={moreLink}>
          and {rest} more
        </Link>
      )}
    </div>
  );
}

/** Today on the clock: events and timed tasks. */
export function ScheduleBlock({ rows, onEditTask }) {
  const navigate = useNavigate();
  const minute = useMinuteOfDay();
  if (!rows.length) return <p className={quiet}>Nothing on the clock today.</p>;
  return (
    <ul className="overflow-hidden rounded-b-xl border-t border-border-hairline">
      {rows.map((row) => {
        const over = row.start != null && (row.end ?? row.start) < minute;
        const sub = row.isEvent ? row.calendar || "Calendar" : "Task";
        return (
          <li key={row.id} className="border-b border-border-hairline last:border-b-0">
            <button
              type="button"
              onClick={() => (row.isEvent ? navigate("/Calendar") : onEditTask(row.task))}
              data-testid={`home-schedule-${row.id}`}
              className={cn(
                "flex w-full items-stretch gap-3 px-3.5 py-2 text-left outline-none transition-colors hover:bg-ink-50 focus-visible:bg-ink-50 dark:hover:bg-night-raised dark:focus-visible:bg-night-raised",
                over && "opacity-50",
              )}
            >
              <span className="w-[4.25rem] shrink-0 pt-px text-[12px] tabular-nums text-ink-500 dark:text-ink-400">
                {row.start == null ? "All day" : spacedTime(row.time)}
              </span>
              {/* The calendar's own colour for an event; plain ink for a task. */}
              <span
                aria-hidden="true"
                className={cn("w-0.5 shrink-0 rounded-full", !(row.isEvent && row.color) && "bg-ink-300 dark:bg-ink-600")}
                style={row.isEvent && row.color ? { backgroundColor: row.color } : undefined}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink-900 dark:text-ink-100">{row.title || "Untitled"}</span>
                <span className="block truncate text-[11px] text-ink-400 dark:text-ink-500">
                  {sub}
                  {row.start != null && row.endTime ? ` · until ${spacedTime(row.endTime)}` : ""}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Seven bars: how many tasks fall on each of the next seven days. */
export function WeekBlock({ days }) {
  const most = Math.max(1, ...days.map((day) => day.count));
  return (
    <div className="flex h-full min-h-[7.5rem] items-end gap-2 px-3.5 pb-3.5 pt-1" role="list" aria-label="Tasks due on each of the next seven days">
      {days.map((day) => (
        <div
          key={day.key}
          role="listitem"
          aria-label={`${format(day.date, "EEEE")}: ${day.count} ${day.count === 1 ? "task" : "tasks"}`}
          data-testid={`home-day-${day.key}`}
          className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
        >
          <span className={cn("text-[11px] tabular-nums", day.count ? "text-ink-700 dark:text-ink-200" : "text-ink-300 dark:text-ink-600")}>{day.count}</span>
          <span className="flex w-full max-w-[2.5rem] flex-1 items-end">
            <span
              className={cn(
                "block w-full rounded-t-[4px] rounded-b-[2px]",
                // Sun means "now": only today's bar is yellow.
                day.isToday ? "bg-sun-400" : "bg-ink-200 dark:bg-ink-700",
              )}
              style={{ height: day.count ? `${Math.max(8, Math.round((day.count / most) * 100))}%` : "2px" }}
            />
          </span>
          <span className={cn("text-[11px]", day.isToday ? "font-semibold text-ink-900 dark:text-ink-100" : "text-ink-400 dark:text-ink-500")}>
            {day.isToday ? "Today" : day.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Tags, busiest first, each a link to its tasks. */
export function TagsBlock({ ranking, most = 8 }) {
  if (!ranking.length) return <p className={quiet}>Tag a task and it is counted here.</p>;
  const shown = ranking.slice(0, most);
  const rest = ranking.length - shown.length;
  return (
    <div className="overflow-hidden rounded-b-xl pb-1.5">
      <ol>
        {shown.map((row) => (
          <li key={row.tag}>
            <Link
              to={taskPagePath("/Active", row.tag)}
              aria-label={`${row.tag}: ${row.count} open ${row.count === 1 ? "task" : "tasks"}`}
              data-testid={`home-tag-${row.tag}`}
              className="flex items-center gap-3 px-3.5 py-1.5 outline-none transition-colors hover:bg-ink-50 focus-visible:bg-ink-50 dark:hover:bg-night-raised dark:focus-visible:bg-night-raised"
            >
              <span className="w-24 shrink-0 truncate text-[13px] text-ink-800 dark:text-ink-200">{row.tag}</span>
              <span className="h-1.5 min-w-0 flex-1 rounded-full bg-ink-100 dark:bg-night-raised">
                <span className="block h-full rounded-full bg-ink-400 dark:bg-ink-400" style={{ width: `${Math.max(4, Math.round(row.share * 100))}%` }} />
              </span>
              <span className="w-6 shrink-0 text-right text-[12px] tabular-nums text-ink-500 dark:text-ink-400">{row.count}</span>
            </Link>
          </li>
        ))}
      </ol>
      {rest > 0 && <p className="px-3.5 pb-1 pt-1.5 text-[12px] text-ink-400 dark:text-ink-500">and {rest} more in the sidebar</p>}
    </div>
  );
}

/** How the week is going: finished, and still to do before it ends. */
export function DoneBlock({ progress }) {
  const { done, left, total } = progress;
  const share = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="px-3.5 pb-4 pt-0.5">
      <p className="flex items-baseline gap-2">
        <span className="text-[1.75rem] font-[650] leading-none tracking-tight tabular-nums text-ink-900 dark:text-ink-100" data-testid="home-done-number">{done}</span>
        <span className="text-[13px] text-ink-500 dark:text-ink-400">{done === 1 ? "task finished" : "tasks finished"}</span>
      </p>
      <div
        className="mt-3 h-1.5 rounded-full bg-ink-100 dark:bg-night-raised"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label="Finished this week, out of everything due by Saturday"
      >
        {/* Sun means "done". */}
        <div className="h-full rounded-full bg-sun-400" style={{ width: `${share}%` }} />
      </div>
      <p className="mt-2 text-[12px] text-ink-400 dark:text-ink-500">
        {left === 0 ? "Nothing else due this week." : `${left} still due by Saturday.`}
      </p>
    </div>
  );
}

/** Pinned notes; each opens in Notes. */
export function NotesBlock({ notes, most = 5 }) {
  if (!notes.length) return <p className={quiet}>Pin a note and it appears here.</p>;
  const shown = notes.slice(0, most);
  const rest = notes.length - shown.length;
  return (
    <div className="overflow-hidden rounded-b-xl border-t border-border-hairline">
      <ul className="divide-y divide-border-hairline">
        {shown.map((note) => {
          const edited = note.updated_date ? new Date(note.updated_date) : null;
          return (
            <li key={note.id}>
              <Link
                to={`/Notes?note=${encodeURIComponent(note.id)}`}
                data-testid={`home-note-${note.id}`}
                className="flex items-center gap-3 px-3.5 py-2 outline-none transition-colors hover:bg-ink-50 focus-visible:bg-ink-50 dark:hover:bg-night-raised dark:focus-visible:bg-night-raised"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-900 dark:text-ink-100">{note.title || "Untitled"}</span>
                {edited && !Number.isNaN(edited.getTime()) && (
                  <span className="shrink-0 text-[11px] tabular-nums text-ink-400 dark:text-ink-500">{format(edited, "MMM d")}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {rest > 0 && (
        <Link to="/Notes" className={moreLink}>
          and {rest} more
        </Link>
      )}
    </div>
  );
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** This month at a glance: today, and which days have something due. */
export function MonthBlock({ grid }) {
  return (
    <div className="px-3.5 pb-3.5 pt-0.5">
      <div className="grid grid-cols-7 text-center text-[11px] tabular-nums">
        {WEEKDAYS.map((name) => (
          <span key={name} aria-hidden="true" className="pb-1 text-ink-400 dark:text-ink-500">{name[0]}</span>
        ))}
        {grid.weeks.flat().map((day) => (
          <span
            key={day.key}
            data-testid={`home-month-${day.key}`}
            data-due={day.count || undefined}
            aria-label={day.inMonth ? `${day.day}${day.isToday ? ", today" : ""}${day.count ? `, ${day.count} due` : ""}` : undefined}
            aria-hidden={day.inMonth ? undefined : true}
            className="flex h-8 flex-col items-center justify-center"
          >
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full",
                !day.inMonth && "text-ink-300 dark:text-ink-700",
                day.inMonth && !day.isToday && "text-ink-700 dark:text-ink-200",
                // Sun means "now".
                day.isToday && "bg-sun-400 font-semibold text-ink-900",
              )}
            >
              {day.day}
            </span>
            <span className={cn("h-1 w-1 rounded-full", day.count && day.inMonth ? "bg-ink-400 dark:bg-ink-400" : "bg-transparent")} />
          </span>
        ))}
      </div>
    </div>
  );
}

const WHEN = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "none", label: "No date" },
];

/**
 * One line to add a task without opening the form. #tag and !priority
 * work as they do in the form's title; the day is chosen with the switch
 * beside it and never read out of the words.
 */
export function QuickAddBlock({ priorities, savedTags, todayStart, onCreate }) {
  const [form, setForm] = useState({ title: "", tags: [], priority_id: "" });
  const [when, setWhen] = useState("today");
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);
  const title = form.title.trim();
  const priority = priorities.find((item) => item.id === form.priority_id);

  const add = async () => {
    if (!title || busy) return;
    const day = when === "none" ? "" : toDateStr(when === "tomorrow" ? addDays(todayStart, 1) : todayStart);
    // No priority chosen: the middle one, as the task form starts with.
    const fallback = priorities[Math.floor(priorities.length / 2)] || priorities[0] || null;
    setBusy(true);
    try {
      await onCreate({
        title,
        description: "",
        description_json: "",
        priority_id: form.priority_id || fallback?.id || "",
        status: "todo",
        task_type: "one_time",
        recurrence: "none",
        recurrence_days: [],
        recurrence_end_date: "",
        due_date: day,
        task_time: "",
        task_end_time: "",
        tags: form.tags,
        reminder: "",
      });
      setForm({ title: "", tags: [], priority_id: "" });
      showDeleteToast({ label: `Added “${title}”`, hideUndo: true, duration: 2500 });
      wrapRef.current?.querySelector("[data-title-input]")?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-3.5 pb-3.5 pt-0.5" ref={wrapRef}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-[12rem] flex-1 rounded-lg border border-border-strong bg-surface-page px-3 py-[0.4375rem] focus-within:border-ink-400 dark:bg-night-sunken dark:focus-within:border-ink-500">
          <TitleTokenInput
            form={form}
            setForm={setForm}
            grammar={{ tags: true, priority: true }}
            priorities={priorities}
            savedTags={savedTags}
            placeholder="Add a task"
            testid="home-quick-title"
            inputClassName="text-base leading-5 sm:text-sm sm:leading-5"
            onEnter={add}
          />
        </div>
        <div role="group" aria-label="When" className="ds-seg h-9">
          {WHEN.map((option) => (
            <button
              key={option.key}
              type="button"
              className="ds-seg-item px-2.5 text-[12px]"
              aria-pressed={when === option.key}
              onClick={() => setWhen(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Button type="button" className="h-9 gap-1.5" onClick={add} disabled={!title || busy} data-testid="home-quick-add">
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>
      {(form.tags.length > 0 || priority) && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-500 dark:text-ink-400">
          {priority && (
            <span className="inline-flex items-center gap-1">
              {priority.name}
              <button
                type="button"
                className="rounded text-ink-300 hover:text-red-400 dark:text-ink-600 dark:hover:text-red-300"
                aria-label={`Remove the priority ${priority.name}`}
                onClick={() => setForm((current) => ({ ...current, priority_id: "" }))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {form.tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1">
              #{tag}
              <button
                type="button"
                className="rounded text-ink-300 hover:text-red-400 dark:text-ink-600 dark:hover:text-red-300"
                aria-label={`Remove the tag ${tag}`}
                onClick={() => setForm((current) => ({ ...current, tags: current.tags.filter((item) => item !== tag) }))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
