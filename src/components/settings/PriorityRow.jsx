// @ts-nocheck
/**
 * @file Single row in the priorities list. Two visual modes:
 *   - read mode: dot, name, up/down reorder, delete X
 *   - edit mode (double-click to enter): name Input + color Select +
 *     save check + cancel X
 */
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { COLOR_OPTIONS, colorDot } from "@/lib/colors";

export default function PriorityRow({ p, idx, total, isEditing, onStartEdit, onStopEdit, onDelete, onUpdate, onMoveUp, onMoveDown }) {
  const [editName, setEditName] = useState(p.name);
  const [editColor, setEditColor] = useState(p.color);

  // When this row becomes the active edit target, seed the draft fields from the current priority.
  // When another row steals the edit, this effect resets its draft back to the saved values so the
  // next time this row is opened we don't show stale input.
  useEffect(() => {
    if (isEditing) {
      setEditName(p.name);
      setEditColor(p.color);
    }
  }, [isEditing, p.name, p.color]);

  const save = () => {
    if (editName.trim()) onUpdate(p.id, { name: editName.trim(), color: editColor });
    onStopEdit();
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 bg-white dark:bg-[#111111] border border-slate-200 dark:border-[#303030] rounded-xl px-3 py-2.5">
        <span className={cn("w-3 h-3 rounded-full shrink-0", colorDot[editColor] || colorDot.slate)} />
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {if (e.key === "Enter") save();if (e.key === "Escape") onStopEdit();}}
          className="h-7 text-sm flex-1 border-0 border-b rounded-none px-0 focus-visible:ring-0"
          autoFocus />

        <Select value={editColor} onValueChange={setEditColor}>
          <SelectTrigger className="w-24 h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COLOR_OPTIONS.map((c) =>
            <SelectItem key={c.value} value={c.value}>
                <span className="flex items-center gap-1.5">
                  <span className={cn("w-2 h-2 rounded-full", c.class)} />{c.label}
                </span>
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" onClick={save}>
          <Check className="w-3.5 h-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400 dark:text-slate-500 hover:text-red-400 dark:hover:text-red-300" onClick={onStopEdit}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>);

  }

  return (
    <div
      className="flex items-center gap-3 bg-white dark:bg-[#111111] border border-slate-100 dark:border-[#303030] rounded-xl px-3 py-2.5 hover:border-slate-200 dark:hover:border-[#454545] transition-colors"
      onDoubleClick={onStartEdit}>

      <div className="flex flex-col gap-0.5">
        <button onClick={onMoveUp} disabled={idx === 0} className="disabled:opacity-20 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 transition-colors">
          <ArrowUp className="w-3 h-3" />
        </button>
        <button onClick={onMoveDown} disabled={idx === total - 1} className="disabled:opacity-20 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 transition-colors">
          <ArrowDown className="w-3 h-3" />
        </button>
      </div>
      <span className={cn("w-3 h-3 rounded-full shrink-0", colorDot[p.color] || colorDot.slate)} />
      <span className="text-sm font-medium text-slate-900 dark:text-slate-100 flex-1 min-w-0 break-words whitespace-normal">{p.name}</span>

      <button className="text-slate-300 dark:text-slate-600 hover:text-red-400 dark:hover:text-red-300 transition-colors" onClick={(e) => {e.stopPropagation();onDelete(p.id);}}>
        <X className="w-3.5 h-3.5" />
      </button>
    </div>);

}
