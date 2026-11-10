// @ts-nocheck
/**
 * @file Two columns on one surface with a divider you can drag — THE
 * two-column block. Notes (list | note) and the calendar's day view
 * (hours | all day) are both this, so they look and behave as one thing:
 * the same frame, the same rule between the columns, the same drag.
 *
 * The caller says which column is the sized one (`sized`); the other
 * takes what's left. The gesture — free drag, optional sticky points,
 * double-click to reset, the remembered width — is useSplitPane.
 *
 * On a narrow screen there is no room for two columns, so `narrow` says
 * which one shows ("start" or "end"); the other is hidden, and the caller
 * offers its own way to reach it (Notes swaps on tap, the day view folds
 * all-day items into a strip). Pass `end={null}` to leave a column out
 * altogether.
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.start   left column
 * @param {import("react").ReactNode} [props.end]   right column
 * @param {"start" | "end"} [props.sized]           which column the divider sizes
 * @param {"start" | "end"} [props.narrow]          which column shows below 640px
 * @param {string} props.storageKey                 where the width is remembered
 * @param {number} props.minSize
 * @param {number} [props.defaultSize]
 * @param {number} [props.maxFraction]
 * @param {number[]} [props.snapFractions]
 * @param {number} [props.resetFraction]
 * @param {string} [props.dividerTitle]
 * @param {string} [props.className]                height and the like
 * @param {string} [props.startClassName]
 * @param {string} [props.endClassName]
 */
import { cn } from "@/lib/utils";
import { useSplitPane } from "@/hooks/useSplitPane";
import SplitDivider from "@/components/ui/split-divider";

export default function TwoPane({
  start,
  end,
  sized = "start",
  narrow = "start",
  storageKey,
  minSize,
  defaultSize,
  maxFraction,
  snapFractions,
  resetFraction,
  dividerTitle,
  className,
  startClassName,
  endClassName,
  ...rest
}) {
  const { size, containerRef, startResize, resetSplit, snapped, glide } = useSplitPane({
    storageKey,
    minSize,
    defaultSize,
    maxFraction,
    snapFractions,
    resetFraction,
    fromEnd: sized === "end",
  });
  const both = start != null && end != null;

  /** @param {"start" | "end"} which */
  const paneClass = (which) =>
    cn(
      "min-h-0 min-w-0 flex-col",
      // Below sm only one column shows.
      !both || narrow === which ? "flex" : "hidden sm:flex",
      both && sized === which
        ? cn("flex-1 sm:flex-none sm:w-[var(--pane)]", glide && "sm:transition-[width] sm:duration-100 sm:ease-out")
        : "flex-1"
    );

  return (
    <div
      ref={containerRef}
      style={{ "--pane": `${size}px` }}
      className={cn("ds-panes", className)}
      {...rest}
    >
      {start != null && <div className={cn(paneClass("start"), startClassName)}>{start}</div>}
      {both && (
        <SplitDivider
          onPointerDown={startResize}
          onDoubleClick={resetSplit}
          snapped={snapped}
          title={dividerTitle}
          className="hidden sm:block"
        />
      )}
      {end != null && <div className={cn(paneClass("end"), endClassName)}>{end}</div>}
    </div>
  );
}
