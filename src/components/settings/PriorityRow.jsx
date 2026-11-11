// @ts-nocheck
/**
 * @file Single row in the priorities list. Two visual modes:
 *   - read mode: dot, name, up/down reorder, delete x
 *   - edit mode (double-click to enter): name Input + color Select +
 *     save check + cancel x
 * A row on the priorities `.ds-list`: it brings no border of its own.
 */
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { COLOR_OPTIONS, colorDot } from "@/lib/colors";
import { ClearButton } from "@/components/ui/clear-button";
import { ReorderButtons } from "./parts";

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
      <div className="flex min-h-[2.75rem] items-center gap-2 py-1.5 pl-4 pr-2">
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", colorDot[editColor] || colorDot.slate)} />
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {if (e.key === "Enter") save();if (e.key === "Escape") onStopEdit();}}
          aria-label="Priority name"
          className="h-8 min-w-0 flex-1"
          autoFocus />

        <Select value={editColor} onValueChange={setEditColor}>
          <SelectTrigger className="h-8 w-24 shrink-0 text-xs" aria-label="Priority colour">
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
        <Button aria-label="Save priority name" title="Save" size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-ink-700 hover:text-ink-900 dark:text-ink-200 dark:hover:text-ink-100" onClick={save}>
          <Check className="w-3.5 h-3.5" />
        </Button>
        <ClearButton label="Cancel renaming" onClick={onStopEdit} className="h-7 w-7" />
      </div>);

  }

  return (
    <div
      className="flex min-h-[2.75rem] items-center gap-3 py-1.5 pl-4 pr-2"
      onDoubleClick={onStartEdit}>

      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", colorDot[p.color] || colorDot.slate)} />
      <span className="text-sm font-medium text-ink-900 dark:text-ink-100 flex-1 min-w-0 break-words whitespace-normal">{p.name}</span>

      <ReorderButtons name={p.name} onUp={onMoveUp} onDown={onMoveDown} first={idx === 0} last={idx === total - 1} />
      <ClearButton label={`Delete priority ${p.name}`} onClick={() => onDelete(p.id)} className="h-7 w-7" />
    </div>);

}
