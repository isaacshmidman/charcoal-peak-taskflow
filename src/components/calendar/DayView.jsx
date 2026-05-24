// @ts-nocheck
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useDroppable } from "@dnd-kit/core";
import { isSameDay } from "date-fns/isSameDay";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import MiniMiniTaskCard from "./MiniMiniTaskCard";
import { parseTaskTime, compareTaskTime } from "@/lib/sort-helpers";
import { layoutTimedTasks } from "@/lib/calendar-layout";
import { toDateStr } from "./MonthCalendar";

const HOUR_HEIGHT = 48; // px per hour slot
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const ALLDAY_WIDTH_KEY = "calendar_day_allday_width";
const ALLDAY_COLLAPSE_KEY = "calendar_day_allday_collapsed";
const MIN_ALLDAY_W = 96;
const ALLDAY_ROW_HEIGHT = 26;
const ALLDAY_MORE_HEIGHT = 24;
const COLLAPSED_ALLDAY_VISIBLE = 2;
const getMaxAllDayW = () => {
  if (typeof window === "undefined") return 480;
  return Math.max(MIN_ALLDAY_W, Math.floor(window.innerWidth * 0.5));
};

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
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
            aria-label={collapsed ? "Expand all-day" : "Collapse all-day"}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
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
      {allDayTasks.length === 0 ? (
        <p className="text-[11px] text-slate-400 dark:text-slate-500">No all-day tasks</p>
      ) : (
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

  const [allDayWidth, setAllDayWidth] = useState(() => {
    try {
      const raw = localStorage.getItem(ALLDAY_WIDTH_KEY);
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n >= MIN_ALLDAY_W && n <= getMaxAllDayW()) return n;
    } catch {
      // fall through
    }
    return 192;
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
      localStorage.setItem(ALLDAY_WIDTH_KEY, String(allDayWidth));
    } catch {
      // ignore
    }
  }, [allDayWidth]);

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

  const startResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = allDayWidth;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    const onMove = (ev) => {
      // All-day sits on the right: dragging LEFT increases its width.
      const dx = startX - ev.clientX;
      const next = Math.max(MIN_ALLDAY_W, Math.min(getMaxAllDayW(), startW + dx));
      setAllDayWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [allDayWidth]);

  return (
    <div className="flex items-stretch gap-0">
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
          {HOURS.map((h) => (
            <div
              key={h}
              className="absolute left-0 right-0 border-t border-slate-100 dark:border-[#303030] flex"
              style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
            >
              <div className="w-12 shrink-0 text-[10px] text-slate-400 dark:text-slate-500 pt-0.5 pl-1 select-none">
                {formatHour(h)}
              </div>
              <div className="flex-1" />
            </div>
          ))}

          {/* Now line */}
          {nowMinutes != null && (
            <div
              className="absolute left-12 right-1 border-t-2 border-red-500 pointer-events-none z-10"
              style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
            >
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

      {/* Splitter (desktop only) */}
      {useSideAllDay && (
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={startResize}
          className="flex w-2 cursor-col-resize items-center justify-center group shrink-0"
        >
          <div className="w-0.5 h-8 bg-slate-200 dark:bg-[#222222] rounded-full group-hover:bg-slate-400 transition-colors" />
        </div>
      )}

      {/* All-day column — fixed width when there is room; mobile uses sticky overlay above. */}
      {useSideAllDay && (
        <div className="shrink-0 w-[var(--ad-w)]" style={{ "--ad-w": `${allDayWidth}px` }}>
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
