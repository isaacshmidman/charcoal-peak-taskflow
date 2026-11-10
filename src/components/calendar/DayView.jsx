// @ts-nocheck
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useDroppable } from "@dnd-kit/core";
import { isSameDay } from "date-fns/isSameDay";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import MiniMiniTaskCard from "./MiniMiniTaskCard";
import { parseTaskTime, compareTaskTime } from "@/lib/sort-helpers";
import { layoutTimedTasks } from "@/lib/calendar-layout";
import { toDateStr } from "@/lib/dates";
import TwoPane from "@/components/ui/two-pane";
import { CALENDAR_PANEL_HEIGHT } from "./panel";
import { useEmptySlotClick } from "./useEmptySlotClick";
import SlotGhost from "./SlotGhost";
import TimedEventBlock from "./TimedEventBlock";

const HOUR_HEIGHT = 48; // px per hour slot
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const ALLDAY_WIDTH_KEY = "calendar_day_allday_width";
const ALLDAY_COLLAPSE_KEY = "calendar_day_allday_collapsed";
const MIN_ALLDAY_W = 96;
const ALLDAY_ROW_HEIGHT = 26;
const ALLDAY_MORE_HEIGHT = 24;
import { COLLAPSED_ALLDAY_VISIBLE, canCollapseAllDay } from "@/lib/allday-collapse";
const formatHour = (h) => {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
};

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else mql.removeListener(onChange);
    };
  }, [query]);

  return matches;
}

function TimedDropZone({ dateStr, children }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `timed-${dateStr}`,
    data: { kind: "timed", dateStr, hourHeight: HOUR_HEIGHT },
  });
  return (
    <div
      ref={setNodeRef}
      className={cn("relative", isOver && "bg-sun-100/60 dark:bg-sun-400/10")}
      style={{ height: HOURS.length * HOUR_HEIGHT }}
    >
      {children}
    </div>
  );
}

function AllDayOverlayCell({ dateStr, allDayTasks, priorities, onTaskClick, onToggleDone, collapsed, onExpand, onCreate }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `allday-${dateStr}`,
    data: { kind: "allday", dateStr },
  });
  const { handlers: createHandlers } = useEmptySlotClick({ onCreate });
  // Hiding a single row costs nearly what it saves, so a strip that
  // small shows everything — see lib/allday-collapse.
  const visibleLimit = collapsed && canCollapseAllDay(allDayTasks.length) ? COLLAPSED_ALLDAY_VISIBLE : allDayTasks.length;
  const visible = allDayTasks.slice(0, visibleLimit);
  const hiddenCount = Math.max(0, allDayTasks.length - visible.length);

  return (
    <div
      ref={setNodeRef}
      {...createHandlers}
      data-testid={`calendar-allday-${dateStr}`}
      className={cn(
        "flex-1 min-w-0 border-l border-ink-100 dark:border-night-line p-1 space-y-0.5",
        collapsed && "overflow-hidden",
        isOver && "bg-sun-100/60 dark:bg-sun-400/10"
      )}
    >
      {visible.map((task) => (
        <MiniMiniTaskCard
          key={task.id}
          task={task}
          priorities={priorities}
          onClick={onTaskClick}
          onToggleDone={onToggleDone}
        />
      ))}
      {collapsed && hiddenCount > 0 && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onExpand?.();
          }}
          className="h-5 w-full rounded border border-ink-200 dark:border-night-line-strong bg-ink-50 dark:bg-night-raised truncate px-1.5 text-left text-[10px] font-semibold leading-5 text-ink-700 dark:text-ink-200 hover:bg-ink-100 dark:hover:bg-night-high transition-colors"
          title={`Show ${hiddenCount} more all-day task${hiddenCount === 1 ? "" : "s"}`}
        >
          {hiddenCount} more
        </button>
      )}
    </div>
  );
}

