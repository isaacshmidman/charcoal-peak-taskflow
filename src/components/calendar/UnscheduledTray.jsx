// @ts-nocheck
/**
 * @file Unscheduled tray — time-blocking's missing half. Lists tasks
 * without a due date as draggable MiniMiniTaskCards; drag one onto any
 * existing calendar droppable to schedule it (the timed/allday/day drop
 * handlers already do the right thing for a dateless task — zero changes
 * there). The tray root is itself a droppable (kind "unscheduled") so
 * dragging a scheduled task INTO it clears the date.
 *
 * Presence rules (calm by default):
 * - No unscheduled tasks and no drag in progress → renders nothing.
 * - During any drag it always shows (it's the unschedule drop target).
 * - Desktop: right panel; collapsed = slim rail that stays droppable;
 *   collapse persisted (calendar_unscheduled_collapsed, the DayView
 *   ALLDAY_COLLAPSE_KEY pattern). Default collapsed — a new feature
 *   shouldn't rearrange anyone's calendar unasked.
 * - Mobile: pill above the bottom nav expanding to a bounded sheet; the
 *   sheet force-collapses while dragging so it never covers the drop
 *   targets the user is aiming for.
 */
import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { CalendarPlus, ChevronLeft, ChevronRight, X } from "lucide-react";
import MiniMiniTaskCard from "@/components/calendar/MiniMiniTaskCard";
import { Card } from "@/components/ui/card";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "calendar_unscheduled_collapsed";

export default function UnscheduledTray({ tasks, priorities, onTaskClick, onToggleDone, dragActive }) {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(COLLAPSE_KEY);
      return saved == null ? true : saved === "1";
    } catch {
      return true;
    }
  });
  // Mobile expansion is ephemeral — always starts closed.
  const [sheetOpen, setSheetOpen] = useState(false);

  const { setNodeRef, isOver } = useDroppable({
    id: "unscheduled-tray",
    data: { kind: "unscheduled" },
  });

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      try { localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1"); } catch {}
      return !v;
    });
  };

  if (tasks.length === 0 && !dragActive) return null;

  const dropRing = isOver && "ring-2 ring-slate-400 dark:ring-slate-500";

  /* ── Mobile: pill / bounded sheet ────────────────────────────── */
  if (isMobile) {
    const showSheet = sheetOpen && !dragActive;
    return (
      <div ref={setNodeRef} className="sm:hidden fixed left-4 right-4 bottom-20 z-30">
        {showSheet ? (
          <Card className={cn("shadow-pop max-h-[40vh] flex flex-col", dropRing)}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border-hairline">
              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Unscheduled · {tasks.length}
              </p>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                aria-label="Close unscheduled tray"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-2 space-y-1.5">
              {tasks.map((task) => (
                <MiniMiniTaskCard
                  key={task.id}
                  task={task}
                  priorities={priorities}
                  onClick={onTaskClick}
                  onToggleDone={onToggleDone}
                />
              ))}
            </div>
          </Card>
        ) : (
          <button
            type="button"
            data-testid="unscheduled-pill"
            onClick={() => setSheetOpen(true)}
            className={cn(
              "w-full flex items-center justify-center gap-1.5 rounded-full bg-surface-card border border-border-strong shadow-pop px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300",
              dropRing
            )}
          >
            <CalendarPlus className="w-3.5 h-3.5" />
            Unscheduled · {tasks.length}
            {dragActive && <span className="text-slate-400 dark:text-slate-500">— drop to unschedule</span>}
          </button>
        )}
      </div>
    );
  }

  /* ── Desktop: right panel / slim rail ────────────────────────── */
  if (collapsed && !dragActive) {
    return (
      <button
        ref={setNodeRef}
        type="button"
        data-testid="unscheduled-rail"
        onClick={toggleCollapsed}
        title="Unscheduled tasks"
        className={cn(
          "hidden sm:flex flex-col items-center gap-2 shrink-0 self-stretch px-1.5 py-3 rounded-xl border border-border-hairline bg-surface-card text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors",
          dropRing
        )}
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        <CalendarPlus className="w-4 h-4" />
        <span className="text-[10px] font-semibold tabular-nums">{tasks.length}</span>
      </button>
    );
  }

  return (
    <Card
      ref={setNodeRef}
      data-testid="unscheduled-tray"
      className={cn("hidden sm:flex flex-col shrink-0 w-64 max-h-[70vh] sticky top-20", dropRing)}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-hairline">
        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
          Unscheduled · {tasks.length}
        </p>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
          aria-label="Collapse unscheduled tray"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      {tasks.length === 0 ? (
        <div className="px-3 py-8 text-center">
          <p className="text-xs text-slate-400 dark:text-slate-500">Nothing waiting to be scheduled.</p>
          <p className="text-[10px] text-slate-300 dark:text-slate-600 mt-1">
            Tasks without a date will gather here.
          </p>
        </div>
      ) : (
        <div className="overflow-y-auto p-2 space-y-1.5">
          {tasks.map((task) => (
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
    </Card>
  );
}
