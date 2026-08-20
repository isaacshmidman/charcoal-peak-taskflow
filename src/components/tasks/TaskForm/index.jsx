// @ts-nocheck
/**
 * @file TaskForm dialog — owns form state, submit/delete handlers,
 * persistNewTags side-effect. Composes the sub-fields:
 *   TitleAndDescription, PriorityAndType, RecurrenceFields, TimeFields,
 *   TagsField, SubtasksField.
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Lock, Trash2 } from "lucide-react";
import { format } from "date-fns/format";
import { addMinutes } from "./TimeInput.jsx";

import TitleAndDescription from "./TitleAndDescription.jsx";
import PriorityAndType from "./PriorityAndType.jsx";
import RecurrenceFields from "./RecurrenceFields.jsx";
import TimeFields from "./TimeFields.jsx";
import TagsField from "./TagsField.jsx";
import SubtasksField from "./SubtasksField.jsx";
import AttachmentsField, { flushPendingUploads } from "../AttachmentsField.jsx";
import { useAutosave } from "@/hooks/useAutosave";

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
};

export default function TaskForm({ open, onOpenChange, task, onSubmit, onDelete, parentId, existingSubtasks = [], onToggleSubtask, onDeleteSubtask, onEditSubtask, defaultDueDate, defaultTaskTime, initialDraft }) {
  const [form, setForm] = useState(defaultTask);
  const [showEndDate, setShowEndDate] = useState(false);
  const [dayError, setDayError] = useState(false);
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
      const timeEnd = timeStart ? addMinutes(timeStart, 60) : "";
      // initialDraft: caller-provided seed values for a NEW task (e.g. the
      // Notes "Make task" bridge prefilling the title from a selection).
      setForm({ ...defaultTask, priority_id: defaultPriority?.id || "", parent_id: parentId || "", due_date: dueDate, task_time: timeStart, task_end_time: timeEnd, ...(initialDraft || {}) });
      setShowEndDate(false);
    }
    endTouchedRef.current = false;
    setDayError(false);
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
      : { ...defaultTask, priority_id: (priorities[Math.floor(priorities.length / 2)] || priorities[0] || {}).id || "", parent_id: parentId || "", due_date: defaultDueDate ?? format(new Date(), "yyyy-MM-dd"), task_time: defaultTaskTime || "", task_end_time: defaultTaskTime ? addMinutes(defaultTaskTime, 60) : "", ...(initialDraft || {}) }
    ).data);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  // Source-aware mode flags. A "source" task came from a calendar provider
  // (Google/Apple). Non-task source items render the calendar name instead of
  // priority. Non-writable sources (Holidays, Birthdays) are view-only.
  const sourceProvider = form.source_provider || task?.source_provider || null;
  const isExternal = !!sourceProvider;
  const isExternalEvent = isExternal && form.source_kind === "event";
  // source_writable defaults to true for legacy rows; only treat as read-only
  // when the field is explicitly false (0 / false / "0" all coerced).
  const writableRaw = form.source_writable;
  const isReadOnly =
    isExternal && (writableRaw === false || writableRaw === 0 || writableRaw === "0");
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
    if (isEditMode) {
      if (canSubmit) await flush();
      if (savedIdRef.current && subtaskTitles.length) {
        const res = await onSubmit(data, subtaskTitles, savedIdRef.current);
        if (res?.id) savedIdRef.current = res.id;
      }
    } else {
      if (!canSubmit) return;
      const res = await onSubmit(data, subtaskTitles, null);
      if (res?.id) savedIdRef.current = res.id;
    }
    onOpenChange(false);
    if (!task && filesToFlush.length && savedIdRef.current) {
      try {
        await flushPendingUploads(savedIdRef.current, filesToFlush);
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        queryClient.invalidateQueries({ queryKey: ["taskAttachments", savedIdRef.current] });
      } catch {
        // Errors surface inside AttachmentsField on the next open.
      }
    }
  };

  return (
    <Dialog
      open={open}
      // Escape / X / outside-click DISCARD while creating — nothing was
      // written, so backing out is just closing. While editing they commit,
      // because autosave has already persisted the edits.
      onOpenChange={(o) => {
        if (o) { onOpenChange(true); return; }
        if (isEditMode) commitAndClose(); else onOpenChange(false);
      }}
    >
      <DialogContent
        className="sm:max-w-md max-h-[90vh] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
        data-testid="task-form-dialog"
      >
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {isReadOnly
              ? "View Event"
              : isExternalEvent
                ? "Edit Event"
                : task
                  ? "Edit Task"
                  : parentId
                    ? "New Subtask"
                    : "New Task"}
          </DialogTitle>
        </DialogHeader>
        {isReadOnly && (
          <div className="flex items-start gap-2 rounded-md bg-slate-50 dark:bg-[#161616] border border-slate-100 dark:border-[#303030] p-2 text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400 dark:text-slate-500" />
            <p>
              This event comes from a read-only calendar
              {form.source_calendar_name ? <> (<span className="font-medium">{form.source_calendar_name}</span>)</> : null}
              {" "}so it can't be edited or deleted from Zephyrly.
            </p>
          </div>
        )}
        <form
          onSubmit={(e) => e.preventDefault()}
          // Mod+Enter closes (the task is already autosaved) from anywhere
          // in the form — including inside the rich-text description.
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !isReadOnly && canSubmit) {
              e.preventDefault();
              commitAndClose();
            }
          }}
          className="space-y-4"
        >
        {/* `display: contents` on the fieldset hides its box, but Tailwind's
            `space-y-*` rule on the form (`> * + * { margin-top: ... }`) only
            targets direct DOM children — the fieldset is the form's only
            direct child, so without re-applying spacing here the inputs
            inside collapse together (no gap between title and description).
            Re-applying `space-y-4` on the fieldset restores the cadence. */}
        <fieldset disabled={isReadOnly} className="contents [&>*+*]:mt-4">
          <TitleAndDescription
            form={form}
            setForm={setForm}
            task={task}
            priorities={priorities}
            savedTags={savedTags}
            onTitleEnter={() => { if (!isReadOnly && canSubmit) commitAndClose(); }}
          />

          <PriorityAndType
            form={form}
            setForm={setForm}
            priorities={priorities}
            isExternal={isExternal}
            isExternalEvent={isExternalEvent}
            sourceCalendarName={sourceCalendarName}
            sourceColorHex={sourceColorHex}
            sourceProvider={sourceProvider}
          />

          <RecurrenceFields
            form={form}
            setForm={setForm}
            showEndDate={showEndDate}
            setShowEndDate={setShowEndDate}
            dayError={dayError}
            setDayError={setDayError}
          />

          <TimeFields form={form} setForm={setForm} endTouchedRef={endTouchedRef} />

          <TagsField form={form} setForm={setForm} savedTags={savedTags} />

          {!parentId && (
            <SubtasksField
              form={form}
              setForm={setForm}
              task={task}
              existingSubtasks={existingSubtasks}
              onToggleSubtask={onToggleSubtask}
              onDeleteSubtask={onDeleteSubtask}
              onEditSubtask={onEditSubtask}
            />
          )}

          {/* Attachments — for new tasks the chips queue locally and
              upload after handleSubmit creates the task; for edits they
              upload immediately to the live task id. */}
          {!parentId && (
            <AttachmentsField
              taskId={task?.id || null}
              pendingFiles={pendingFiles}
              setPendingFiles={setPendingFiles}
              readOnly={isReadOnly}
            />
          )}

        </fieldset>
          <div className="flex items-center justify-between pt-2">
            <div>
              {task && onDelete && !isReadOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-[#2a1116]"
                  data-testid="task-form-delete"
                  onClick={() => { onDelete(task); onOpenChange(false); }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Editing autosaves, so its button just flushes + closes.
                  Creating writes nothing until pressed, which is why create
                  mode — and only create mode — offers a real Cancel. */}
              {isReadOnly ? (
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
              ) : (
                <>
                {!isEditMode && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                    data-testid="task-form-cancel"
                  >
                    Cancel
                  </Button>
                )}
                <Button
                  type="button"
                  disabled={!canSubmit}
                  onClick={commitAndClose}
                  className="bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                  data-testid="task-form-submit"
                >
                  {isEditMode ? "Save Changes" : "Create Task"}
                </Button>
                </>
              )}
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
