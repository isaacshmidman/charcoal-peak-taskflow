// @ts-nocheck
import { useMemo } from "react";
import {
  startOfYear,
  startOfMonth,
  startOfWeek,
  addDays,
  addMonths,
  format,
  isSameMonth,
  isSameDay,
  startOfDay,
} from "date-fns";
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
    <div className="p-2 rounded-lg border border-slate-100 bg-white">
      <div className="text-xs font-semibold text-slate-900 mb-1">
        {format(month, "MMMM")}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-[9px] text-slate-400 text-center mb-0.5">
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
                !inMonth && "text-slate-300",
                inMonth && !isToday && "text-slate-600 hover:bg-slate-100",
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
