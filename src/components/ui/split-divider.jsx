// @ts-nocheck
/**
 * @file The rule between two columns, and the handle that drags it.
 * Used by TwoPane (ui/two-pane.jsx) with useSplitPane.
 *
 * What you see is a hairline the full height of the surface, so the two
 * columns are plainly two; what you grab is wider than that, and the small
 * pill at its middle grows and darkens while the divider is held at a
 * sticky point, so the catch reads as a click.
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
      className={cn("group relative z-10 w-px shrink-0 cursor-col-resize touch-none bg-[var(--border-hairline)]", className)}
    >
      {/* The part you can grab: 6px either side of the line. */}
      <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
      <span
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150",
          snapped
            ? "h-12 bg-ink-500 dark:bg-ink-300"
            : "h-8 bg-ink-300 dark:bg-night-line-bold group-hover:bg-ink-400 dark:group-hover:bg-ink-500"
        )}
      />
    </div>
  );
}
