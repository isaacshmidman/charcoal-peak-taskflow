// @ts-nocheck
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sliders, X, Plus, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * @typedef {{ value: string, label: string, scope?: string, hideOnScope?: string[], group?: string }} SortOption
 */

/** @type {SortOption[]} */
export const SORT_OPTIONS = [
  { value: "none", label: "None" },
  { value: "date_asc", label: "Date: Oldest → Newest", hideOnScope: ["calendar"], group: "date" },
  { value: "date_desc", label: "Date: Newest → Oldest", hideOnScope: ["calendar"], group: "date" },
  { value: "deleted_asc", label: "Deleted: Oldest → Newest", scope: "deleted", group: "deleted" },
  { value: "deleted_desc", label: "Deleted: Newest → Oldest", scope: "deleted", group: "deleted" },
  { value: "completed_first", label: "Completed First", group: "completion" },
  { value: "uncompleted_first", label: "Uncompleted First", group: "completion" },
  // All-day sort is calendar-only — on the timed grid the start time
  // already does the work. In Day/Week views it changes whether all-day
  // entries are listed before or after timed ones; in Month/Year cells
  // it changes where in the per-day stack they land.
  { value: "all_day_first", label: "All-Day First", scope: "calendar", group: "all_day" },
  { value: "all_day_last", label: "All-Day Last", scope: "calendar", group: "all_day" },
  { value: "priority_asc", label: "Priority: Highest → Lowest", group: "priority" },
  { value: "priority_desc", label: "Priority: Lowest → Highest", group: "priority" },
  { value: "tag_az", label: "Tag: A → Z", group: "tag" },
  { value: "recurrence", label: "Recurrence Type", group: "recurrence" },
  // Sorts by the user-configured calendar order (Settings → Calendar Order).
  // Hidden on the calendar page itself — that page shows everything by
  // calendar already and has its own visibility dropdown.
  { value: "calendar_order", label: "Calendar Order", hideOnScope: ["calendar"], group: "calendar_order" },
];

const groupOf = (value) => SORT_OPTIONS.find((o) => o.value === value)?.group;

const MAX_SORTS = 5;

function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * @param {{
 *   sorts: string[],
 *   onSortsChange: (sorts: string[]) => void,
 *   page?: string,
 * }} props
 */
export default function MultiSortPanel({ sorts, onSortsChange, page = "default" }) {
  const [open, setOpen] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState(-1);

  const availableOptions = SORT_OPTIONS.filter(
    (opt) => (!opt.scope || opt.scope === page) && (!opt.hideOnScope || !opt.hideOnScope.includes(page))
  );
  const labelFor = (value) =>
    SORT_OPTIONS.find((o) => o.value === value)?.label || "None";

  const setSortAt = (index, value) => {
    const next = [...sorts];
    next[index] = value;
    onSortsChange(next);
    // Collapse this row after selection
    setExpandedIndex(-1);
  };

  const removeSortAt = (index) => {
    const next = sorts.filter((_, i) => i !== index);
    onSortsChange(next.length ? next : ["none"]);
    setExpandedIndex(-1);
  };

  const addSort = () => {
    if (sorts.length >= MAX_SORTS) return;
    const next = [...sorts, "none"];
    onSortsChange(next);
    setExpandedIndex(next.length - 1);
  };

  const toggleRow = (index) => {
    setExpandedIndex((cur) => (cur === index ? -1 : index));
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setExpandedIndex(-1);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
          title="Multi-level sorting"
        >
          <Sliders className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 p-3 max-h-[calc(100vh-6rem)] overflow-y-auto"
      >
        <div className="space-y-2">
          {sorts.map((value, index) => {
            const isExpanded = expandedIndex === index;
            const usedGroups = new Set(
              sorts
                .map((v, i) => (i === index ? null : v))
                .filter((v) => v && v !== "none")
                .map((v) => groupOf(v))
                .filter(Boolean)
            );
            return (
              <div key={index} className="rounded-lg border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/60">
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => toggleRow(index)}
                    className="flex-1 flex items-center gap-2 text-left min-w-0"
                  >
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                      {ordinal(index + 1)} Sort:
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 truncate flex-1">{labelFor(value)}</span>
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                    )}
                  </button>
                  {sorts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSortAt(index)}
                      className="p-1 text-slate-300 dark:text-slate-600 hover:text-red-400 transition-colors"
                      title="Remove sort"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {isExpanded && (
                  <div className="px-2 pb-2 space-y-1">
                    {availableOptions.map((opt) => {
                      const isSelected = value === opt.value;
                      const isUsedElsewhere =
                        opt.value !== "none" && opt.group && usedGroups.has(opt.group) && !isSelected;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => !isUsedElsewhere && setSortAt(index, opt.value)}
                          disabled={isUsedElsewhere}
                          className={cn(
                            "w-full text-left px-3 py-1.5 text-xs rounded transition-colors",
                            isSelected
                              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium"
                              : isUsedElsewhere
                                ? "text-slate-300 dark:text-slate-600 cursor-not-allowed opacity-40 bg-slate-50 dark:bg-slate-800/50"
                                : "text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700"
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {sorts.length < MAX_SORTS && (
            <button
              type="button"
              onClick={addSort}
              className="w-full rounded-lg border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/60 px-2 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-200 dark:hover:border-slate-700 flex items-center justify-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add sort
            </button>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
