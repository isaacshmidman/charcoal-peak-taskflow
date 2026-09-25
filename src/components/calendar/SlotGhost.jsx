// @ts-nocheck
import { slotLabel } from "./useEmptySlotClick";

/**
 * Where a click would create a task: a dashed hour-long outline at the
 * hovered quarter hour (new tasks default to an hour). Mouse only — see
 * useEmptySlotClick. Never takes pointer events, so it can't block a
 * click on the grid or a task beneath it.
 */
export default function SlotGhost({ minutes, hourHeight }) {
  if (minutes == null) return null;
  return (
    <div
      aria-hidden
      data-testid="calendar-slot-ghost"
      className="pointer-events-none absolute inset-x-0.5 overflow-hidden rounded border border-dashed border-slate-300 bg-slate-50/80 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-slate-500 dark:border-[#454545] dark:bg-[#161616]/80 dark:text-slate-400"
      style={{ top: (minutes / 60) * hourHeight, height: hourHeight }}
    >
      + {slotLabel(minutes)}
    </div>
  );
}