function MobileAllDayOverlay({
  dateStr,
  allDayTasks,
  priorities,
  onTaskClick,
  onToggleDone,
  collapsed,
  onToggleCollapsed,
  onExpand,
  onCreate,
}) {
  const collapsible = canCollapseAllDay(allDayTasks.length);
  const visibleCount = collapsed && collapsible
    ? Math.min(COLLAPSED_ALLDAY_VISIBLE, allDayTasks.length)
    : allDayTasks.length;
  const hasMore = collapsed && collapsible;
  const height =
    Math.max(1, visibleCount) * ALLDAY_ROW_HEIGHT +
    (hasMore ? ALLDAY_MORE_HEIGHT : 0) +
    8;

  return (
    <div className="sticky top-0 z-30 bg-surface-card border-b border-ink-100 dark:border-night-line">
      <div className="flex" style={{ height }}>
        {/* No border-r: the cell beside it already draws a border-l, and
            the two together rendered this rule 2px thick — a pixel heavier
            than the week tab's. */}
        <div className="w-12 shrink-0 bg-surface-card flex items-start justify-center pt-1">
          {/* Only offer the toggle when collapsing actually hides
              something — an arrow that expands nothing is a dead control. */}
          {collapsible && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 dark:text-ink-500 dark:hover:bg-night-high dark:hover:text-ink-200"
              aria-label={collapsed ? "Expand all-day" : "Collapse all-day"}
            >
              {collapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
        <AllDayOverlayCell
          dateStr={dateStr}
          allDayTasks={allDayTasks}
          priorities={priorities}
          onTaskClick={onTaskClick}
          onToggleDone={onToggleDone}
          collapsed={collapsed}
          onExpand={onExpand}
          onCreate={onCreate}
        />
      </div>
    </div>
  );
}

function AllDayColumn({ dateStr, allDayTasks, priorities, onTaskClick, onToggleDone, onCreate }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `allday-${dateStr}`,
    data: { kind: "allday", dateStr },
  });
  const { handlers: createHandlers } = useEmptySlotClick({ onCreate });
  return (
    <div
      ref={setNodeRef}
      {...createHandlers}
      data-testid={`calendar-allday-${dateStr}`}
      className={cn(
        "min-h-0 flex-1 overflow-y-auto p-3",
        isOver && "bg-sun-100 dark:bg-sun-400/15"
      )}
    >
      <h3 className="text-xs font-medium text-ink-500 dark:text-ink-400 mb-2">All day</h3>
      {allDayTasks.length === 0 ? null : (
        <div className="space-y-1">
          {allDayTasks.map((task) => (
            <MiniMiniTaskCard
              key={task.id}
              task={task}
              priorities={priorities}
              onClick={onTaskClick}
              onToggleDone={onToggleDone}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Day view — 24-hour vertical timeline (left) + all-day list (right).
 */
export default function DayView({
  anchorDate,
  tasks,
  priorities,
  onTaskClick,
  onToggleDone,
  // (dateStr, minutesAfterMidnight | null) — clicking empty time or the
  // all-day area opens a new task there (useEmptySlotClick).
  onCreateAt,
  // { dateStr, start, end } while a task is dragged over a timed column.
  dropPreview,
  // (task, endMinutes) — dragging an event's bottom edge.
  onResizeEnd,
}) {
  const timedScrollRef = useRef(null);
  const dateStr = toDateStr(anchorDate);
  const createTimed = onCreateAt ? (minutes) => onCreateAt(dateStr, minutes) : undefined;
  const createAllDay = onCreateAt ? () => onCreateAt(dateStr, null) : undefined;
  const timedSlot = useEmptySlotClick({ onCreate: createTimed, hourHeight: HOUR_HEIGHT });
  const useSideAllDay = useMediaQuery("(min-width: 640px)");

  const [allDayCollapsed, setAllDayCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(ALLDAY_COLLAPSE_KEY);
      if (stored === "1") return true;
      if (stored === "0") return false;
      return true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(ALLDAY_COLLAPSE_KEY, allDayCollapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [allDayCollapsed]);

  const { timedTasks, allDayTasks } = useMemo(() => {
    const timed = [];
    const allDay = [];
    for (const t of tasks) {
      if (t.parent_id) continue;
      if (t.due_date !== dateStr) continue;
      if (parseTaskTime(t.task_time) != null) timed.push(t);
      else allDay.push(t);
    }
    timed.sort((a, b) => compareTaskTime(a.task_time, b.task_time, "asc"));
    return { timedTasks: timed, allDayTasks: allDay };
  }, [tasks, dateStr]);

  const laidOutTimed = useMemo(() => layoutTimedTasks(timedTasks), [timedTasks]);

  const isToday = isSameDay(anchorDate, new Date());
  const nowMinutes = isToday
    ? new Date().getHours() * 60 + new Date().getMinutes()
    : null;

  // Auto-scroll to center the now-line on mount/date-change.
  // Falls back to 7 AM when viewing a non-today date.
  useEffect(() => {
    const el = timedScrollRef.current;
    if (!el) return;
    if (nowMinutes != null) {
      const target = (nowMinutes / 60) * HOUR_HEIGHT - el.clientHeight / 2;
      el.scrollTop = Math.max(0, target);
    } else {
      el.scrollTop = 7 * HOUR_HEIGHT;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr]);


  // Hours | all day: the app's one two-column block (ui/two-pane.jsx),
  // the same as Notes. The all-day column is the sized one, on the right;
  // it catches at 30 / 50 / 70% and double-click halves the view. On a
  // phone there's no room for it, so all-day items fold into a strip at the
  // top of the hours instead (MobileAllDayOverlay).
  const timedColumn = (
      <div ref={timedScrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        {!useSideAllDay && (
          <MobileAllDayOverlay
            dateStr={dateStr}
            allDayTasks={allDayTasks}
            priorities={priorities}
            onTaskClick={onTaskClick}
            onToggleDone={onToggleDone}
            collapsed={allDayCollapsed}
            onToggleCollapsed={() => setAllDayCollapsed((v) => !v)}
            onExpand={() => setAllDayCollapsed(false)}
            onCreate={createAllDay}
          />
        )}
        <TimedDropZone dateStr={dateStr}>
          {/* The vertical rule sits at the gutter's edge, lining up with
              the one MobileAllDayOverlay already draws beside its expand
              arrow, so the grid reads as one column either way. */}
          <div className="absolute left-12 top-0 bottom-0 w-px bg-ink-100 dark:bg-night-line pointer-events-none" />

          {HOURS.map((h) => (
            <div key={h}>
              {/* Label centred on the line, right-aligned so the gap to
                  the grid is the same for "1 AM" and "12 PM". */}
              <div
                className="absolute left-0 w-12 -translate-y-1/2 pr-2 text-right text-[10px] text-ink-400 dark:text-ink-500 select-none"
                style={{ top: h * HOUR_HEIGHT }}
              >
                {formatHour(h)}
              </div>
              <div
                className="absolute left-12 right-0 border-t border-ink-100 dark:border-night-line"
                style={{ top: h * HOUR_HEIGHT }}
              />
            </div>
          ))}

          {/* Now line */}
          {nowMinutes != null && (
            <div
              className="absolute left-12 right-1 border-t-2 border-red-500 pointer-events-none z-10"
              style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
            >
              {/* -left-1.5 puts the 12px bulb's centre on the rule at left-12. */}
              <span className="absolute -top-1.5 -left-1.5 w-3 h-3 rounded-full bg-red-500" />
            </div>
          )}

          {/* Timed tasks. Empty space in this layer is the click-to-create
              target; the ghost shows where a click would land. */}
          <div
            className="absolute top-0 left-12 right-1 bottom-0"
            data-testid={`calendar-timed-${dateStr}`}
            {...timedSlot.handlers}
          >
            <SlotGhost minutes={timedSlot.hoverMinutes} hourHeight={HOUR_HEIGHT} />
            {dropPreview?.dateStr === dateStr && (
              <SlotGhost variant="drop" minutes={dropPreview.start} endMinutes={dropPreview.end} hourHeight={HOUR_HEIGHT} />
            )}
            {laidOutTimed.map((layout) => (
              <TimedEventBlock
                key={layout.task.id}
                layout={layout}
                hourHeight={HOUR_HEIGHT}
                minHeight={24}
                priorities={priorities}
                onTaskClick={onTaskClick}
                onToggleDone={onToggleDone}
                onResize={onResizeEnd}
              />
            ))}
          </div>
        </TimedDropZone>
      </div>
  );

  return (
    <TwoPane
      className={CALENDAR_PANEL_HEIGHT}
      storageKey={ALLDAY_WIDTH_KEY}
      sized="end"
      narrow="start"
      minSize={MIN_ALLDAY_W}
      defaultSize={192}
      dividerTitle="Drag to resize — catches at 30 / 50 / 70%. Double-click for 50/50."
      start={timedColumn}
      end={
        useSideAllDay ? (
          <AllDayColumn
            dateStr={dateStr}
            allDayTasks={allDayTasks}
            priorities={priorities}
            onTaskClick={onTaskClick}
            onToggleDone={onToggleDone}
            onCreate={createAllDay}
          />
        ) : null
      }
    />
  );
}
