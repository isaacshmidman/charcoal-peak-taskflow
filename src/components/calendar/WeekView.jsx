// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { addDays, startOfWeek, format, isSameDay } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import MiniMiniTaskCard from "./MiniMiniTaskCard";
import { parseTaskTime, compareTaskTime } from "@/lib/sort-helpers";
import { layoutTimedTasks } from "@/lib/calendar-layout";
import { toDateStr } from "./MonthCalendar";

const HOUR_HEIGHT = 44;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_HEADER_HEIGHT = 40; // day-of-week label + date number + py-1 padding
const COLLAPSE_KEY = "calendar_week_allday_collapsed";

const formatHour = (h) => {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
};

function AllDayCell({ dateStr, tasks, priorities, onTaskClick, onToggleDone, collapsed }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `allday-${dateStr}`,
    data: { kind: "allday", dateStr },
  });
  const visible = collapsed ? tasks.slice(0, 1) : tasks;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-1 min-w-0 border-l border-slate-100 dark:border-slate-800 p-1 space-y-0.5",
        collapsed && "overflow-hidden",
        isOver && "bg-blue-50/60 dark:bg-blue-950/30"
      )}
    >
      {visible.map((task) => (
        <MiniMiniTaskCard
          key={task.id}
          task={task}
          priorities={priorities}
          onClick={onTaskClick}
          onToggleDone={onToggleDone}
        />
      ))}
    </div>
  );
}

function TimedColumn({ date, timedTasks, priorities, onTaskClick, onToggleDone }) {
  const dateStr = toDateStr(date);
  const { setNodeRef, isOver } = useDroppable({
    id: `timed-${dateStr}`,
    data: { kind: "timed", dateStr, hourHeight: HOUR_HEIGHT },
  });
  const isToday = isSameDay(date, new Date());
  const nowMinutes = isToday
    ? new Date().getHours() * 60 + new Date().getMinutes()
    : null;

  const laidOut = useMemo(() => layoutTimedTasks(timedTasks), [timedTasks]);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-1 min-w-0 border-l border-slate-100 dark:border-slate-800 relative",
        isOver && "bg-blue-50/60 dark:bg-blue-950/30"
      )}
      style={{ height: HOURS.length * HOUR_HEIGHT }}
    >
      {HOURS.map((h) => (
        <div
          key={h}
          className="absolute left-0 right-0 border-t border-slate-100 dark:border-slate-800"
          style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
        />
      ))}

      {nowMinutes != null && (
        <div
          className="absolute left-0 right-0 border-t-2 border-red-500 pointer-events-none z-10"
          style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
        >
          <span className="absolute -top-1.5 -left-1.5 w-3 h-3 rounded-full bg-red-500" />
        </div>
      )}

      {laidOut.map(({ task, startMin, endMin, col, cols, colSpan }) => {
        const top = (startMin / 60) * HOUR_HEIGHT;
        const height = Math.max(22, ((endMin - startMin) / 60) * HOUR_HEIGHT);
        // Width = colSpan / cols (not 1 / cols) so events expand into
        // empty adjacent columns. See layoutTimedTasks.
        const widthPct = ((colSpan || 1) / cols) * 100;
        const leftPct = (col / cols) * 100;
        return (
          <div
            key={task.id}
            className="absolute px-0.5"
            style={{
              top,
              height,
              left: `${leftPct}%`,
              width: `${widthPct}%`,
            }}
          >
            <MiniMiniTaskCard
              task={task}
              priorities={priorities}
              onClick={onTaskClick}
              onToggleDone={onToggleDone}
              fillHeight
            />
          </div>
        );
      })}
    </div>
  );
}

function DayHeader({ date, onClick }) {
  const isToday = isSameDay(date, new Date());
  const dateStr = toDateStr(date);
  return (
    <button
      type="button"
      onClick={() => onClick?.(dateStr)}
      className={cn(
        "flex-1 min-w-0 border-l border-slate-100 dark:border-slate-800 py-1 text-center hover:bg-slate-50 dark:hover:bg-slate-800",
        isToday && "bg-red-50 dark:bg-red-950/30"
      )}
    >
      <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase">{format(date, "EEE")}</div>
      <div
        className={cn(
          "text-sm font-semibold",
          isToday ? "text-red-500" : "text-slate-900 dark:text-slate-100"
        )}
      >
        {format(date, "d")}
      </div>
    </button>
  );
}

/**
 * Week view — 7 day columns. All-day bar is a sticky overlay at the top with
 * a collapse toggle; the timed hour grid scrolls beneath it.
 */
