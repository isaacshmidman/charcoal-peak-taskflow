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
import { useSplitPane } from "@/hooks/useSplitPane";
import SplitDivider from "@/components/ui/split-divider";

const HOUR_HEIGHT = 48; // px per hour slot
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const ALLDAY_WIDTH_KEY = "calendar_day_allday_width";
const ALLDAY_COLLAPSE_KEY = "calendar_day_allday_collapsed";
const MIN_ALLDAY_W = 96;
const ALLDAY_ROW_HEIGHT = 26;
const ALLDAY_MORE_HEIGHT = 24;
const COLLAPSED_ALLDAY_VISIBLE = 2;
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
      className={cn("relative", isOver && "bg-blue-50 dark:bg-[#101f34]")}
      style={{ height: HOURS.length * HOUR_HEIGHT }}
    >
      {children}
    </div>
  );
}

function AllDayOverlayCell({ dateStr, allDayTasks, priorities, onTaskClick, onToggleDone, collapsed, onExpand }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `allday-${dateStr}`,
    data: { kind: "allday", dateStr },
  });
  const visibleLimit = collapsed ? COLLAPSED_ALLDAY_VISIBLE : allDayTasks.length;
  const visible = allDayTasks.slice(0, visibleLimit);
  const hiddenCount = Math.max(0, allDayTasks.length - visible.length);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-1 min-w-0 border-l border-slate-100 dark:border-[#303030] p-1 space-y-0.5",
        collapsed && "overflow-hidden",
        isOver && "bg-blue-50 dark:bg-[#101f34]"
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
          className="h-5 w-full rounded border border-slate-200 dark:border-[#343434] bg-slate-50 dark:bg-[#161616] px-1.5 text-left text-[10px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#222222] transition-colors"
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
}) {
  const visibleCount = collapsed
    ? Math.min(COLLAPSED_ALLDAY_VISIBLE, allDayTasks.length)
    : allDayTasks.length;
  const hasMore = collapsed && allDayTasks.length > COLLAPSED_ALLDAY_VISIBLE;
  const height =
    Math.max(1, visibleCount) * ALLDAY_ROW_HEIGHT +
    (hasMore ? ALLDAY_MORE_HEIGHT : 0) +
    8;

  return (
    <div className="sticky top-0 z-30 bg-white dark:bg-[#0c0c0c] border-b border-slate-100 dark:border-[#303030]">
      <div className="flex" style={{ height }}>
        <div className="w-12 shrink-0 border-r border-slate-100 dark:border-[#303030] bg-white dark:bg-[#0c0c0c] flex items-start justify-center pt-1">
          {/* Only offer the toggle when collapsing actually hides
              something — an arrow that expands nothing is a dead control. */}
          {allDayTasks.length > COLLAPSED_ALLDAY_VISIBLE && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-[#222222] dark:hover:text-slate-200"
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
        />
      </div>
    </div>
  );
}

function AllDayColumn({ dateStr, allDayTasks, priorities, onTaskClick, onToggleDone }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `allday-${dateStr}`,
    data: { kind: "allday", dateStr },
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "border border-slate-100 dark:border-[#303030] rounded-lg bg-white dark:bg-[#0c0c0c] p-2 h-full",
        isOver && "bg-blue-50 dark:bg-[#101f34]"
      )}
    >
      <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">All day</h3>
      {allDayTasks.length === 0 ? null : (
        <div
          className={cn(
            "space-y-1 overflow-y-auto",
            "[&::-webkit-scrollbar]:w-1",
            "[&::-webkit-scrollbar-track]:bg-transparent",
            "[&::-webkit-scrollbar-thumb]:bg-slate-200",
            "dark:[&::-webkit-scrollbar-thumb]:bg-slate-700",
            "[&::-webkit-scrollbar-thumb]:rounded-full",
            "[&::-webkit-scrollbar-thumb:hover]:bg-slate-300",
            "dark:[&::-webkit-scrollbar-thumb:hover]:bg-slate-600",
          )}
          style={{ maxHeight: "calc(70vh - 2.5rem)" }}
        >
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
}) {
  const timedScrollRef = useRef(null);
  const dateStr = toDateStr(anchorDate);
  const useSideAllDay = useMediaQuery("(min-width: 640px)");

  // The divider gesture (detents, hysteresis, glide) lives in
  // useSplitPane so Notes uses the same one. fromEnd: the all-day column
  // sits on the RIGHT, so dragging left grows it.
  const {
    size: allDayWidth,
    containerRef,
    startResize,
    resetSplit,
    snapped,
    glide,
  } = useSplitPane({
    storageKey: ALLDAY_WIDTH_KEY,
    minSize: MIN_ALLDAY_W,
    defaultSize: 192,
    fromEnd: true,
  });
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


  return (
    <div ref={containerRef} className="flex items-stretch gap-0">
      {/* Timed column */}
      <div
        ref={timedScrollRef}
        className="flex-1 min-w-0 relative border border-slate-100 dark:border-[#303030] rounded-lg bg-white dark:bg-[#0c0c0c] overflow-y-auto max-h-[70vh]"
      >
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
          />
        )}
        <TimedDropZone dateStr={dateStr}>
          {/* The vertical rule sits at the gutter's edge, lining up with
              the one MobileAllDayOverlay already draws beside its expand
              arrow, so the grid reads as one column either way. */}
          <div className="absolute left-12 top-0 bottom-0 w-px bg-slate-100 dark:bg-[#303030] pointer-events-none" />

          {HOURS.map((h) => (
            <div key={h}>
              {/* Label centred on the line, right-aligned so the gap to
                  the grid is the same for "1 AM" and "12 PM". */}
              <div
                className="absolute left-0 w-12 -translate-y-1/2 pr-2 text-right text-[10px] text-slate-400 dark:text-slate-500 select-none"
                style={{ top: h * HOUR_HEIGHT }}
              >
                {formatHour(h)}
              </div>
              <div
                className="absolute left-12 right-0 border-t border-slate-100 dark:border-[#303030]"
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

          {/* Timed tasks */}
          <div className="absolute top-0 left-12 right-1 bottom-0">
            {laidOutTimed.map(({ task, startMin, endMin, col, cols, colSpan }) => {
              const top = (startMin / 60) * HOUR_HEIGHT;
              const height = Math.max(
                24,
                ((endMin - startMin) / 60) * HOUR_HEIGHT
              );
              // Width = colSpan / cols (not 1 / cols) so events expand
              // into empty adjacent columns. See layoutTimedTasks.
              const widthPct = ((colSpan || 1) / cols) * 100;
              const leftPct = (col / cols) * 100;
              return (
                <div
                  key={task.id}
                  className="absolute px-0.5"
                  style={{
                    top,
                    height,
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                  }}
                >
                  <MiniMiniTaskCard
                    task={task}
                    priorities={priorities}
                    onClick={onTaskClick}
                    onToggleDone={onToggleDone}
                    fillHeight
                  />
                </div>
              );
            })}
          </div>
        </TimedDropZone>
      </div>

      {/* Splitter (desktop only). Drag with 30/50/70 detents; double-click
          resets to 50/50. The handle pill grows + darkens while latched
          so the detent reads as a tactile "click". */}
      {useSideAllDay && (
        <SplitDivider
          onPointerDown={startResize}
          onDoubleClick={resetSplit}
          snapped={snapped}
          title="Drag to resize — snaps at 30 / 50 / 70%. Double-click for 50/50."
        />
      )}

      {/* All-day column — fixed width when there is room; mobile uses
          sticky overlay above. `glide` enables a brief width transition
          only around snap latch/unlatch/settle so the detent eases into
          place; free drag stays transition-free (1:1 with the pointer). */}
      {useSideAllDay && (
        <div
          className={cn(
            "shrink-0 w-[var(--ad-w)]",
            glide && "transition-[width] duration-100 ease-out"
          )}
          style={{ "--ad-w": `${allDayWidth}px` }}
        >
          <AllDayColumn
            dateStr={dateStr}
            allDayTasks={allDayTasks}
            priorities={priorities}
            onTaskClick={onTaskClick}
            onToggleDone={onToggleDone}
          />
        </div>
      )}
    </div>
  );
}
