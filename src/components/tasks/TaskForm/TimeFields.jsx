// @ts-nocheck
/**
 * @file Date picker + time toggle + start/end TimeInput row.
 * Owns the auto-bumping of `task_end_time` to start+60 when the user
 * hasn't manually touched it (via the shared `endTouchedRef`).
 */
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns/format";
import { fromDateStr, toDateStr } from "@/lib/dates";
import TimeInput, { addMinutes } from "./TimeInput.jsx";

export default function TimeFields({ form, setForm, endTouchedRef }) {
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Label className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1.5 block">Date</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" data-testid="task-form-date-trigger" className="w-full justify-start h-9 text-sm font-normal">
                <CalendarIcon className="w-4 h-4 mr-2 text-slate-400 dark:text-slate-500" />
                {form.due_date ? format(fromDateStr(form.due_date), "PPP") : "No date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={form.due_date ? fromDateStr(form.due_date) : undefined}
                onSelect={(date) => { if (date) setForm({ ...form, due_date: toDateStr(date) }); }}
                showOutsideDays fixedWeeks
              />
              {form.due_date && (
                <div className="p-2 border-t">
                  <Button type="button" variant="ghost" size="sm" data-testid="task-form-clear-date" className="w-full text-xs" onClick={() => setForm({ ...form, due_date: "", task_time: "" })}>
                    Clear date
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>

        {form.due_date && (
          <div className="flex flex-col items-center gap-1 pb-0.5">
            <Label className="text-xs font-semibold text-slate-900 dark:text-slate-100">Set time</Label>
            <button
              type="button"
              onClick={() => {
                if (form.task_time) {
                  endTouchedRef.current = false;
                  setForm({ ...form, task_time: "", task_end_time: "" });
                } else {
                  endTouchedRef.current = false;
                  setForm({ ...form, task_time: "9:00AM", task_end_time: "10:00AM" });
                }
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${form.task_time ? "bg-slate-900 dark:bg-slate-100" : "bg-slate-200 dark:bg-[#222222]"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-slate-900 shadow transition-transform duration-200 ${form.task_time ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
        )}
      </div>

      {form.due_date && form.task_time && (
        <div className="flex items-center gap-2">
          <TimeInput
            value={form.task_time}
            onChange={(v) => {
              setForm((f) => ({
                ...f,
                task_time: v,
                task_end_time: endTouchedRef.current ? f.task_end_time : addMinutes(v, 60),
              }));
            }}
          />
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">to</span>
          <TimeInput
            value={form.task_end_time || addMinutes(form.task_time, 60)}
            onChange={(v) => {
              endTouchedRef.current = true;
              setForm((f) => ({ ...f, task_end_time: v }));
            }}
          />
        </div>
      )}
    </div>
  );
}
