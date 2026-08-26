// @ts-nocheck
/**
 * @file The draggable divider between two split panes. Pairs with
 * useSplitPane — one component so the Calendar and Notes dividers are
 * literally the same control rather than two that merely resemble
 * each other.
 *
 * The handle pill grows and darkens while latched so the detent reads as
 * a tactile "click".
 */
import { cn } from "@/lib/utils";

export default function SplitDivider({
  onPointerDown,
  onDoubleClick,
  snapped,
  className,
  title = "Drag to resize. Double-click to reset.",
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      title={title}
      className={cn("flex w-2 cursor-col-resize items-center justify-center group shrink-0", className)}
    >
      <div
        className={cn(
          "w-0.5 rounded-full transition-all duration-150",
          // Visible at rest: the old slate-200 / #222 vanished into the
          // surface behind it, so the divider read as empty space.
          snapped
            ? "h-12 bg-slate-500 dark:bg-slate-300"
            : "h-8 bg-slate-300 dark:bg-[#3a3a3a] group-hover:bg-slate-400 dark:group-hover:bg-slate-500"
        )}
      />
    </div>
  );
}
