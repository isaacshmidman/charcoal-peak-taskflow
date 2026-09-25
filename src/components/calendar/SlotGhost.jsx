// @ts-nocheck
import { cn } from "@/lib/utils";
import { slotLabel } from "./useEmptySlotClick";

/**
 * An outline on the hour grid, in one of two roles:
 *   - "hover": where a click would create a task — an hour at the hovered
 *     quarter hour ("+ 9:15 AM"). Mouse only; see useEmptySlotClick.
 *   - "drop":  where the task being dragged will land if released, at its
 *     full duration. Computed by the same function the drop uses
 *     (useCalendarDnd), so what it shows is what gets saved. It has no
 *     text: the dragged card always covers its top edge, so the time rides
 *     on the card instead (DropTimeTag).
 * Never takes pointer events, so it can't block the grid or a task.
 */
export default function SlotGhost({ minutes, endMinutes, hourHeight, variant = "hover" }) {
  if (minutes == null) return null;
  const end = endMinutes ?? minutes + 60;
  const drop = variant === "drop";
  return (
    <div
      aria-hidden
      data-testid={drop ? "calendar-drop-preview" : "calendar-slot-ghost"}
      className={cn(
        "pointer-events-none absolute inset-x-0.5 z-20 overflow-hidden rounded border border-dashed px-1.5 py-0.5 text-[10px] font-medium leading-tight",
        drop
          ? "border-slate-500 bg-slate-900/[0.06] text-slate-700 dark:border-slate-400 dark:bg-white/[0.07] dark:text-slate-200"
          : "z-0 border-slate-300 bg-slate-50/80 text-slate-500 dark:border-[#454545] dark:bg-[#161616]/80 dark:text-slate-400"
      )}
      style={{ top: (minutes / 60) * hourHeight, height: Math.max(12, ((end - minutes) / 60) * hourHeight) }}
    >
      {drop ? null : `+ ${slotLabel(minutes)}`}
    </div>
  );
}
