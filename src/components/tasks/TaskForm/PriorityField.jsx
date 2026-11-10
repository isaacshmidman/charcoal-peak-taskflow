// @ts-nocheck
/**
 * @file The Priority row — or, for an item that came from a connected
 * calendar, the name of that calendar (it has no priority of its own).
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { colorDot, hexToRgba } from "@/lib/colors";
import { Field } from "./parts.jsx";

export default function PriorityField({
  form,
  setForm,
  priorities,
  isExternal,
  sourceCalendarName,
  sourceColorHex,
  sourceProvider,
}) {
  if (isExternal) {
    return (
      <Field label="Calendar">
        <div
          className="flex h-9 items-center gap-2 text-sm text-ink-700 dark:text-ink-200"
          title={`${sourceCalendarName} (${sourceProvider})`}
        >
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-ink-200 bg-ink-400 dark:border-night-line-strong"
            style={sourceColorHex ? { backgroundColor: sourceColorHex, borderColor: hexToRgba(sourceColorHex, 0.6) || undefined } : undefined}
          />
          <span className="truncate">{sourceCalendarName}</span>
        </div>
      </Field>
    );
  }

  return (
    <Field label="Priority">
      <Select
        value={form.priority_id}
        // Radix's hidden native <select> can report "" as the form opens.
        onValueChange={(v) => { if (v) setForm((f) => ({ ...f, priority_id: v })); }}
      >
        <SelectTrigger aria-label="Priority" data-testid="task-form-priority">
          <SelectValue placeholder="None" />
        </SelectTrigger>
        <SelectContent>
          {priorities.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              <span className="flex items-center gap-2">
                <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", colorDot[p.color] || colorDot.slate)} />
                {p.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
