// @ts-nocheck
/**
 * @file Small reusable time-of-day dropdown. Renders a 15-min slot list
 * and scrolls the currently-selected slot into view when opened. The
 * list floats (a popover), so it is never cut off by the scrolling body
 * of the form it sits in. Also exports `addMinutes` and `generateTimeSlots` so the
 * parent form can compute default end-times.
 */
import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { parseTaskTime } from "@/lib/sort-helpers";

// Generate all 15-min slots across a 24-hour day.
export function generateTimeSlots() {
  const slots = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const ampm = h < 12 ? "AM" : "PM";
      const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const label = `${hour}:${String(m).padStart(2, "0")}${ampm}`;
      slots.push(label);
    }
  }
  return slots;
}

export const TIME_SLOTS = generateTimeSlots();

export function addMinutes(t, mins) {
  const parsed = parseTaskTime(t);
  if (parsed == null) return "10:00AM";
  const total = (parsed + mins + 24 * 60) % (24 * 60);
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const ampm = h24 < 12 ? "AM" : "PM";
  const hour = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${hour}:${String(m).padStart(2, "0")}${ampm}`;
}

/**
 * The end a new or re-timed task gets by default: an hour after `start`,
 * but never past 11:59 PM. addMinutes wraps around midnight, so a task
 * starting at 11:30 PM used to get a 12:30 AM end — earlier than its start
 * on the same day. Calendar drags already stop at 11:59 PM; this matches.
 *
 * @param {string} start
 * @returns {string}
 */
export function defaultEndTime(start) {
  const parsed = parseTaskTime(start);
  if (parsed == null) return addMinutes(start, 60);
  return parsed + 60 >= 24 * 60 ? "11:59PM" : addMinutes(start, 60);
}

/** "9:00AM" → "9:00 AM", for reading. The stored value keeps no space. */
export const spacedTime = (time) => String(time || "").replace(/\s*(AM|PM)$/i, " $1");

/**
 * @param {{
 *   value: string,
 *   onChange: (value: string) => void,
 *   label?: string,             // accessible name, e.g. "Start time"
 *   className?: string,         // wrapper/trigger width override (default: "w-[7.25rem]")
 *   triggerClassName?: string,  // button className override
 * }} props
 */
export default function TimeInput({ value, onChange, label = "Time", className, triggerClassName }) {
  const [open, setOpen] = useState(false);
  const selectedRef = useRef(null);
  // A time that isn't on a quarter hour (typed elsewhere, or synced from a
  // calendar) still has to appear in the list, or opening it would show
  // nothing chosen.
  const slots = value && !TIME_SLOTS.includes(value)
    ? [...TIME_SLOTS, value].sort((a, b) => (parseTaskTime(a) ?? 0) - (parseTaskTime(b) ?? 0))
    : TIME_SLOTS;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "flex h-9 items-center justify-between gap-2 rounded-lg border border-border-strong bg-surface-card px-3 text-sm tabular-nums text-foreground transition-[border-color,box-shadow] dark:bg-night-sunken",
            "focus:outline-none focus-visible:border-ink-900 focus-visible:ring-[3px] focus-visible:ring-ink-900/10 dark:focus-visible:border-sun-400 dark:focus-visible:ring-sun-400/20",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className || "w-[7.25rem]",
            triggerClassName
          )}
        >
          {spacedTime(value)}
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-400 opacity-70 transition-transform dark:text-ink-500", open && "rotate-180")} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-56 w-[var(--radix-popover-trigger-width)] min-w-[7.25rem] overflow-y-auto overscroll-contain rounded-lg p-1"
        // Start at the chosen time rather than at midnight.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          selectedRef.current?.scrollIntoView({ block: "center" });
          selectedRef.current?.focus({ preventScroll: true });
        }}
      >
        {slots.map((slot) => {
          const isSelected = slot === value;
          return (
            <button
              key={slot}
              ref={isSelected ? selectedRef : null}
              type="button"
              onClick={() => { onChange(slot); setOpen(false); }}
              className={cn(
                "block w-full rounded-md px-2 py-1.5 text-left text-sm tabular-nums outline-none transition-colors",
                isSelected
                  ? "bg-primary font-medium text-primary-foreground"
                  : "text-foreground hover:bg-selected focus-visible:bg-selected"
              )}
            >
              {spacedTime(slot)}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
