import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * @typedef {import("@/types/tasks").FilterState} FilterState
 * @typedef {import("@/types/tasks").PriorityOption} PriorityOption
 */

/**
 * @param {{
 *   filters: FilterState,
 *   onFiltersChange: (filters: FilterState) => void,
 *   priorities?: PriorityOption[],
 * }} props
 */
export default function FilterBar({ filters, onFiltersChange, priorities = [] }) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  /**
   * @param {keyof FilterState} key
   * @param {string} value
   */
  const update = (key, value) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
          <Input
            placeholder="Search tasks..."
            value={filters.search}
            onChange={(e) => update("search", e.target.value)}
            className="pl-9 h-10 bg-white border-slate-100"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          className={cn("h-10 w-10 shrink-0", showAdvanced && "bg-slate-100")}
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <SlidersHorizontal className="w-4 h-4" />
        </Button>
      </div>

      {showAdvanced && (
        <div className="flex flex-wrap gap-2">
          <Select value={filters.priority} onValueChange={(v) => update("priority", v)}>
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              {priorities.map((priority) => (
                <SelectItem key={priority.id} value={priority.id}>{priority.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.taskType} onValueChange={(v) => update("taskType", v)}>
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="one_time">One-time</SelectItem>
              <SelectItem value="recurring">Recurring</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.sort} onValueChange={(v) => update("sort", v)}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="priority">Priority</SelectItem>
              <SelectItem value="due_date">Due date</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
