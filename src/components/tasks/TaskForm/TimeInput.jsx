// @ts-nocheck
/**
 * @file Small reusable time-of-day dropdown used by TimeFields. Renders
 * a 15-min slot list and scrolls the currently-selected slot into view
 * when opened. Also exports `addMinutes` and `generateTimeSlots` so the
 * parent form can compute default end-times.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useOutsideClick } from "@/hooks/useOutsideClick";
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

export default function TimeInput({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const listRef = useRef(null);
  const selectedRef = useRef(null);
  const containerRef = useRef(null);

  useOutsideClick(containerRef, () => setOpen(false), open);

  useEffect(() => {
    if (open && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "center" });
    }
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-36">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-1.5 border border-slate-200 dark:border-[#343434] rounded-lg bg-white dark:bg-[#111111] text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#222222] transition-colors"
      >
        {value}
        <svg className={cn("w-3.5 h-3.5 text-slate-400 dark:text-slate-500 transition-transform", open && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 left-0 border border-slate-200 dark:border-[#343434] rounded-lg overflow-hidden bg-white dark:bg-[#111111] shadow-md w-full">
          <div ref={listRef} className="max-h-48 overflow-y-auto">
            {TIME_SLOTS.map((slot) => {
              const isSelected = slot === value;
              return (
                <button
                  key={slot}
                  ref={isSelected ? selectedRef : null}
                  type="button"
                  onClick={() => { onChange(slot); setOpen(false); }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-base md:text-sm transition-colors",
                    isSelected ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium" : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#222222]"
                  )}
                >
                  {slot}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
