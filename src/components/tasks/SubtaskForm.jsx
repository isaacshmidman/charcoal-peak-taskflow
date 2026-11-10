// @ts-nocheck
/**
 * @file The subtask form: the task form's little sibling. Same dialog,
 * same title, same Date and Time rows (./TaskForm/parts.jsx and
 * TimeFields) — it just has fewer rows, because a subtask has no
 * priority, tags, repeat, reminder or files of its own.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAutosave } from "@/hooks/useAutosave";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import TitleTokenInput from "@/components/tasks/QuickAdd/TitleTokenInput";
import { Trash2 } from "lucide-react";
import { format } from "date-fns/format";
import { EditorLoadBoundary, EditorPlaceholder } from "@/components/tasks/TaskForm/TitleAndDescription";
import TimeFields from "@/components/tasks/TaskForm/TimeFields";
import { FormDialog, formTitleClass } from "@/components/tasks/TaskForm/parts";

// Same lazy rich editor the task description and notes use, so every
// multi-line box in the app behaves identically — markdown shortcuts as
// you type, markdown on paste, the same toolbar.
const RichDescriptionEditor = lazy(() => import("@/components/tasks/RichDescriptionEditor"));

/**
 * @typedef {import("@/types/tasks").TaskCreateInput} TaskCreateInput
 * @typedef {import("@/types/tasks").TaskRecord} TaskRecord
 */

/**
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   task?: TaskRecord | null,
 *   parentId?: string,
 *   onSubmit: (data: TaskCreateInput) => void,
 *   onDelete?: (task: TaskRecord) => void,
 * }} props
 */
export default function SubtaskForm({ open, onOpenChange, task, parentId, onSubmit, onDelete }) {
  /** @type {[TaskCreateInput, import("react").Dispatch<import("react").SetStateAction<TaskCreateInput>>]} */
  const [form, setForm] = useState({ title: "", description: "", description_json: "", due_date: "", task_time: "" });
  // Frozen at open — keeps the button label from flipping during close.
  const [isEditMode, setIsEditMode] = useState(!!task);
  const idRef = useRef(task?.id || null);

  useEffect(() => {
    if (task) {
      setForm({
        title: task.title || "",
        description: task.description || "",
        description_json: task.description_json || "",
        due_date: task.due_date || "",
        task_time: task.task_time || "",
      });
    } else {
      const todayStr = format(new Date(), "yyyy-MM-dd");
      setForm({ title: "", description: "", description_json: "", due_date: todayStr, task_time: "" });
    }
  }, [task, open]);

  const isValid = !!form.title.trim();
  const payload = useMemo(() => ({ ...form, ...(parentId ? { parent_id: parentId } : {}) }), [form, parentId]);

  // Upsert: create on first valid write (parent adds parent_id), then update.
  const saveSubtask = useCallback(async (data) => {
    const res = await onSubmit(data, idRef.current);
    if (res?.id) idRef.current = res.id;
    return res;
  }, [onSubmit]);

  // Autosave is for EDITS only — creating writes nothing until the button,
  // so Cancel can promise no subtask was created. Mirrors TaskForm.
  const { flush, reset } = useAutosave({ payload, valid: isValid && isEditMode, onSave: saveSubtask });

  const initedRef = useRef(false);
  useEffect(() => {
    if (!open) { initedRef.current = false; return; }
    if (initedRef.current) return;
    initedRef.current = true;
    idRef.current = task?.id || null;
    setIsEditMode(!!task);
    const initial = task
      ? { title: task.title || "", description: task.description || "", description_json: task.description_json || "", due_date: task.due_date || "", task_time: task.task_time || "" }
      : { title: "", description: "", description_json: "", due_date: format(new Date(), "yyyy-MM-dd"), task_time: "" };
    reset({ ...initial, ...(parentId ? { parent_id: parentId } : {}) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  const commitAndClose = async () => {
    if (isEditMode) {
      if (isValid) await flush();
    } else {
      if (!isValid) return;
      await onSubmit(payload, null);
    }
    onOpenChange(false);
  };

  return (
    <FormDialog
      open={open}
      // Escape / X / outside-click discard while creating (nothing was
      // written) and commit while editing (autosave already wrote).
      onOpenChange={(o) => {
        if (o) { onOpenChange(true); return; }
        if (isEditMode) commitAndClose(); else onOpenChange(false);
      }}
      title={isEditMode ? "Edit Subtask" : "New Subtask"}
      testid="subtask-form-dialog"
      focusTitle={!task}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && isValid) {
          e.preventDefault();
          commitAndClose();
        }
      }}
      footerStart={
        task && onDelete ? (
          <Button
            aria-label="Delete subtask"
            type="button"
            variant="ghost"
            size="icon"
            className="-ml-2 text-ink-400 hover:bg-red-50 hover:text-red-600 dark:text-ink-500 dark:hover:bg-night-danger dark:hover:text-red-300"
            onClick={() => { onDelete(task); onOpenChange(false); }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null
      }
      footerEnd={
        // Cancel in both modes, matching TaskForm. Creating, nothing has
        // been written yet so it discards; editing, autosave has already
        // persisted the fields, so it just closes.
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="subtask-form-cancel">
            Cancel
          </Button>
          <Button type="button" disabled={!isValid} onClick={commitAndClose} data-testid="subtask-form-submit">
            {isEditMode ? "Save Changes" : "Create Subtask"}
          </Button>
        </>
      }
    >
      {/* Plain title — subtasks have no tags or priority, and titles are
          never read for dates or times. TitleTokenInput is kept for its
          Enter-to-finish behaviour. */}
      <TitleTokenInput
        form={form}
        setForm={setForm}
        grammar={{ tags: false, priority: false }}
        placeholder="What needs to be done?"
        testid="subtask-form-title"
        inputClassName={formTitleClass}
        // Enter in the title finishes the subtask (already autosaved).
        onEnter={() => { if (isValid) commitAndClose(); }}
      />

      <div className="mt-2">
        <EditorLoadBoundary
          fallback={
            <Textarea
              placeholder="Add details (optional)"
              defaultValue={form.description || ""}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value, description_json: "" }))}
              className="h-20 resize-none"
            />
          }
        >
          <Suspense fallback={<EditorPlaceholder />}>
            <RichDescriptionEditor
              key={task?.id || "new-subtask"}
              valueJson={task?.description_json}
              plainFallback={task?.description}
              onChange={({ json, text }) => setForm((f) => ({ ...f, description_json: json, description: text }))}
            />
          </Suspense>
        </EditorLoadBoundary>
      </div>

      <div className="mt-5 space-y-2.5">
        {/* A subtask may go without a date, and has a start time only. */}
        <TimeFields form={form} setForm={setForm} withEnd={false} dateRequired={false} testidPrefix="subtask-form" />
      </div>
    </FormDialog>
  );
}
