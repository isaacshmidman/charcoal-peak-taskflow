// @ts-nocheck
/**
 * @file The top of the Calendar page: the shared page header (title,
 * count, search, which calendars show, sort, New Task) with a second row
 * under it — step back/forward, the range on show, Today, sync, and the
 * view switch.
 *
 * Stateless: every interactive piece is driven by props from the parent
 * Calendar page.
 */
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader, { PageSearch } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import MultiSortPanel from "@/components/tasks/MultiSortPanel";
import CalendarVisibilityDropdown from "@/components/calendar/CalendarVisibilityDropdown";

const VIEWS = ["day", "week", "month", "year"];

export default function CalendarToolbar({
  view,
  onViewChange,
  rangeLabel,
  scopedCount,
  search,
  setSearch,
  showSearch,
  setShowSearch,
  sorts,
  onSortsChange,
  calendarsList,
  hiddenCalendars,
  onHiddenCalendarsChange,
  activeIntegration,
  online,
  syncing,
  lastSyncedLabel,
  onSyncNow,
  onPrev,
  onNext,
  onToday,
  onNewTask,
}) {
  return (
    <PageHeader
      title="Calendar"
      sub={<>{scopedCount} task{scopedCount !== 1 ? "s" : ""}</>}
      below={
        // Where you are and how you're looking at it. Left: step back and
        // forward, the range, and a way home to today. Right: the view.
        // On a phone the view switch drops to its own line, full width.
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              aria-label="Previous"
              title="Previous"
              variant="ghost"
              size="icon"
              className="-ml-2 h-8 w-8 shrink-0 text-ink-500 dark:text-ink-400 hover:text-ink-900 dark:hover:text-ink-100"
              onClick={onPrev}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              aria-label="Next"
              title="Next"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-ink-500 dark:text-ink-400 hover:text-ink-900 dark:hover:text-ink-100"
              onClick={onNext}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="ml-1 truncate text-[15px] font-semibold tabular-nums text-ink-900 dark:text-ink-100" data-testid="calendar-range">
              {rangeLabel}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-2 h-7 shrink-0 px-2.5 text-xs"
              onClick={onToday}
              title="Jump to today"
            >
              Today
            </Button>
          </div>
          <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
            {activeIntegration && (
              <div className="inline-flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onSyncNow}
                  disabled={syncing || !online}
                  className="h-8 gap-1 px-2 text-xs text-ink-500 dark:text-ink-400 hover:text-ink-900 dark:hover:text-ink-100"
                  title={online ? "Sync calendars now" : "Calendar sync needs an internet connection"}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
                  <span className="hidden sm:inline">Sync</span>
                </Button>
                <span className="hidden whitespace-nowrap text-[11px] leading-none text-ink-400 dark:text-ink-500 md:inline">
                  {syncing ? "Syncing…" : lastSyncedLabel}
                </span>
              </div>
            )}
            <div className="ds-seg ml-auto flex-1 sm:flex-none">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onViewChange(v)}
                  aria-pressed={view === v}
                  className="ds-seg-item flex-1 px-3 py-1 text-xs capitalize sm:flex-none"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>
      }
    >
      <PageSearch open={showSearch} onOpenChange={setShowSearch} value={search} onChange={setSearch} />
      <CalendarVisibilityDropdown
        calendars={calendarsList}
        hidden={hiddenCalendars}
        onChange={onHiddenCalendarsChange}
      />
      <MultiSortPanel sorts={sorts} onSortsChange={onSortsChange} page="calendar" />
      <Button aria-label="New Task" onClick={onNewTask} className="h-9 gap-1.5">
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">New Task</span>
      </Button>
    </PageHeader>
  );
}
