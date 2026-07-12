// @ts-nocheck
/**
 * @file Saved-view picker for All Tasks — a bookmark dropdown holding the
 * user's smart lists. Selecting one applies its filters (and sorts, if it
 * captured any); "Save current view…" opens a small builder pre-seeded
 * from the live page state. Views are SavedView entities (offline via the
 * registry). Status is deliberately absent from the builder: All Tasks
 * already scopes to active tasks, so a status picker would only confuse.
 */
import { useState } from "react";
import { Bookmark, BookmarkCheck, Plus, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { colorDot } from "@/lib/colors";
import { isEmptyViewFilters } from "@/lib/viewFilter";
import { cn } from "@/lib/utils";

const DUE_OPTIONS = [
  { value: "any", label: "Any date" },
  { value: "today", label: "Due today" },
  { value: "week", label: "Due this week" },
  { value: "overdue", label: "Overdue" },
  { value: "none", label: "No date" },
];

export default function ViewPicker({
  views,
  activeViewId,
  onSelect,
  onSave,
  onDelete,
  savedTags,
  priorities,
  currentSorts,
}) {
  const [builderOpen, setBuilderOpen] = useState(false);
  const [name, setName] = useState("");
  const [pickedTags, setPickedTags] = useState([]);
  const [pickedPriorities, setPickedPriorities] = useState([]);
  const [due, setDue] = useState("any");

  const activeView = views.find((v) => v.id === activeViewId) || null;

  const openBuilder = () => {
    setName("");
    setPickedTags([]);
    setPickedPriorities([]);
    setDue("any");
    setBuilderOpen(true);
  };

  const save = async () => {
    const filters = { tags: pickedTags, priority_ids: pickedPriorities, due };
    if (!name.trim() || isEmptyViewFilters(filters)) return;
    await onSave({ name: name.trim(), filters, sorts: currentSorts || [] });
    setBuilderOpen(false);
  };

  const toggle = (list, setList, value) =>
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            data-testid="view-picker-trigger"
            className={cn(
              "h-9 w-9",
              activeView
                ? "text-slate-900 dark:text-slate-100"
                : "text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
            )}
            title={activeView ? `View: ${activeView.name}` : "Saved views"}
          >
            {activeView ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onClick={() => onSelect(null)}
            className={cn("text-sm", !activeView && "font-semibold")}
          >
            All tasks
          </DropdownMenuItem>
          {views.length > 0 && <DropdownMenuSeparator />}
          {views.map((view) => (
            <DropdownMenuItem
              key={view.id}
              onClick={() => onSelect(view.id)}
              className={cn("text-sm group", view.id === activeViewId && "font-semibold")}
              data-testid={`view-item-${view.id}`}
            >
              <span className="flex-1 truncate">{view.name}</span>
              <button
                type="button"
                aria-label={`Delete view ${view.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onDelete(view.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 dark:hover:text-red-300 transition-opacity"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={openBuilder} className="text-sm" data-testid="view-save-current">
            <Plus className="w-3.5 h-3.5" />
            Save current view…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Save a view</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="View name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="view-name-input"
            />

            {priorities.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Priorities</p>
                <div className="space-y-1.5">
                  {priorities.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                      <Checkbox
                        checked={pickedPriorities.includes(p.id)}
                        onCheckedChange={() => toggle(pickedPriorities, setPickedPriorities, p.id)}
                      />
                      <span className={cn("w-2.5 h-2.5 rounded-full", colorDot[p.color] || colorDot.slate)} />
                      {p.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {savedTags.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Tags</p>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {savedTags.map((t) => (
                    <label key={t.id || t.name} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                      <Checkbox
                        checked={pickedTags.includes(t.name)}
                        onCheckedChange={() => toggle(pickedTags, setPickedTags, t.name)}
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Due</p>
              <Select value={due} onValueChange={setDue}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DUE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-sm">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={save}
              disabled={!name.trim()}
              className="w-full"
              data-testid="view-save-submit"
            >
              Save view
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
