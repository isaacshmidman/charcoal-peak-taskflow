// @ts-nocheck
/**
 * @file Subtasks block — input for new pending subtasks + chip list of
 * existing-server-saved subtasks (with toggle/edit/delete) + chip list
 * of pending-new subtasks. Only rendered when this form is NOT itself a
 * subtask form (i.e. `parentId` is falsy).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckSquare, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SubtasksField({
  form,
  setForm,
  task,
  existingSubtasks,
  onToggleSubtask,
  onDeleteSubtask,
  onEditSubtask,
}) {
  const [subtaskInput, setSubtaskInput] = useState("");

  const addSubtask = () => {
    const val = subtaskInput.trim();
    if (!val) return;
    setForm({ ...form, subtask_titles: [...(form.subtask_titles || []), val] });
    setSubtaskInput("");
  };

  const removeSubtask = (idx) => {
    setForm({ ...form, subtask_titles: form.subtask_titles.filter((_, i) => i !== idx) });
  };

  return (
    <div>
      <Label className="text-xs font-semibold text-ink-900 dark:text-ink-100 mb-1.5 block">Subtasks</Label>

      <div className="flex gap-2">
        <Input
          placeholder="Add a subtask..."
          value={subtaskInput}
          onChange={(e) => setSubtaskInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubtask(); } }}
          className=""
        />
        <Button aria-label="Add subtask" type="button" size="sm" onClick={addSubtask} variant="outline" className="h-9 w-9 px-0 shrink-0">
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {/* Saved subtasks and not-yet-created ones share ONE wrap
          container — two separate flex rows is what pushed a freshly
          added chip onto its own line below the others. */}
      {((task && existingSubtasks.length > 0) || (form.subtask_titles || []).length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {task && existingSubtasks.map((sub) => (
            <div key={sub.id} className="inline-flex items-center gap-1.5 bg-secondary text-secondary-foreground rounded-full px-2.5 py-0.5 text-xs font-semibold group">
              <button aria-label={sub.status === "done" ? `Mark ${sub.title} not done` : `Mark ${sub.title} done`}
                type="button"
                onClick={() => onToggleSubtask && onToggleSubtask(sub)}
                className={cn(
                  "shrink-0 w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-all",
                  sub.status === "done" ? "bg-primary border-primary text-primary-foreground" : "border-ink-400 dark:border-ink-500 hover:border-ink-600 dark:hover:border-ink-300 bg-white/80 dark:bg-night-sunken"
                )}
              >
                {sub.status === "done" && <CheckSquare className="w-2 h-2" />}
              </button>
              <span
                className={cn("cursor-pointer hover:text-ink-600 dark:hover:text-ink-300 break-words whitespace-normal max-w-full", sub.status === "done" && "line-through opacity-50")}
                onClick={() => onEditSubtask && onEditSubtask(sub)}
              >
                {sub.title}
              </span>
              <button aria-label={`Delete subtask ${sub.title}`}
                type="button"
                onPointerDown={(e) => { e.preventDefault(); onDeleteSubtask && onDeleteSubtask(sub); }}
                className="text-ink-400 dark:text-ink-500 hover:text-red-400 dark:hover:text-red-300 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {(form.subtask_titles || []).map((title, idx) => (
            <div key={idx} className="inline-flex items-center gap-1.5 bg-secondary text-secondary-foreground rounded-full px-2.5 py-0.5 text-xs font-semibold group">
              <div className="shrink-0 w-3.5 h-3.5 rounded border-2 border-ink-400" />
              <span className="break-words whitespace-normal max-w-full">{title}</span>
              <button aria-label={`Remove subtask ${title}`} type="button" onPointerDown={(e) => { e.preventDefault(); removeSubtask(idx); }} className="text-ink-400 dark:text-ink-500 hover:text-red-400 dark:hover:text-red-300 transition-colors">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
