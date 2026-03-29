// @ts-nocheck
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sliders, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * @typedef {import("@/types/tasks").SortOption} SortOption
 */

/** @type {(SortOption & { group: string })[]} */
const SORT_OPTIONS = [
{ value: "date_asc", label: "Date (oldest first)", group: "date" },
{ value: "date_desc", label: "Date (newest first)", group: "date" },
{ value: "priority_asc", label: "Priority (high → low)", group: "priority" },
{ value: "priority_desc", label: "Priority (low → high)", group: "priority" },
{ value: "tag_az", label: "Tag (A–Z)", group: "tag" },
{ value: "recurrence", label: "Recurrence type", group: "recurrence" }];


/**
 * @param {{
 *   sorts: string[],
 *   onSortsChange: (sorts: string[]) => void,
 *   extraOptions?: SortOption[],
 * }} props
 */
export default function MultiSortPanel({ sorts, onSortsChange, extraOptions = [] }) {
  const [open, setOpen] = useState(false);

  const ALL_OPTIONS = [...SORT_OPTIONS, ...extraOptions.map(o => ({ ...o, group: o.group || o.value }))];

  // Get the groups already in use
  const usedGroups = new Set(sorts.map((s) => ALL_OPTIONS.find((o) => o.value === s)?.group).filter(Boolean));
  const usedValues = new Set(sorts);

  /**
   * @param {number} index
   */
  const getAvailableOptions = (index) => {
    const otherSorts = sorts.filter((_, i) => i !== index);
    const otherGroups = new Set(otherSorts.map((s) => ALL_OPTIONS.find((o) => o.value === s)?.group));

    return ALL_OPTIONS.map((opt) => ({
      ...opt,
      disabled: otherGroups.has(opt.group)
    }));
  };

  /**
   * @param {number} index
   * @param {string} value
   */
  const handleSetSort = (index, value) => {
    const newSorts = [...sorts];
    newSorts[index] = value;
    onSortsChange(newSorts);
  };

  const handleAddSort = () => {
    if (sorts.length < 3) {
      const nextOption = ALL_OPTIONS.find((opt) => !usedGroups.has(opt.group) && !usedValues.has(opt.value));
      if (nextOption) {
        onSortsChange([...sorts, nextOption.value]);
      }
    }
  };

  /**
   * @param {number} index
   */
  const handleRemoveSort = (index) => {
    onSortsChange(sorts.filter((_, i) => i !== index));
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-slate-400 hover:text-slate-700"
          title="Multi-level sorting">
          
          <Sliders className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-4">
        <div className="space-y-3">
          {/* Primary Sort (always required) */}
          <div>
            <p className="text-slate-900 mb-2 text-xs font-semibold">Primary Sort</p>
            <SortSelect
              value={sorts[0] || "date_asc"}
              onChange={(val) => handleSetSort(0, val)}
              options={getAvailableOptions(0)} />
            
          </div>

          {/* Secondary Sort (optional) */}
          {sorts.length > 1 &&
          <div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-900">Secondary Sort</p>
                <button
                onClick={() => handleRemoveSort(1)}
                className="text-xs text-slate-400 hover:text-red-400 active:text-red-400">
                
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <SortSelect
              value={sorts[1]}
              onChange={(val) => handleSetSort(1, val)}
              options={getAvailableOptions(1)} />
            
            </div>
          }

          {/* Tertiary Sort (optional) */}
          {sorts.length > 2 &&
          <div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-900">Tertiary Sort</p>
                <button
                onClick={() => handleRemoveSort(2)}
                className="text-xs text-slate-400 hover:text-red-400 active:text-red-400">
                
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <SortSelect
              value={sorts[2]}
              onChange={(val) => handleSetSort(2, val)}
              options={getAvailableOptions(2)} />
            
            </div>
          }

          {/* Add more sorts button */}
          {sorts.length < 3 &&
          <button
            onClick={handleAddSort}
            className="w-full text-xs text-slate-400 py-1.5 mt-2 rounded border border-dashed border-slate-200">
            
              + Add sort
            </button>
          }
        </div>
      </DropdownMenuContent>
    </DropdownMenu>);

}

/**
 * @param {{
 *   value: string,
 *   onChange: (value: string) => void,
 *   options: (SortOption & { group?: string, disabled?: boolean })[],
 * }} props
 */
function SortSelect({ value, onChange, options }) {
  return (
    <div className="space-y-1.5">
      {options.map((opt) =>
      <button
        key={opt.value}
        onClick={() => !opt.disabled && onChange(opt.value)}
        disabled={opt.disabled}
        className={cn(
          "w-full text-left px-3 py-1.5 text-xs rounded transition-colors",
          value && value === opt.value ?
          "bg-slate-900 text-white font-medium" :
          opt.disabled ?
          "text-slate-300 cursor-not-allowed bg-slate-50" :
          "text-slate-900 hover:bg-slate-100"
        )}>
        
          {opt.label}
        </button>
      )}
    </div>);

}
