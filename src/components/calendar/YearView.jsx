// @ts-nocheck
import { useMemo } from "react";
import { addDays } from "date-fns/addDays";
import { addMonths } from "date-fns/addMonths";
import { format } from "date-fns/format";
import { isSameDay } from "date-fns/isSameDay";
import { isSameMonth } from "date-fns/isSameMonth";
import { startOfDay } from "date-fns/startOfDay";
import { startOfMonth } from "date-fns/startOfMonth";
import { startOfWeek } from "date-fns/startOfWeek";
import { startOfYear } from "date-fns/startOfYear";
import { cn } from "@/lib/utils";
import { toDateStr } from "./MonthCalendar";

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

function MiniMonth({ month, onDayClick }) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
    // Always render 42 cells (6 rows × 7 cols) for stable height.
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month]);

  return (
    <div className="p-2 rounded-lg border border-slate-100 dark:border-[#303030] bg-white dark:bg-[#0c0c0c]">
      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1">
        {format(month, "MMMM")}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-[9px] text-slate-400 dark:text-slate-500 text-center mb-0.5">
        {WEEKDAY_LETTERS.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d) => {
          const inMonth = isSameMonth(d, month);
          // Only highlight the today-cell on its OWN month — bleed-in cells
          // from adjacent months should stay greyed out, never red.
          const isToday = inMonth && isSameDay(d, today);
          return (
            <button
              type="button"
              key={toDateStr(d)}
              onClick={() => onDayClick?.(toDateStr(d))}
              className={cn(
                "text-[10px] aspect-square flex items-center justify-center rounded-full",
                !inMonth && "text-slate-300 dark:text-slate-600",
                inMonth && !isToday && "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#222222]",
                isToday && "bg-red-500 text-white font-semibold"
              )}
            >
              {format(d, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Year view — 4×3 grid of mini-month calendars.
 * Click any day → parent switches to DayView for that date.
 */
export default function YearView({ anchorDate, onDayClick }) {
  const year = useMemo(() => startOfYear(anchorDate), [anchorDate]);
  const months = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => addMonths(year, i));
  }, [year]);

  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {months.map((m) => (
        <MiniMonth key={format(m, "yyyy-MM")} month={m} onDayClick={onDayClick} />
      ))}
    </div>
  );
}
