// @ts-nocheck
/**
 * @file Whether a task repeats, in one row.
 *
 * The record keeps two fields — `task_type` ("one_time" | "recurring")
 * and `recurrence` (the pattern) — but to the person filling in the form
 * that is one question, so it is one dropdown: "Does not repeat" or a
 * pattern. Choosing a pattern reveals what it needs: the weekday buttons
 * for custom days, and when the repeating ends.
 */
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getNextRecurrenceDate } from "@/lib/recurrence";
import { toDateStr } from "@/lib/dates";
import { DateField, Field } from "./parts.jsx";

const WEEKDAYS = [
  { label: "S", fullLabel: "Sunday", value: 0 },
  { label: "M", fullLabel: "Monday", value: 1 },
  { label: "T", fullLabel: "Tuesday", value: 2 },
  { label: "W", fullLabel: "Wednesday", value: 3 },
  { label: "T", fullLabel: "Thursday", value: 4 },
  { label: "F", fullLabel: "Friday", value: 5 },
  { label: "S", fullLabel: "Saturday", value: 6 },
];

const PATTERNS = [
  ["daily", "Every day"],
  ["weekdays", "Every weekday (Mon–Fri)"],
  ["weekly", "Every week"],
  ["biweekly", "Every 2 weeks"],
  ["monthly", "Every month"],
  ["quarterly", "Every 3 months"],
  ["yearly", "Every year"],
];

export default function RepeatFields({ form, setForm, showEndDate, setShowEndDate, disabled = false }) {
  const recurring = form.task_type === "recurring";
  const value = recurring ? (form.recurrence && form.recurrence !== "none" ? form.recurrence : "weekly") : "none";
  const days = form.recurrence_days || [];
  const needsDay = recurring && form.recurrence === "custom_days" && days.length === 0;

  const choose = (next) => {
    // Radix's hidden native <select> can report "" as the form opens.
    if (!next) return;
    if (next === "none") {
      // The pattern is left alone so switching back restores it; the
      // form's save step blanks it for one-time tasks.
      setForm((f) => ({ ...f, task_type: "one_time" }));
      return;
    }
    setForm((f) => ({ ...f, task_type: "recurring", recurrence: next }));
  };

  const toggleDay = (day) =>
    setForm((f) => {
      const current = f.recurrence_days || [];
      const updated = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
      return { ...f, recurrence_days: updated.sort((a, b) => a - b) };
    });

  const chooseEnds = (next) => {
    if (!next) return;
    if (next === "never") {
      setShowEndDate(false);
      setForm((f) => ({ ...f, recurrence_end_date: "" }));
      return;
    }
    setShowEndDate(true);
    // Start from the next occurrence — a sensible first guess to change.
    setForm((f) => {
      if (f.recurrence_end_date) return f;
      const nextDate = getNextRecurrenceDate({
        due_date: f.due_date,
        recurrence: f.recurrence,
        recurrence_days: f.recurrence_days,
      });
      return nextDate ? { ...f, recurrence_end_date: toDateStr(nextDate) } : f;
    });
  };

  return (
    <>
      <Field label="Repeat" hint={needsDay ? <span className="text-red-600 dark:text-red-400">Pick at least one day.</span> : null}>
        <Select value={value} onValueChange={choose} disabled={disabled}>
          <SelectTrigger aria-label="Repeat" data-testid="task-form-repeat"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Does not repeat</SelectItem>
            <SelectSeparator />
            {PATTERNS.map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
            <SelectItem value="custom_days">On chosen days of the week</SelectItem>
          </SelectContent>
        </Select>

        {recurring && form.recurrence === "custom_days" && (
          <div className="mt-2 flex gap-1.5" role="group" aria-label="Days of the week">
            {WEEKDAYS.map((day) => {
              const on = days.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  aria-label={day.fullLabel}
                  aria-pressed={on}
                  title={day.fullLabel}
                  onClick={() => toggleDay(day.value)}
                  className={cn(
                    "h-9 w-9 rounded-full text-xs font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ink-900/15 dark:focus-visible:ring-sun-400/30",
                    on
                      ? "bg-primary text-primary-foreground"
                      : "bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-night-raised dark:text-ink-300 dark:hover:bg-night-high"
                  )}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        )}
      </Field>

      {recurring && (
        <Field label="Ends">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={showEndDate ? "until" : "never"} onValueChange={chooseEnds} disabled={disabled}>
              <SelectTrigger aria-label="Ends" className={showEndDate ? "w-[7.25rem]" : "w-full"}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="never">Never</SelectItem>
                <SelectItem value="until">On a date</SelectItem>
              </SelectContent>
            </Select>
            {showEndDate && (
              <DateField
                value={form.recurrence_end_date}
                onChange={(next) => setForm((f) => ({ ...f, recurrence_end_date: next }))}
                placeholder="Pick a date"
                shortcuts={false}
                className="w-auto min-w-0 flex-1"
              />
            )}
          </div>
        </Field>
      )}
    </>
  );
}
