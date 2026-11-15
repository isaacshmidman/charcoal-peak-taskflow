// @ts-check
/**
 * @file What a page shows while its data is on the way: the outline of
 * what is coming, in the place it will be, so the page doesn't jump when
 * it arrives. Bars where the words will go; no spinner, no "Loading…".
 *
 * Each one is drawn on the same frame as the real thing (`.ds-list`, a
 * Home block's card) and its rows are the real rows' height. They breathe
 * slowly, and hold still for anyone who has asked the device for less
 * motion. To a screen reader the whole outline is one thing: "Loading".
 */
import { cn } from "@/lib/utils";

const bar = "rounded bg-ink-100 dark:bg-night-raised";
/** Uneven on purpose: a column of equal bars reads as a table, not as writing. */
const WIDTHS = ["62%", "44%", "71%", "38%", "55%", "48%", "66%", "41%"];
const breathe = "animate-pulse motion-reduce:animate-none";

/**
 * @param {{ label?: string, className?: string, children: import("react").ReactNode }} props
 */
function Outline({ label = "Loading", className, children }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" data-testid="placeholder" className={cn(breathe, className)}>
      {children}
    </div>
  );
}

/**
 * A list of tasks: a tick box, a title, a date at the far end.
 * @param {{ rows?: number, className?: string }} props
 */
export function TaskRowsPlaceholder({ rows = 5, className }) {
  return (
    <Outline className={cn("ds-list", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 py-2 pl-[15px] pr-3 sm:py-1.5">
          <span className={cn(bar, "h-6 w-6 shrink-0 rounded-md sm:h-5 sm:w-5")} />
          <span className="flex h-[30.5px] min-w-0 flex-1 items-center sm:h-7">
            <span className={cn(bar, "h-3")} style={{ width: WIDTHS[index % WIDTHS.length] }} />
          </span>
          {index % 3 !== 2 && <span className={cn(bar, "h-2.5 w-12 shrink-0")} />}
        </div>
      ))}
    </Outline>
  );
}

/**
 * The list of notes: a title, a line of the note, when it was changed.
 * @param {{ rows?: number }} props
 */
export function NoteRowsPlaceholder({ rows = 4 }) {
  return (
    <Outline className="space-y-1 px-1 pt-1">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="px-3 py-2">
          <span className={cn(bar, "block h-[15px]")} style={{ width: WIDTHS[(index + 2) % WIDTHS.length] }} />
          <span className={cn(bar, "mt-[7px] block h-3")} style={{ width: WIDTHS[(index + 5) % WIDTHS.length] }} />
          <span className={cn(bar, "mt-[7px] block h-2.5 w-16")} />
        </div>
      ))}
    </Outline>
  );
}

/**
 * The inside of a block on Home, or of any small card of rows.
 * @param {{ rows?: number }} props
 */
export function BlockRowsPlaceholder({ rows = 3 }) {
  return (
    <div className="space-y-3 px-3.5 pb-4 pt-1.5">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-2.5">
          <span className={cn(bar, "h-4 w-4 shrink-0")} />
          <span className={cn(bar, "h-3.5")} style={{ width: WIDTHS[(index + 1) % WIDTHS.length] }} />
        </div>
      ))}
    </div>
  );
}

/**
 * A whole page, for the moment before the page's own code has arrived:
 * a heading, then a list. Used once per visit at most (the app keeps a
 * page's code after the first time it is opened).
 */
export function PagePlaceholder() {
  return (
    <div data-testid="page-placeholder">
      <div className={cn("pb-4 pt-4", breathe)} aria-hidden="true">
        <span className={cn(bar, "block h-7 w-40")} />
        <span className={cn(bar, "mt-2 block h-3 w-20")} />
      </div>
      <TaskRowsPlaceholder rows={6} />
    </div>
  );
}
