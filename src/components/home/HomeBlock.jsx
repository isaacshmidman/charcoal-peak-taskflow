// @ts-nocheck
/**
 * @file The frame of one block on Home: a quiet label, a count, the
 * block's content. While the page is being customized the same frame
 * carries the block's controls (a grip to drag it by, earlier, later, how
 * wide, remove), then the block's own settings, and its content is held
 * still, so arranging the page can't tick a task.
 *
 * Dragging: the grip picks the block up, and letting go over another
 * block puts it in that block's place (pages/Home.jsx does the moving).
 * The arrows do the same job from the keyboard, one place at a time.
 */
import { Link } from "react-router-dom";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ArrowLeft, ArrowRight, ChevronRight, GripVertical, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { HOME_SIZES, HOME_SIZE_LABELS } from "@/lib/home-blocks";

/**
 * How many of the page's columns a width takes. One column on a phone
 * (width means nothing there), two on a tablet, six on a laptop.
 */
const SPAN = {
  third: "xl:col-span-2",
  half: "xl:col-span-3",
  full: "sm:col-span-2 xl:col-span-6",
};

const SIZE_LETTER = { third: "S", half: "M", full: "L" };

const tool =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-selected hover:text-ink-900 disabled:pointer-events-none disabled:opacity-30 dark:text-ink-400 dark:hover:text-ink-100";

/**
 * @param {{
 *   id: string, name: string, size: string, count?: import("react").ReactNode, to?: string,
 *   editing?: boolean, first?: boolean, last?: boolean, settings?: import("react").ReactNode,
 *   onMove?: (step: -1 | 1) => void, onResize?: (size: string) => void, onRemove?: () => void,
 *   children: import("react").ReactNode,
 * }} props
 */
export default function HomeBlock({ id, name, size, count, to, editing = false, first, last, settings, onMove, onResize, onRemove, children }) {
  const drag = useDraggable({ id, disabled: !editing });
  const drop = useDroppable({ id, disabled: !editing });
  const setRefs = (element) => { drag.setNodeRef(element); drop.setNodeRef(element); };
  const lifted = drag.isDragging;
  const target = editing && drop.isOver && !lifted;

  return (
    <section
      ref={setRefs}
      aria-label={name}
      data-testid={`home-block-${id}`}
      data-size={size}
      data-drop-target={target || undefined}
      style={lifted && drag.transform ? { transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)` } : undefined}
      className={cn(
        "flex min-w-0 flex-col rounded-xl border bg-surface-card",
        editing ? "border-dashed border-ink-300 dark:border-ink-600" : "border-border-hairline",
        // In the hand it floats above the page (the one time a block has a shadow).
        lifted && "relative z-40 opacity-90 shadow-pop",
        // Where it would land.
        target && "border-solid border-ink-900 dark:border-sun-400",
        SPAN[size] || SPAN.third,
      )}
    >
      <header className="flex min-h-[2.5rem] flex-wrap items-center gap-x-2 px-3.5 pt-1">
        <h2 className="flex min-w-0 items-baseline gap-2 text-[13px] font-semibold text-ink-800 dark:text-ink-200">
          {to && !editing ? (
            <Link
              to={to}
              className="group/head inline-flex min-w-0 items-center gap-0.5 rounded outline-none hover:text-ink-900 focus-visible:underline dark:hover:text-ink-100"
            >
              <span className="truncate">{name}</span>
              <ChevronRight className="h-3 w-3 shrink-0 text-ink-300 transition-colors group-hover/head:text-ink-600 dark:text-ink-600 dark:group-hover/head:text-ink-300" />
            </Link>
          ) : (
            <span className="truncate">{name}</span>
          )}
          {count != null && count !== "" && (
            <span className="shrink-0 text-[12px] font-normal tabular-nums text-ink-400 dark:text-ink-500" data-testid={`home-count-${id}`}>{count}</span>
          )}
        </h2>

        {editing && (
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              className={cn(tool, "cursor-grab touch-none active:cursor-grabbing")}
              aria-label={`Drag ${name} to another place`}
              title="Drag to move"
              {...drag.listeners}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={tool} disabled={first} onClick={() => onMove?.(-1)} aria-label={`Move ${name} earlier`} title="Move earlier">
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={tool} disabled={last} onClick={() => onMove?.(1)} aria-label={`Move ${name} later`} title="Move later">
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
            {/* Width means nothing in the phone's single column. */}
            <div role="group" aria-label={`Width of ${name}`} className="ds-seg mx-1 hidden sm:inline-flex">
              {HOME_SIZES.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="ds-seg-item h-6 w-6 text-[11px]"
                  aria-pressed={size === option}
                  aria-label={HOME_SIZE_LABELS[option]}
                  title={HOME_SIZE_LABELS[option]}
                  onClick={() => onResize?.(option)}
                >
                  {SIZE_LETTER[option]}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={cn(tool, "hover:text-red-500 dark:hover:text-red-300")}
              onClick={onRemove}
              aria-label={`Remove ${name}`}
              title="Remove"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </header>

      {editing && settings && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3.5 pb-2 pt-0.5" data-testid={`home-settings-${id}`}>
          {settings}
        </div>
      )}

      <div
        className={cn("flex min-h-0 flex-1 flex-col", editing && "pointer-events-none select-none opacity-50")}
        // Held still while arranging: out of reach of the pointer and the keyboard.
        inert={editing ? "" : undefined}
        aria-hidden={editing || undefined}
      >
        {children}
      </div>
    </section>
  );
}
