// @ts-nocheck
/**
 * @file The "when" of a task: a Date row and a Time row.
 *
 * Owns the auto-bumping of `task_end_time` to start+60 while the user
 * hasn't chosen an end themselves (via the shared `endTouchedRef`).
 *
 * `withEnd={false}` is the subtask form: a start time only, and
 * `task_end_time` is never written (a subtask record has no such field).
 */
import { Switch } from "@/components/ui/switch";
import TimeInput, { defaultEndTime } from "./TimeInput.jsx";
import { DateField, Field } from "./parts.jsx";

export default function TimeFields({ form, setForm, endTouchedRef, withEnd = true, dateRequired = true, testidPrefix = "task-form" }) {
  const timed = !!form.task_time;

  const setTimed = (on) => {
    if (endTouchedRef) endTouchedRef.current = false;
    setForm((f) => ({
      ...f,
      task_time: on ? "9:00AM" : "",
      ...(withEnd ? { task_end_time: on ? "10:00AM" : "" } : {}),
    }));
  };

  return (
    <>
      <Field label="Date" hint={dateRequired && !form.due_date ? "Pick a date to save this task." : null}>
        <DateField
          value={form.due_date}
          // Clearing the date clears the time with it — a time needs a day.
          onChange={(next) =>
            setForm((f) => (next ? { ...f, due_date: next } : { ...f, due_date: "", task_time: "" }))
          }
          clearLabel="Clear date"
          testid={`${testidPrefix}-date-trigger`}
          clearTestid={`${testidPrefix}-clear-date`}
        />
      </Field>

      {form.due_date && (
        <Field label="Time">
          <div className="flex min-h-9 flex-wrap items-center gap-x-2.5 gap-y-2">
            <Switch checked={timed} onChange={setTimed} label="Set time" />
            {!timed && <span className="text-sm text-ink-400 dark:text-ink-500">All day</span>}
            {timed && (
              <div className="flex items-center gap-2">
                <TimeInput
                  label="Start time"
                  value={form.task_time}
                  onChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      task_time: v,
                      ...(withEnd
                        ? { task_end_time: endTouchedRef?.current ? f.task_end_time : defaultEndTime(v) }
                        : {}),
                    }))
                  }
                />
                {withEnd && (
                  <>
                    <span className="text-sm text-ink-400 dark:text-ink-500">to</span>
                    <TimeInput
                      label="End time"
                      value={form.task_end_time || defaultEndTime(form.task_time)}
                      onChange={(v) => {
                        if (endTouchedRef) endTouchedRef.current = true;
                        setForm((f) => ({ ...f, task_end_time: v }));
                      }}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        </Field>
      )}
    </>
  );
}
