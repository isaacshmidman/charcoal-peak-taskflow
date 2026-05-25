// @ts-nocheck
/**
 * @file Calendar page toolbar — top row (title + scope count +
 * connect-calendars hint + search + visibility dropdown + sort + new
 * task) and second row (range label + sync + view switcher + prev /
 * today / next nav).
 *
 * Stateless: every interactive piece is driven by props from the parent
 * Calendar page.
 */
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedSearchInput } from "@/components/ui/animated-search-input";
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
  integrationsConnected,
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
  const navigate = useNavigate();

  return (
    <>
      {/* Top row: title + count + centered empty-state link + actions */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Calendar</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            {scopedCount} task{scopedCount !== 1 ? "s" : ""}
          </p>
        </div>
        {!integrationsConnected && (
          <div className={cn("hidden items-center shrink-0", showSearch ? "2xl:flex" : "lg:flex")}>
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 leading-none whitespace-nowrap">
              Connect Calendars in
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  navigate("/Settings", {
                    state: { scrollTo: "bottom" },
                  })
                }
                className="h-7 px-2 gap-1 text-xs font-medium text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#222222]"
              >
                <SettingsIcon className="w-3.5 h-3.5" />
                Settings
              </Button>
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <AnimatedSearchInput
            open={showSearch}
            value={search}
            onChange={setSearch}
            onClose={() => setShowSearch(false)}
          />
          <Button
            variant="ghost"
            size="icon"
            data-search-toggle
            className="h-9 w-9 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
            onMouseDown={(e) => { if (showSearch) e.preventDefault(); }}
            onClick={() => {
              if (showSearch) setSearch("");
              setShowSearch((v) => !v);
            }}
          >
            <Search className="w-4 h-4" />
          </Button>
          <CalendarVisibilityDropdown
            calendars={calendarsList}
            hidden={hiddenCalendars}
            onChange={onHiddenCalendarsChange}
          />
          <MultiSortPanel sorts={sorts} onSortsChange={onSortsChange} page="calendar" />
          <Button
            onClick={onNewTask}
            className="bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 h-9 gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Task</span>
          </Button>
        </div>
        {!integrationsConnected && !showSearch && (
          <div className="basis-full min-w-0 lg:hidden">
            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-5 text-slate-400 dark:text-slate-500">
              Connect Calendars in
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  navigate("/Settings", {
                    state: { scrollTo: "bottom" },
                  })
                }
                className="h-7 px-2 gap-1 text-xs font-medium text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#222222]"
              >
                <SettingsIcon className="w-3.5 h-3.5" />
                Settings
              </Button>
            </span>
          </div>
        )}
      </div>

      {/* Second row: range label + tz / view switcher + nav arrows */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{rangeLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          {activeIntegration && (
            <div className="inline-flex items-center gap-1.5 mr-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={onSyncNow}
                disabled={syncing || !online}
                className="h-8 px-2 gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                title={online ? "Sync calendars now" : "Calendar sync needs an internet connection"}
              >
                <RefreshCw className={cn("w-3.5 h-3.5", syncing && "animate-spin")} />
                <span className="hidden sm:inline">Sync</span>
              </Button>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 leading-none whitespace-nowrap hidden md:inline">
                {syncing ? "Syncing…" : lastSyncedLabel}
              </span>
            </div>
          )}
          <div className="inline-flex rounded-lg border border-slate-100 dark:border-[#303030] bg-white dark:bg-[#0c0c0c] p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onViewChange(v)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-md capitalize transition-colors",
                  view === v
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
              onClick={onPrev}
              title="Previous"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <button
              type="button"
              onClick={onToday}
              className="text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-slate-100 px-2 py-1 rounded hover:bg-slate-50 dark:hover:bg-[#222222]"
              title="Jump to today"
            >
              Today
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
              onClick={onNext}
              title="Next"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
