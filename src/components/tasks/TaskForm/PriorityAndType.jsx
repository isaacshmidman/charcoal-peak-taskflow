// @ts-nocheck
/**
 * @file 2-column grid: priority picker (or calendar-name display, when
 * editing an external provider event) + one-time/recurring type radio.
 * The colorDotClass map duplicates colorDot from @/lib/colors — Phase 5
 * of the cleanup plan will consolidate.
 */
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { hexToRgba } from "@/lib/colors";

const colorDotClass = {
  red: "bg-red-400", orange: "bg-orange-400", yellow: "bg-yellow-400",
  green: "bg-green-400", blue: "bg-blue-400", violet: "bg-violet-400",
  pink: "bg-pink-400", teal: "bg-teal-400", cyan: "bg-cyan-400",
  rose: "bg-rose-400", slate: "bg-slate-400",
};

export default function PriorityAndType({
  form,
  setForm,
  priorities,
  isExternal,
  isExternalEvent,
  sourceCalendarName,
  sourceColorHex,
  sourceProvider,
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {isExternal ? (
        <div>
          <Label className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1.5 block">Calendar</Label>
          <div
            className="h-9 px-3 inline-flex items-center gap-2 w-full rounded-md border border-slate-200 dark:border-[#343434] bg-slate-50 dark:bg-[#161616] text-sm text-slate-700 dark:text-slate-200"
            title={`${sourceCalendarName} (${sourceProvider})`}
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0 border border-slate-200 dark:border-[#343434]"
              style={sourceColorHex ? { backgroundColor: sourceColorHex, borderColor: hexToRgba(sourceColorHex, 0.6) || undefined } : { backgroundColor: "#94a3b8" }}
            />
            <span className="truncate">{sourceCalendarName}</span>
          </div>
        </div>
      ) : (
        <div>
          <Label className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1.5 block">Priority</Label>
          <Select value={form.priority_id} onValueChange={(v) => setForm({ ...form, priority_id: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {priorities.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="flex items-center gap-2">
                    <span className={cn("inline-block w-2.5 h-2.5 rounded-full shrink-0", colorDotClass[p.color] || colorDotClass.slate)} />
                    {p.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <Label className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1.5 block">Type</Label>
        <Select
          value={form.task_type}
          onValueChange={(v) => setForm({ ...form, task_type: v, recurrence: v === "recurring" ? "weekly" : form.recurrence })}
          disabled={isExternalEvent}
        >
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="one_time">One-time</SelectItem>
            <SelectItem value="recurring">Recurring</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
