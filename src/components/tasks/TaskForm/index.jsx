// @ts-nocheck
/**
 * @file TaskForm dialog — owns form state, submit/delete handlers,
 * persistNewTags side-effect. Composes the sub-fields:
 *   TitleAndDescription, TimeFields, RepeatFields, ReminderField,
 *   PriorityField, TagsField, SubtasksField, AttachmentsField.
 *
 * The layout comes from ./parts.jsx: a big title, the description, then
 * one row per property in the order people fill them in — when, how
 * often, remind me, how important, then the extras.
 *
 * Form state (the ~14-key `form` object) stays in this file. Each
 * sub-field receives `form` + `setForm` plus whatever extras it needs.
 * No reducer or context — preserving the original runtime shape per
 * Phase 4 plan §4.1.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/api/apiClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isOnline } from "@/lib/offlineCache";
import { SavedTagOffline } from "@/lib/offlineEntityRegistry";
import { isRecoverableConnectionError } from "@/lib/network";
import { Button } from "@/components/ui/button";
import { Lock, Trash2 } from "lucide-react";
import { format } from "date-fns/format";
import { defaultEndTime } from "./TimeInput.jsx";

import TitleAndDescription from "./TitleAndDescription.jsx";
import PriorityField from "./PriorityField.jsx";
import RepeatFields from "./RepeatFields.jsx";
import { Field, FormDialog } from "./parts.jsx";
import TimeFields from "./TimeFields.jsx";
import TagsField from "./TagsField.jsx";
import SubtasksField from "./SubtasksField.jsx";
import AttachmentsField, { attachToNewTask } from "../AttachmentsField.jsx";
import { showDeleteToast } from "../DeleteToast.jsx";
import { useAutosave } from "@/hooks/useAutosave";
import { isReadOnlyTask } from "@/lib/task-filters";
import ReminderField from "./ReminderField.jsx";

const defaultTask = {
  title: "",
  description: "",
  description_json: "",
  priority_id: "",
  status: "todo",
  task_type: "one_time",
  recurrence: "none",
  recurrence_days: [],
  recurrence_end_date: "",
  due_date: "",
  task_time: "",
  task_end_time: "",
  tags: [],
  subtask_titles: [],
  reminder: "",
};

export default function TaskForm({ open, onOpenChange, task, onSubmit, onDelete, parentId, existingSubtasks = [], onToggleSubtask, onDeleteSubtask, onEditSubtask, defaultDueDate, defaultTaskTime, initialDraft }) {
  const [form, setForm] = useState(defaultTask);
  const [showEndDate, setShowEndDate] = useState(false);
  // Frozen at open: true when editing an existing task. Drives the button
  // label so it never flips to "Create Task" during the close animation
  // (when the parent nulls `task`, the dialog is still fading out).
  const [isEditMode, setIsEditMode] = useState(!!task);
  // Pending file attachments — only relevant when creating a NEW task
  // (we don't have a task id yet, so the upload has to wait for the
  // create to land). For edits, AttachmentsField uploads immediately.
  const [pendingFiles, setPendingFiles] = useState([]);
  const endTouchedRef = useRef(false);
  const queryClient = useQueryClient();

  // Priorities — sorted by order so dropdown always reflects latest order from Settings
  const { data: rawPriorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => apiClient.entities.Priority.list("order", 50),
  });
  const priorities = [...rawPriorities].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

  const { data: savedTags = [] } = useQuery({
    queryKey: ["savedTags"],
    queryFn: () => apiClient.entities.SavedTag.list("name", 100),
  });

  // Auto-save new tags to SavedTag (both online and offline)
  const persistNewTags = (tags) => {
    const existingNames = new Set((queryClient.getQueryData(["savedTags"]) || []).map(t => t.name));
    const newTags = tags.filter(t => !existingNames.has(t));
    if (!newTags.length) return;
    const now = new Date().toISOString();
    const optimistic = newTags.map(name => ({ id: `offline_tag_${Date.now()}_${name}`, name, created_date: now }));
    queryClient.setQueryData(["savedTags"], (old = []) => [...old, ...optimistic]);
    if (isOnline()) {
      newTags.forEach((name) => {
        apiClient.entities.SavedTag.create({ name }).catch((error) => {
          if (isRecoverableConnectionError(error)) {
            SavedTagOffline.queueMutation({ type: "create", name });
          }
        });
      });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["savedTags"] }), 600);
    } else {
      newTags.forEach(name => SavedTagOffline.queueMutation({ type: "create", name }));
    }
  };

  // Stable serialized key for priorities so we don't re-run on every render
  const prioritiesKey = priorities.map(p => p.id + p.order).join(",");

  useEffect(() => {
    if (task) {
      setForm({ ...defaultTask, ...task, tags: task.tags || [], recurrence_days: task.recurrence_days || [], recurrence_end_date: task.recurrence_end_date || "", task_time: task.task_time || "", task_end_time: task.task_end_time || "", subtask_titles: [] });
      setShowEndDate(!!task.recurrence_end_date);
    } else {
      // Default to the middle priority by order
      const mid = Math.floor(priorities.length / 2);
      const defaultPriority = priorities[mid] || priorities[0] || null;
      const dueDate = defaultDueDate ?? format(new Date(), "yyyy-MM-dd");
      const timeStart = defaultTaskTime || "";
      const timeEnd = timeStart ? defaultEndTime(timeStart) : "";
      // initialDraft: caller-provided seed values for a NEW task (e.g. the
      // Notes "Make task" bridge prefilling the title from a selection).
      setForm({ ...defaultTask, priority_id: defaultPriority?.id || "", parent_id: parentId || "", due_date: dueDate, task_time: timeStart, task_end_time: timeEnd, ...(initialDraft || {}) });
      setShowEndDate(false);
    }
    endTouchedRef.current = false;
    setPendingFiles([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, open, prioritiesKey]);

  // Autosave session init — runs ONCE per open (NOT when priorities load,
  // which would reset savedIdRef and cause a duplicate create). Sets the
  // tracked id and re-baselines so merely opening never re-saves.
  const initedRef = useRef(false);
  useEffect(() => {
    if (!open) { initedRef.current = false; return; }
    if (initedRef.current) return;
    initedRef.current = true;
    savedIdRef.current = task?.id || null;
    setIsEditMode(!!task);
    reset(buildData(task
      ? { ...defaultTask, ...task, tags: task.tags || [], recurrence_days: task.recurrence_days || [], recurrence_end_date: task.recurrence_end_date || "", task_time: task.task_time || "", task_end_time: task.task_end_time || "", subtask_titles: [] }
      : { ...defaultTask, priority_id: (priorities[Math.floor(priorities.length / 2)] || priorities[0] || {}).id || "", parent_id: parentId || "", due_date: defaultDueDate ?? format(new Date(), "yyyy-MM-dd"), task_time: defaultTaskTime || "", task_end_time: defaultTaskTime ? defaultEndTime(defaultTaskTime) : "", ...(initialDraft || {}) }
    ).data);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  // Source-aware mode flags. A "source" task came from a calendar provider
  // (Google/Apple). Non-task source items render the calendar name instead of
  // priority. Non-writable sources (Holidays, Birthdays) are view-only.
  const sourceProvider = form.source_provider || task?.source_provider || null;
  const isExternal = !!sourceProvider;
  const isExternalEvent = isExternal && form.source_kind === "event";
  // One rule for read-only, shared with calendar dragging (task-filters).
  const isReadOnly = isReadOnlyTask({ source_provider: sourceProvider, source_writable: form.source_writable });
  const sourceCalendarName = form.source_calendar_name || "Calendar";
  const sourceColorHex = form.source_color_hex || null;

  // A task can't be saved without a title AND a date (the unscheduled
  // tray is gone — every task is scheduled). Read-only event views never
  // submit; custom-days recurrence needs ≥1 selected day.
  const zeroCustomDays =
    form.task_type === "recurring" &&
    form.recurrence === "custom_days" &&
    (form.recurrence_days || []).length === 0;
  const canSubmit = !isReadOnly && !!form.title.trim() && !!form.due_date && !zeroCustomDays;

  // ── Autosave ──────────────────────────────────────────────────────
  // Normalize the form into the persisted payload (recurrence cleanup;
  // subtask titles ride separately — they commit on close, not per key).
  const buildData = (f) => {
    const data = { ...f };
    if (parentId && !task) data.parent_id = parentId;
    if (data.task_type !== "recurring") { data.recurrence = "none"; data.recurrence_days = []; data.recurrence_end_date = ""; }
    if (data.recurrence !== "custom_days") data.recurrence_days = [];
    const subtaskTitles = (data.subtask_titles || []).filter((t) => t.trim());
    delete data.subtask_titles;
    return { data, subtaskTitles };
  };

  // Tracks the persisted task id so autosave creates once, then updates —
  // and so the "New Task" heading/button never flip after the first save.
  const savedIdRef = useRef(task?.id || null);

  const payload = useMemo(() => buildData(form).data, [form, task, parentId]);

  const onSaveTask = useCallback(async (data) => {
    const res = await onSubmit(data, [], savedIdRef.current);
    if (res?.id) savedIdRef.current = res.id;
    if (data.tags?.length) persistNewTags(data.tags);
    return res;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSubmit]);

  // Autosave is for EDITS only. While creating, nothing is persisted until
  // the Create button runs commitAndClose — that's what makes Cancel able to
  // promise 'no task was created' rather than 'a task was created and removed'.
  const { flush, reset } = useAutosave({ payload, valid: canSubmit && isEditMode, onSave: onSaveTask });

  // Editing: autosave already wrote the fields, so this just flushes any
  // pending debounce and commits subtasks. Creating: this is the ONLY write —
  // one submit, on the button.
  const commitAndClose = async () => {
    const { data, subtaskTitles } = buildData(form);
    const filesToFlush = pendingFiles;
    if (!isEditMode && !canSubmit) return;

    // Close FIRST. Everything below is a write that doesn't need the
    // dialog open, and awaiting it here is exactly what kept the form
    // sitting there after Save Changes while the pending chips cleared
    // and each created subtask appeared behind it, one at a time.
    // Pending titles aren't cleared either — the form is gone, and the
    // reset effect empties them on the next open.
    onOpenChange(false);

    if (isEditMode) {
      if (canSubmit) await flush();
      if (savedIdRef.current && subtaskTitles.length) {
        const res = await onSubmit(data, subtaskTitles, savedIdRef.current);
        if (res?.id) savedIdRef.current = res.id;
      }
    } else {
      const res = await onSubmit(data, subtaskTitles, null);
      if (res?.id) savedIdRef.current = res.id;
    }
    if (!task && filesToFlush.length && savedIdRef.current) {
      const taskId = savedIdRef.current;
      // The form has closed, so anything that goes wrong has to be said
      // somewhere else: a file that didn't upload is either queued to
      // retry by itself or named in a message — never silently dropped.
      const { message } = await attachToNewTask(taskId, filesToFlush);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["taskAttachments", taskId] });
      queryClient.invalidateQueries({ queryKey: ["offlineAttachments", taskId] });
      if (message) showDeleteToast({ label: message, hideUndo: true, duration: 8000 });
    }
  };

  const heading = isReadOnly
    ? "View Event"
    : isExternalEvent
      ? "Edit Event"
      : task
        ? "Edit Task"
        : parentId
          ? "New Subtask"
          : "New Task";

  return (
    <FormDialog
      open={open}
      // Escape / X / outside-click DISCARD while creating — nothing was
      // written, so backing out is just closing. While editing they commit,
      // because autosave has already persisted the edits.
      onOpenChange={(o) => {
        if (o) { onOpenChange(true); return; }
        if (isEditMode) commitAndClose(); else onOpenChange(false);
      }}
      title={heading}
      testid="task-form-dialog"
      focusTitle={!task}
      // Mod+Enter closes (the task is already autosaved) from anywhere
      // in the form — including inside the rich-text description.
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !isReadOnly && canSubmit) {
          e.preventDefault();
          commitAndClose();
        }
      }}
      footerStart={
        task && onDelete && !isReadOnly ? (
          <Button
            aria-label="Delete task"
            type="button"
            variant="ghost"
            size="icon"
            className="-ml-2 text-ink-400 hover:bg-red-50 hover:text-red-600 dark:text-ink-500 dark:hover:bg-night-danger dark:hover:text-red-300"
            data-testid="task-form-delete"
            onClick={() => { onDelete(task); onOpenChange(false); }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null
      }
      footerEnd={
        // Cancel sits left of the confirm in both modes. Note it means
        // different things: creating, nothing has been written yet so it
        // truly discards; editing, autosave has already persisted the
        // fields, so it just closes without committing pending subtask
        // titles.
        isReadOnly ? (
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="task-form-cancel">
              Cancel
            </Button>
            <Button type="button" disabled={!canSubmit} onClick={commitAndClose} data-testid="task-form-submit">
              {isEditMode ? "Save Changes" : "Create Task"}
            </Button>
          </>
        )
      }
    >
      {isReadOnly && (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-ink-100 px-3 py-2 text-xs text-ink-600 dark:bg-night-raised dark:text-ink-300">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400 dark:text-ink-500" />
          <p>
            This event comes from a read-only calendar
            {form.source_calendar_name ? <> (<span className="font-medium">{form.source_calendar_name}</span>)</> : null}
            {" "}so it can't be edited or deleted from Zephyrly.
          </p>
        </div>
      )}
      {/* `display: contents` hides the fieldset's own box, so the
          children space themselves: the title and description sit close,
          then the property rows follow at an even step. */}
      <fieldset disabled={isReadOnly} className="contents">
        <TitleAndDescription
          form={form}
          setForm={setForm}
          task={task}
          priorities={priorities}
          savedTags={savedTags}
          onTitleEnter={() => { if (!isReadOnly && canSubmit) commitAndClose(); }}
          readOnly={isReadOnly}
        />

        <div className="mt-5 space-y-2.5">
          <TimeFields form={form} setForm={setForm} endTouchedRef={endTouchedRef} />

          <RepeatFields
            form={form}
            setForm={setForm}
            showEndDate={showEndDate}
            setShowEndDate={setShowEndDate}
            disabled={isExternalEvent}
          />

          {/* Subtasks never notify, so they don't get a reminder. */}
          {!parentId && form.due_date && <ReminderField form={form} setForm={setForm} />}

          <PriorityField
            form={form}
            setForm={setForm}
            priorities={priorities}
            isExternal={isExternal}
            sourceCalendarName={sourceCalendarName}
            sourceColorHex={sourceColorHex}
            sourceProvider={sourceProvider}
          />

          <Field label="Tags">
            <TagsField form={form} setForm={setForm} savedTags={savedTags} />
          </Field>

          {!parentId && (
            <Field label="Subtasks">
              <SubtasksField
                form={form}
                setForm={setForm}
                task={task}
                existingSubtasks={existingSubtasks}
                onToggleSubtask={onToggleSubtask}
                onDeleteSubtask={onDeleteSubtask}
                onEditSubtask={onEditSubtask}
              />
            </Field>
          )}

          {/* Files — for new tasks they queue locally and upload after the
              task is created; for edits they upload immediately to the
              live task id. */}
          {!parentId && (
            <Field label="Files">
              <AttachmentsField
                taskId={task?.id || null}
                pendingFiles={pendingFiles}
                setPendingFiles={setPendingFiles}
                readOnly={isReadOnly}
              />
            </Field>
          )}
        </div>
      </fieldset>
    </FormDialog>
  );
}
