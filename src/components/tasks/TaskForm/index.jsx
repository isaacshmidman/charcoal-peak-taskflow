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
import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/api/apiClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isOnline, queueTagMutation } from "@/lib/offlineCache";
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

export default function TaskForm({ open, onOpenChange, task, onSubmit, onDelete, parentId, existingSubtasks = [], onToggleSubtask, onDeleteSubtask, onEditSubtask, defaultDueDate, defaultTaskTime }) {
  const [form, setForm] = useState(defaultTask);
  const [showEndDate, setShowEndDate] = useState(false);
  const [dayError, setDayError] = useState(false);
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
            queueTagMutation({ type: "create", name });
          }
        });
      });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["savedTags"] }), 600);
    } else {
      newTags.forEach(name => queueTagMutation({ type: "create", name }));
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
      setForm({ ...defaultTask, priority_id: defaultPriority?.id || "", parent_id: parentId || "", due_date: dueDate, task_time: timeStart, task_end_time: timeEnd });
      setShowEndDate(false);
    }
    endTouchedRef.current = false;
    setDayError(false);
    setPendingFiles([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, open, prioritiesKey]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    if (
      form.task_type === "recurring" &&
      form.recurrence === "custom_days" &&
      (form.recurrence_days || []).length === 0
    ) {
      setDayError(true);
      return;
    }
    const data = { ...form };
    if (parentId && !task) data.parent_id = parentId;
    if (data.task_type !== "recurring") { data.recurrence = "none"; data.recurrence_days = []; data.recurrence_end_date = ""; }
    if (data.recurrence !== "custom_days") data.recurrence_days = [];
    const subtaskTitles = (data.subtask_titles || []).filter(t => t.trim());
    delete data.subtask_titles;
    // Persist any new tags to SavedTag
    if (data.tags?.length) persistNewTags(data.tags);
    // Close the modal first so the user sees instant feedback; the
    // pending-file upload happens in the background. (Existing-task
    // edits had attachments uploaded immediately by AttachmentsField,
    // so pendingFiles is always [] in that branch.)
    const filesToFlush = pendingFiles;
    const submitResult = onSubmit(data, subtaskTitles);
    onOpenChange(false);
    if (!task && filesToFlush.length) {
      try {
        const result = await submitResult;
        const createdId = result?.id || result?.task?.id || null;
        if (createdId) {
          await flushPendingUploads(createdId, filesToFlush);
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          queryClient.invalidateQueries({ queryKey: ["taskAttachments", createdId] });
        }
      } catch {
        // Errors are surfaced inside AttachmentsField on the next open.
      }
    }
  };

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          onSubmit={handleSubmit}
          // Mod+Enter saves from anywhere in the form — including inside
          // the rich-text description, where plain Enter just adds a line.
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !isReadOnly) {
              e.preventDefault();
              handleSubmit(e);
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
          <TitleAndDescription form={form} setForm={setForm} task={task} />

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
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {isReadOnly ? "Close" : "Cancel"}
              </Button>
              {!isReadOnly && (
                <Button type="submit" className="bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200" data-testid="task-form-submit">
                  {task ? "Save Changes" : "Create Task"}
                </Button>
              )}
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