export default function WeekView({
  anchorDate,
  tasks,
  priorities,
  onTaskClick,
  onToggleDone,
  onDayClick,
}) {
  const scrollRef = useRef(null);
  const weekStart = useMemo(
    () => startOfWeek(anchorDate, { weekStartsOn: 0 }),
    [anchorDate]
  );
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  // Default: all-day section starts COLLAPSED on first open (no stored
  // preference yet). Once the user explicitly expands or collapses it the
  // preference persists across visits. This keeps the timed grid prominent
  // for users with long lists of all-day items they'd otherwise have to
  // scroll past every time they switched to Week view.
  const [allDayCollapsed, setAllDayCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(COLLAPSE_KEY);
      if (stored === "1") return true;
      if (stored === "0") return false;
      return true; // default-collapsed for new users
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, allDayCollapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [allDayCollapsed]);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const d of days) map.set(toDateStr(d), { timed: [], allDay: [] });
    for (const t of tasks) {
      if (t.parent_id) continue;
      const bucket = map.get(t.due_date);
      if (!bucket) continue;
      if (parseTaskTime(t.task_time) != null) bucket.timed.push(t);
      else bucket.allDay.push(t);
    }
    for (const b of map.values()) {
      b.timed.sort((a, b2) => compareTaskTime(a.task_time, b2.task_time, "asc"));
    }
    return map;
  }, [tasks, days]);

  const maxAllDayCount = useMemo(() => {
    let max = 0;
    for (const d of days) {
      const count = byDay.get(toDateStr(d))?.allDay.length ?? 0;
      if (count > max) max = count;
    }
    return max;
  }, [byDay, days]);

  // Row height per task ≈ 1.625rem; pad 0.5rem.
  const expandedAllDayHeight = Math.max(1, maxAllDayCount) * 26 + 8;
  const collapsedAllDayHeight = 28; // 1.75rem
  const allDayHeight = allDayCollapsed
    ? collapsedAllDayHeight
    : expandedAllDayHeight;

  const dateKey = toDateStr(weekStart);
  // If today is in the visible week, auto-scroll so the red now-line sits
  // near the vertical center of the scroll area. Otherwise fall back to 7 AM.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const now = new Date();
    const nowInWeek = days.some((d) => isSameDay(d, now));
    if (nowInWeek) {
      const mins = now.getHours() * 60 + now.getMinutes();
      const target = (mins / 60) * HOUR_HEIGHT - el.clientHeight / 2;
      el.scrollTop = Math.max(0, target);
    } else {
      el.scrollTop = 7 * HOUR_HEIGHT;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  return (
    <div
      ref={scrollRef}
      className="border border-slate-100 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900/60 overflow-auto max-h-[75vh]"
    >
      <div className="min-w-full">
        {/* Sticky day-header row (on top) */}
        <div className="sticky top-0 z-40 bg-white dark:bg-slate-900/60 border-b border-slate-100 dark:border-slate-800">
          <div className="flex" style={{ height: DAY_HEADER_HEIGHT }}>
            <div className="w-12 shrink-0 border-r border-slate-100 dark:border-slate-800" />
            {days.map((d) => (
              <DayHeader key={toDateStr(d)} date={d} onClick={onDayClick} />
            ))}
          </div>
        </div>

        {/* Sticky all-day bar (directly below day headers) */}
        <div
          className="sticky z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-100 dark:border-slate-800"
          style={{ top: DAY_HEADER_HEIGHT }}
        >
          <div className="flex" style={{ height: allDayHeight }}>
            <div className="w-12 shrink-0 border-r border-slate-100 dark:border-slate-800 flex items-start justify-center pt-1">
              <button
                type="button"
                onClick={() => setAllDayCollapsed((v) => !v)}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                aria-label={allDayCollapsed ? "Expand all-day" : "Collapse all-day"}
              >
                {allDayCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
            </div>
            {days.map((d) => {
              const ds = toDateStr(d);
              const bucket = byDay.get(ds);
              return (
                <AllDayCell
                  key={ds}
                  dateStr={ds}
                  tasks={bucket?.allDay || []}
                  priorities={priorities}
                  onTaskClick={onTaskClick}
                  onToggleDone={onToggleDone}
                  collapsed={allDayCollapsed}
                />
              );
            })}
          </div>
        </div>

        {/* Timed grid */}
        <div className="flex">
          <div className="w-12 shrink-0 border-r border-slate-100 dark:border-slate-800 relative" style={{ height: HOURS.length * HOUR_HEIGHT }}>
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute left-0 right-0 text-[10px] text-slate-400 dark:text-slate-500 pl-1"
                style={{ top: h * HOUR_HEIGHT }}
              >
                {formatHour(h)}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const bucket = byDay.get(toDateStr(d));
            return (
              <TimedColumn
                key={toDateStr(d)}
                date={d}
                timedTasks={bucket?.timed || []}
                priorities={priorities}
                onTaskClick={onTaskClick}
                onToggleDone={onToggleDone}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
