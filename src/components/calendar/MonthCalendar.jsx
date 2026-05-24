// @ts-nocheck
import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { addDays } from "date-fns/addDays";
import { endOfMonth } from "date-fns/endOfMonth";
import { endOfWeek } from "date-fns/endOfWeek";
import { format } from "date-fns/format";
import { isSameDay } from "date-fns/isSameDay";
import { isSameMonth } from "date-fns/isSameMonth";
import { startOfDay } from "date-fns/startOfDay";
import { startOfMonth } from "date-fns/startOfMonth";
import { startOfWeek } from "date-fns/startOfWeek";
import { cn } from "@/lib/utils";
import MiniMiniTaskCard from "./MiniMiniTaskCard";

const toDateStr = (date) => format(date, "yyyy-MM-dd");
const fromDateStr = (str) => new Date(str + "T00:00:00");

function DayCell({
  date,
  currentMonth,
  today,
  tasks,
  priorities,
  onTaskClick,
  onToggleDone,
  onDayEmptyClick,
}) {
  const dateStr = toDateStr(date);
  const { setNodeRef, isOver } = useDroppable({
    id: `day-${dateStr}`,
    data: { kind: "day", dateStr },
  });

  const inMonth = isSameMonth(date, currentMonth);
  // Bleed-in cells from adjacent months stay greyed out — never highlighted
  // as today, even when their date matches the real today.
  const isToday = inMonth && isSameDay(date, today);

  // Calendar.jsx already runs the multi-sort over `filteredTasks` and
  // bucketing by date is order-preserving — so the ordering the user
  // picked (priority, calendar order, all-day-first/last, etc.) is
  // already baked into the input. We MUST NOT re-sort by time here,
  // because that would override e.g. "All-Day First" by always pushing
  // all-day items to the bottom of each day's stack. Calendar.jsx
  // appends `compareTaskTime(...)` as the final tiebreaker after the
  // multi-sort comparators, so timed tasks within a day still come out
  // chronologically by default — we just trust that order.
  const sortedTasks = tasks;

  const handleEmptyClick = (e) => {
    if (e.target !== e.currentTarget) return;
    onDayEmptyClick?.(dateStr);
  };

  return (
    <div
      ref={setNodeRef}
      onClick={handleEmptyClick}
      className={cn(
        "flex flex-col border border-slate-100 dark:border-[#303030] rounded-md p-1 min-h-[5.5rem] transition-colors cursor-pointer",
        inMonth ? "bg-white dark:bg-[#0c0c0c]" : "bg-slate-50 dark:bg-[#151515]",
        isOver && "bg-blue-50 dark:bg-[#101f34] border-blue-200 dark:border-[#2f5f9c]"
      )}
    >
      <div
        className="flex items-center justify-end mb-1"
        onClick={handleEmptyClick}
      >
        <span
          className={cn(
            "text-[10px] leading-none w-5 h-5 flex items-center justify-center rounded-full",
            isToday
              ? "bg-red-500 text-white font-semibold"
              : inMonth
              ? "text-slate-500 dark:text-slate-400"
              : "text-slate-300 dark:text-slate-600"
          )}
        >
          {format(date, "d")}
        </span>
      </div>
      <div
        onClick={handleEmptyClick}
        className="flex-1 space-y-0.5 overflow-y-auto"
        style={{ maxHeight: "5rem" }}
      >
        {sortedTasks.map((task) => (
          <MiniMiniTaskCard
            key={task.id}
            task={task}
            priorities={priorities}
            onClick={onTaskClick}
            onToggleDone={onToggleDone}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Month calendar grid. Controlled: parent owns anchorDate + DndContext.
 * Always renders 6 rows × 7 cols for stable height.
 *
 * @param {{
 *   anchorDate: Date,
 *   tasks: Array<any>,
 *   priorities: Array<any>,
 *   onTaskClick: (task: any) => void,
 *   onToggleDone?: (task: any) => void,
 *   onDayEmptyClick?: (dateStr: string) => void,
 * }} props
 */
export default function MonthCalendar({
  anchorDate,
  tasks,
  priorities,
  onTaskClick,
  onToggleDone,
  onDayEmptyClick,
}) {
  const currentMonth = useMemo(() => startOfMonth(anchorDate), [anchorDate]);
  const today = useMemo(() => startOfDay(new Date()), []);

  // Render only as many rows as the month actually spans (4–6) so February
  // and other short months don't show a fully-empty trailing row. Leading
  // bleed-in days from the prior month and trailing bleed-in days from the
  // next month stay greyed out. Range: startOfWeek(startOfMonth) →
  // endOfWeek(endOfMonth).
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 });
    const out = [];
    let d = start;
    while (d <= end) {
      out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }, [currentMonth]);

  const tasksByDate = useMemo(() => {
    const map = new Map();
    for (const t of tasks) {
      if (!t.due_date || t.parent_id) continue;
      if (!map.has(t.due_date)) map.set(t.due_date, []);
      map.get(t.due_date).push(t);
    }
    return map;
  }, [tasks]);

  const weekDayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 px-0.5">
        {weekDayLabels.map((l) => (
          <div key={l} className="text-center py-1">
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const ds = toDateStr(d);
          const dayTasks = tasksByDate.get(ds) || [];
          return (
            <DayCell
              key={ds}
              date={d}
              currentMonth={currentMonth}
              today={today}
              tasks={dayTasks}
              priorities={priorities}
              onTaskClick={onTaskClick}
              onToggleDone={onToggleDone}
              onDayEmptyClick={onDayEmptyClick}
            />
          );
        })}
      </div>
    </div>
  );
}

export { toDateStr, fromDateStr };
