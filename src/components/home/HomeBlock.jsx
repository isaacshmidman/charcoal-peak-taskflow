// @ts-nocheck
/**
 * @file The frame of one block on Home: a quiet label, a count, the
 * block's content.
 *
 * While the page is being customized the same frame carries three
 * controls and no more: a grip to drag the block by, a settings button,
 * and remove. The settings panel holds everything else about the block
 * (how wide, its own few settings, earlier or later), each said in
 * words. The block's content is held still meanwhile, so arranging the
 * page can't tick a task, and the block keeps its size, so the page
 * being arranged is the page as it will be.
 *
 * Dragging: the grip picks the block up, and letting go over another
 * block puts it in that block's place (pages/Home.jsx does the moving).
 * With the keyboard on the grip, the arrow keys move it one place.
 */
import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ArrowLeft, ArrowRight, ChevronRight, GripVertical, Settings2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { HOME_SIZES, HOME_SIZE_LABELS } from "@/lib/home-blocks";
import { BlockRowsPlaceholder } from "@/components/ui/placeholders";

/**
 * How many of the page's columns a width takes. One column on a phone
 * (width means nothing there), two on a tablet, six on a laptop.
 */
const SPAN = {
  third: "xl:col-span-2",
  half: "xl:col-span-3",
  full: "sm:col-span-2 xl:col-span-6",
};


/**
 * The outline of a block, for while the page's data is on the way: the
 * same card in the same place, bars where its heading and rows will be.
 * @param {{ size: string, rows?: number }} props
 */
export function HomeBlockOutline({ size, rows = 3 }) {
  return (
    <div className={cn("flex min-w-0 flex-col rounded-xl border border-border-hairline bg-surface-card", SPAN[size] || SPAN.third)}>
      <div className="flex min-h-[2.5rem] items-center px-3 pt-1">
        <span className="h-3.5 w-24 rounded bg-ink-100 dark:bg-night-raised" />
      </div>
      <BlockRowsPlaceholder rows={rows} />
    </div>
  );
}

const tool =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-500 outline-none transition-colors hover:bg-selected hover:text-ink-900 focus-visible:bg-selected focus-visible:text-ink-900 disabled:pointer-events-none disabled:opacity-30 data-[state=open]:bg-selected data-[state=open]:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100 dark:focus-visible:text-ink-100 dark:data-[state=open]:text-ink-100";

const moveButton =
  "inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md border border-border-strong px-2 text-[12px] text-ink-700 outline-none transition-colors hover:bg-selected focus-visible:bg-selected disabled:pointer-events-none disabled:opacity-40 dark:text-ink-200";

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
  // Moving a block with the arrow keys moves its grip in the page, and a
  // moved element drops the keyboard. It is handed back, so the next arrow
  // press moves the same block again.
  const grip = useRef(null);
  const keepFocus = useRef(false);
  useLayoutEffect(() => {
    if (!keepFocus.current) return;
    keepFocus.current = false;
    grip.current?.focus();
  });
  const moveByKey = (step) => {
    keepFocus.current = true;
    onMove?.(step);
  };
  const target = editing && drop.isOver && !lifted;

  const counted = count != null && count !== "" && (
    <span className="shrink-0 text-[12px] font-normal tabular-nums text-ink-400 dark:text-ink-500" data-testid={`home-count-${id}`}>{count}</span>
  );

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
      <header className={cn("flex min-h-[2.5rem] items-center gap-x-1.5 pt-1", editing ? "pl-1 pr-1.5" : "px-3")}>
        {editing && (
          <button
            type="button"
            ref={grip}
            className={cn(tool, "cursor-grab touch-none active:cursor-grabbing")}
            aria-label={`Drag ${name} to another place`}
            title="Drag to move (or use the arrow keys)"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); if (!first) moveByKey(-1); }
              if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); if (!last) moveByKey(1); }
            }}
            {...drag.listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
        <h2 className="flex min-w-0 flex-1 text-[13px] font-semibold text-ink-800 dark:text-ink-200">
          {to && !editing ? (
            // The whole heading row leads to the page that shows this in full;
            // the arrow at its far end says so.
            <Link
              to={to}
              aria-label={name}
              className="group/head flex min-w-0 flex-1 items-baseline gap-2 rounded outline-none hover:text-ink-900 focus-visible:underline dark:hover:text-ink-100"
            >
              <span className="truncate">{name}</span>
              {counted}
              <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 self-center text-ink-300 transition-colors group-hover/head:text-ink-700 group-focus-visible/head:text-ink-700 dark:text-ink-600 dark:group-hover/head:text-ink-200 dark:group-focus-visible/head:text-ink-200" />
            </Link>
          ) : (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate">{name}</span>
              {counted}
            </span>
          )}
        </h2>

        {editing && (
          <div className="ml-auto flex items-center gap-0.5">
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className={tool} aria-label={`Settings for ${name}`} title="Settings">
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[17rem] p-3.5" data-testid={`home-settings-${id}`}>
                <p className="pb-2.5 text-[13px] font-semibold text-ink-900 dark:text-ink-100">{name}</p>
                <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2.5">
                  {/* Width means nothing in the phone's single column. */}
                  <span className="hidden text-[12px] text-ink-500 dark:text-ink-400 sm:block">Width</span>
                  <div role="group" aria-label={`Width of ${name}`} className="ds-seg hidden w-full sm:inline-flex">
                    {HOME_SIZES.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className="ds-seg-item h-7 flex-1 px-1.5 text-[12px]"
                        aria-pressed={size === option}
                        onClick={() => onResize?.(option)}
                      >
                        {HOME_SIZE_LABELS[option]}
                      </button>
                    ))}
                  </div>
                  {settings}
                  <span className="text-[12px] text-ink-500 dark:text-ink-400">Move</span>
                  <div className="flex gap-1.5">
                    <button type="button" className={moveButton} disabled={first} onClick={() => onMove?.(-1)} aria-label={`Move ${name} earlier`}>
                      <ArrowLeft className="h-3.5 w-3.5" />
                      Earlier
                    </button>
                    <button type="button" className={moveButton} disabled={last} onClick={() => onMove?.(1)} aria-label={`Move ${name} later`}>
                      Later
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <button
              type="button"
              className={cn(tool, "hover:text-red-500 dark:hover:text-red-300")}
              onClick={onRemove}
              aria-label={`Remove ${name}`}
              title="Remove from Home"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </header>

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
