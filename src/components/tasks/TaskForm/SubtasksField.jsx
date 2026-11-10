// @ts-nocheck
/**
 * @file The Subtasks row: a short checklist, then a box to add to it.
 *
 * Saved subtasks can be ticked, opened (click the title) and deleted.
 * Ones typed into a form that hasn't been saved yet are listed the same
 * way, minus the tick — they are created with the task. Only rendered
 * when this form is NOT itself a subtask form (`parentId` is falsy).
 */
import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const rowClass = "group/sub flex min-h-8 items-start gap-2.5 py-1";
const removeClass =
  "mt-0.5 shrink-0 rounded p-0.5 text-ink-300 transition-colors hover:text-red-600 focus-visible:text-red-600 dark:text-ink-600 dark:hover:text-red-400";

export default function SubtasksField({
  form,
  setForm,
  task,
  existingSubtasks,
  onToggleSubtask,
  onDeleteSubtask,
  onEditSubtask,
}) {
  const [text, setText] = useState("");
  const saved = task ? existingSubtasks : [];
  const pending = form.subtask_titles || [];

  const add = () => {
    const title = text.trim();
    if (!title) return;
    setForm((f) => ({ ...f, subtask_titles: [...(f.subtask_titles || []), title] }));
    setText("");
  };
  const removePending = (index) =>
    setForm((f) => ({ ...f, subtask_titles: (f.subtask_titles || []).filter((_, i) => i !== index) }));

  return (
    <div>
      {(saved.length > 0 || pending.length > 0) && (
        <ul className="mb-1.5" data-testid="task-form-subtasks">
          {saved.map((sub) => {
            const done = sub.status === "done";
            return (
              <li key={sub.id} className={rowClass}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={done}
                  aria-label={done ? `Mark ${sub.title} not done` : `Mark ${sub.title} done`}
                  onClick={() => onToggleSubtask?.(sub)}
                  className={cn(
                    "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                    done
                      ? "border-sun-400 bg-sun-400 text-ink-900"
                      : "border-ink-400 hover:border-ink-600 dark:border-ink-500 dark:hover:border-ink-300"
                  )}
                >
                  {done && <Check className="h-3 w-3" strokeWidth={3} />}
                </button>
                <button
                  type="button"
                  onClick={() => onEditSubtask?.(sub)}
                  title="Open subtask"
                  className={cn(
                    "min-w-0 flex-1 [overflow-wrap:anywhere] text-left text-sm leading-6 text-foreground hover:underline",
                    done && "text-ink-400 line-through dark:text-ink-500"
                  )}
                >
                  {sub.title}
                </button>
                <button
                  type="button"
                  aria-label={`Delete subtask ${sub.title}`}
                  onClick={() => onDeleteSubtask?.(sub)}
                  className={removeClass}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
          {pending.map((title, index) => (
            <li key={`${index}:${title}`} className={rowClass}>
              <span aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 rounded-[5px] border border-dashed border-ink-300 dark:border-ink-600" />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-sm leading-6 text-foreground">{title}</span>
              <button
                type="button"
                aria-label={`Remove subtask ${title}`}
                onClick={() => removePending(index)}
                className={removeClass}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="Add a subtask"
          aria-label="New subtask"
          value={text}
          enterKeyHint="done"
          onChange={(e) => setText(e.target.value)}
          // Leaving the box with something typed keeps it — otherwise
          // pressing Create straight after typing would drop it.
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent?.isComposing) return;
            // Enter here adds a subtask; it must never finish the form.
            e.preventDefault();
            e.stopPropagation();
            add();
          }}
          className="sm:text-sm"
        />
        <Button
          type="button"
          variant="outline"
          aria-label="Add subtask"
          disabled={!text.trim()}
          onClick={add}
          className="h-9 w-9 shrink-0 px-0"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
