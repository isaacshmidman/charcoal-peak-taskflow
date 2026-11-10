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
          ? "border-ink-500 bg-ink-900/[0.06] text-ink-700 dark:border-ink-400 dark:bg-white/[0.07] dark:text-ink-200"
          : "z-0 border-ink-300 bg-ink-50/80 text-ink-500 dark:border-night-line-bold dark:bg-night-raised/80 dark:text-ink-400"
      )}
      style={{ top: (minutes / 60) * hourHeight, height: Math.max(12, ((end - minutes) / 60) * hourHeight) }}
    >
      {drop ? null : `+ ${slotLabel(minutes)}`}
    </div>
  );
}
