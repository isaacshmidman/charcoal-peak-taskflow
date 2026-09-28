// @ts-nocheck
/**
 * @file The task's own reminder, overriding the account's notification
 * settings for this one task. Stored as `task.reminder` — see
 * backend/reminders.js for the format:
 *   ""                use the account default
 *   "none"            no reminder for this task
 *   "before:<min>"    timed tasks: minutes before the start (0 = at start)
 *   "at:<9:00AM>"     all-day tasks: a time of day
 *
 * The choices follow the task: timed tasks get offsets, all-day tasks a
 * time of day. If the task switches between the two, a choice that no
 * longer fits goes back to the default rather than lingering unused.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/apiClient";
import { normalizeNotificationSettings } from "@/lib/notifications";
import { parseTaskTime } from "@/lib/sort-helpers";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import TimeInput from "./TimeInput.jsx";

const TIMED_CHOICES = [
  { value: "before:0", label: "At start" },
  { value: "before:5", label: "5 minutes before" },
  { value: "before:10", label: "10 minutes before" },
  { value: "before:15", label: "15 minutes before" },
  { value: "before:30", label: "30 minutes before" },
  { value: "before:60", label: "1 hour before" },
  { value: "before:120", label: "2 hours before" },
  { value: "before:1440", label: "1 day before" },
];

const DEFAULT_AT_TIME = "9:00AM";

/** "9:00AM" → "9:00 AM". */
const friendlyTime = (time) => String(time).replace(/(AM|PM)$/i, " $1");

/** What "Default" means right now, from the account's settings. */
export function describeDefaultReminder(settings, isTimed) {
  if (!settings.enabled) return "reminders off";
  if (!isTimed) return settings.allDayEnabled ? `at ${friendlyTime(settings.allDayTime)}` : "none";
  const offset = settings.timedOffsetMinutes;
  if (!offset) return "at start";
  const abs = Math.abs(offset);
  const amount =
    abs % 1440 === 0 ? `${abs / 1440} day${abs === 1440 ? "" : "s"}`
      : abs % 60 === 0 ? `${abs / 60} hour${abs === 60 ? "" : "s"}`
        : `${abs} min`;
  return `${amount} ${offset < 0 ? "before" : "after"}`;
}

/** Whether a stored rule makes sense for a timed / all-day task. */
export function reminderFits(value, isTimed) {
  if (!value || value === "none") return true;
  return isTimed ? value.startsWith("before:") : value.startsWith("at:");
}

export default function ReminderField({ form, setForm }) {
  const isTimed = parseTaskTime(form.task_time) != null;
  const value = form.reminder || "";
  const fits = reminderFits(value, isTimed);

  // Switched between timed and all-day: the old choice no longer applies.
  useEffect(() => {
    if (!fits) setForm((f) => ({ ...f, reminder: "" }));
  }, [fits, setForm]);

  const { data } = useQuery({
    queryKey: ["notificationSettings"],
    queryFn: () => apiClient.notifications.getSettings(),
  });
  const settings = normalizeNotificationSettings(data?.settings || {}, { defaulted: !data?.settings });

  // Radix Select can't use "" as a value.
  const selected = !fits || !value ? "default" : value.startsWith("at:") ? "at" : value;
  const atTime = value.startsWith("at:") ? value.slice(3) : DEFAULT_AT_TIME;

  // Radix's hidden native <select> can report "" as the form opens, before
  // the options register — that's not a choice, so it must not wipe the
  // saved reminder.
  const choose = (next) => {
    if (!next) return;
    setForm((f) => ({
      ...f,
      reminder: next === "default" ? "" : next === "at" ? `at:${atTime}` : next,
    }));
  };

  return (
    <div data-testid="task-form-reminder">
      <Label className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1.5 block">Reminder</Label>
      <div className="flex items-center gap-2">
        <Select value={selected} onValueChange={choose}>
          <SelectTrigger className="h-9 flex-1" aria-label="Reminder">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default ({describeDefaultReminder(settings, isTimed)})</SelectItem>
            <SelectItem value="none">No reminder</SelectItem>
            {isTimed
              ? TIMED_CHOICES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))
              : <SelectItem value="at">At a time…</SelectItem>}
          </SelectContent>
        </Select>
        {selected === "at" && (
          <TimeInput value={atTime} onChange={(t) => setForm((f) => ({ ...f, reminder: `at:${t}` }))} />
        )}
      </div>
      {!settings.enabled && (
        <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
          Notifications are off, so no reminders are sent. Turn them on in Settings → Notifications.
        </p>
      )}
    </div>
  );
}
