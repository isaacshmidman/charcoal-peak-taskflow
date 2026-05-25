// @ts-nocheck
/**
 * @file Conditional block (renders only when form.task_type ===
 * "recurring"): Repeats dropdown + Custom-days picker + Repeats-until
 * (indefinite | end-date) selector.
 */
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns/format";
import { cn } from "@/lib/utils";
import { getNextRecurrenceDate } from "@/lib/recurrence";
import { fromDateStr, toDateStr } from "@/lib/dates";

const WEEKDAYS = [
  { label: "S", fullLabel: "Sun", value: 0 },
  { label: "M", fullLabel: "Mon", value: 1 },
  { label: "T", fullLabel: "Tue", value: 2 },
  { label: "W", fullLabel: "Wed", value: 3 },
  { label: "T", fullLabel: "Thu", value: 4 },
  { label: "F", fullLabel: "Fri", value: 5 },
  { label: "S", fullLabel: "Sat", value: 6 },
];

export default function RecurrenceFields({
  form,
  setForm,
  showEndDate,
  setShowEndDate,
  dayError,
  setDayError,
}) {
  if (form.task_type !== "recurring") return null;

  const toggleRecurrenceDay = (day) => {
    const days = form.recurrence_days || [];
    const updated = days.includes(day) ? days.filter(d => d !== day) : [...days, day];
    setForm({ ...form, recurrence_days: updated.sort((a, b) => a - b) });
    setDayError(false);
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1.5 block">Repeats</Label>
        <Select
          value={form.recurrence}
          onValueChange={(v) => {
            setForm({ ...form, recurrence: v });
            if (v !== "custom_days") setDayError(false);
          }}
        >
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekdays">Weekdays (Mon–Fri)</SelectItem>
            <SelectItem value="custom_days">Custom days of week</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="biweekly">Biweekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="quarterly">Quarterly</SelectItem>
            <SelectItem value="yearly">Yearly</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {form.recurrence === "custom_days" && (
        <div>
          <Label className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2 block">Select days</Label>
          <div className="flex gap-1.5">
            {WEEKDAYS.map((day) => {
              const selected = (form.recurrence_days || []).includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => toggleRecurrenceDay(day.value)}
                  title={day.fullLabel}
                  className={cn(
                    "w-9 h-9 rounded-full text-xs font-semibold transition-all border-2",
                    selected
                      ? "bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100"
                      : "bg-slate-100 dark:bg-[#161616] text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-[#222222] border-transparent",
                    dayError && "border-red-500"
                  )}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <Label className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1.5 block">Repeats until</Label>
        <div className="flex items-center gap-2">
          <Select
            value={showEndDate ? "until" : "indefinite"}
            onValueChange={(v) => {
              if (v === "indefinite") {
                setShowEndDate(false);
                setForm({ ...form, recurrence_end_date: "" });
              } else {
                setShowEndDate(true);
                // Default end date to the next occurrence — user can override via the picker.
                if (!form.recurrence_end_date) {
                  const next = getNextRecurrenceDate({
                    due_date: form.due_date,
                    recurrence: form.recurrence,
                    recurrence_days: form.recurrence_days,
                  });
                  if (next) {
                    setForm((f) => ({ ...f, recurrence_end_date: toDateStr(next) }));
                  }
                }
              }
            }}
          >
            <SelectTrigger className={cn("h-9", showEndDate ? "flex-1" : "w-full")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="indefinite">Indefinitely</SelectItem>
              <SelectItem value="until">Set end date</SelectItem>
            </SelectContent>
          </Select>
          {showEndDate && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-9 flex-1 justify-start text-sm font-normal">
                  <CalendarIcon className="w-4 h-4 mr-2 text-slate-400 dark:text-slate-500" />
                  {form.recurrence_end_date ? format(fromDateStr(form.recurrence_end_date), "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={form.recurrence_end_date ? fromDateStr(form.recurrence_end_date) : undefined}
                  onSelect={(date) => { if (date) setForm({ ...form, recurrence_end_date: toDateStr(date) }); }}
                  showOutsideDays fixedWeeks
                />
                <div className="p-2 border-t">
                  <Button type="button" variant="ghost" size="sm" className="w-full text-xs" onClick={() => setForm({ ...form, recurrence_end_date: "" })}>
                    Clear
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </div>
  );
}
