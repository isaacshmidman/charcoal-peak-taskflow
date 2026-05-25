// @ts-nocheck
/**
 * @file Default Calendar View dropdown — Day / Week / Month / Year.
 * Backs the localStorage `defaultCalendarView` key that the Calendar
 * page reads on initial mount.
 */
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CALENDAR_VIEWS = ["day", "week", "month", "year"];

export default function DefaultCalendarViewSection() {
  const stored = localStorage.getItem("defaultCalendarView");
  const [selected, setSelected] = useState(CALENDAR_VIEWS.includes(stored) ? stored : "month");

  const save = (val) => {
    const next = CALENDAR_VIEWS.includes(val) ? val : "month";
    setSelected(next);
    localStorage.setItem("defaultCalendarView", next);
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Default Calendar View</h2>
      <Select value={selected} onValueChange={save}>
        <SelectTrigger className="w-48 h-9 bg-white dark:bg-[#111111] dark:border-[#343434] text-sm font-medium text-slate-900 dark:text-slate-100">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-white dark:bg-[#111111] dark:border-[#343434]">
          <SelectItem value="day" className="text-sm font-medium text-slate-900 dark:text-slate-100">Day</SelectItem>
          <SelectItem value="week" className="text-sm font-medium text-slate-900 dark:text-slate-100">Week</SelectItem>
          <SelectItem value="month" className="text-sm font-medium text-slate-900 dark:text-slate-100">Month</SelectItem>
          <SelectItem value="year" className="text-sm font-medium text-slate-900 dark:text-slate-100">Year</SelectItem>
        </SelectContent>
      </Select>
    </section>
  );
}
