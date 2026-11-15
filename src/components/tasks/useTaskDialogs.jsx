// @ts-nocheck
/**
 * @file The task form and everything that hangs off it (the subtask
 * form, "this one or all of them?" for a repeating task), for a page
 * that shows tasks without being a task list: Home.
 *
 * The list pages each carry this wiring themselves, alongside their
 * sorting and searching. A page that only needs "open this task", "new
 * task", "tick it" takes it from here:
 *
 *   const tasksUi = useTaskDialogs(tasks);
 *   <button onClick={() => tasksUi.edit(task)} />
 *   {tasksUi.dialogs}
 */
import { useMemo, useState } from "react";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { formatDeleteLabel, useDeleteWithUndo } from "@/hooks/useDeleteWithUndo";
import { showDeleteToast } from "@/components/tasks/DeleteToast";
import TaskForm from "@/components/tasks/TaskForm";
import SubtaskForm from "@/components/tasks/SubtaskForm";
import RecurringDeleteDialog from "@/components/tasks/RecurringDeleteDialog";

/**
 * @param {Record<string, any>[]} tasks  every task and subtask on the page's query
 */
export function useTaskDialogs(tasks) {
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editingSubtask, setEditingSubtask] = useState(null);
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [recurringDeleteTask, setRecurringDeleteTask] = useState(null);

  const { createTask, updateTask, deleteTask, completeRecurringTask, skipRecurringTask } = useOfflineMutation();
  const deleteWithUndo = useDeleteWithUndo(deleteTask, createTask);

  const subtaskMap = useMemo(() => {
    const map = {};
    tasks.filter((task) => task.parent_id).forEach((task) => {
      (map[task.parent_id] ||= []).push(task);
    });
    Object.values(map).forEach((list) => list.sort((a, b) => (a.order ?? 999) - (b.order ?? 999)));
    return map;
  }, [tasks]);

  /** Open the form on a new task; `seed` sets fields it should start with. */
  const openNew = (seed = null) => { setEditingTask(null); setDraft(seed); setShowForm(true); };
  const edit = (task) => { setEditingTask(task); setDraft(null); setShowForm(true); };

  const toggleDone = (task) => {
    const isDone = task.status === "done";
    if (!isDone && task.task_type === "recurring") {
      completeRecurringTask(task);
      return;
    }
    updateTask(task.id, { status: isDone ? "todo" : "done", completed_at: isDone ? "" : new Date().toISOString() });
  };

  const update = (task, changes) => updateTask(task.id, changes);

  const remove = (task) => {
    if (task.task_type === "recurring" && !task.parent_id) setRecurringDeleteTask(task);
    else deleteWithUndo(task, { isSubtask: !!task.parent_id });
  };

  const dialogs = (
    <>
      <SubtaskForm
        open={showSubtaskForm}
        onOpenChange={(open) => { setShowSubtaskForm(open); if (!open) setEditingSubtask(null); }}
        task={editingSubtask}
        onSubmit={async (data, existingId = null) => {
          const id = editingSubtask?.id ?? existingId;
          if (!id) return undefined;
          await updateTask(id, { ...(editingSubtask || {}), ...data });
          return { id };
        }}
        onDelete={(sub) => { deleteWithUndo(sub, { isSubtask: true }); setEditingSubtask(null); }}
      />

      <RecurringDeleteDialog
        open={!!recurringDeleteTask}
        onOpenChange={(open) => { if (!open) setRecurringDeleteTask(null); }}
        task={recurringDeleteTask}
        onDeleteThis={() => {
          const target = recurringDeleteTask;
          skipRecurringTask(target);
          showDeleteToast({
            label: formatDeleteLabel({ scenario: "recurring_instance", title: target?.title || "" }),
            hideUndo: true,
          });
          setRecurringDeleteTask(null);
        }}
        onDeleteAll={() => { deleteWithUndo(recurringDeleteTask, {}); setRecurringDeleteTask(null); }}
      />

      <TaskForm
        open={showForm}
        onOpenChange={(open) => { setShowForm(open); if (!open) { setEditingTask(null); setDraft(null); } }}
        task={editingTask}
        initialDraft={draft}
        existingSubtasks={editingTask ? subtaskMap[editingTask.id] || [] : []}
        onToggleSubtask={toggleDone}
        onDeleteSubtask={(sub) => deleteWithUndo(sub, { isSubtask: true })}
        onEditSubtask={(sub) => { setShowForm(false); setEditingSubtask(sub); setShowSubtaskForm(true); }}
        onDelete={remove}
        onSubmit={async (data, subtaskTitles = [], existingId = null) => {
          // Upsert, for the form's autosave: `existingId` is a new task
          // the form already created and is still editing.
          const id = editingTask?.id ?? existingId;
          if (id) {
            await updateTask(id, data);
            const already = (subtaskMap[id] || []).length;
            for (let i = 0; i < subtaskTitles.length; i++) {
              await createTask({ title: subtaskTitles[i], status: "todo", task_type: "one_time", parent_id: id, order: already + i });
            }
            return { id };
          }
          const created = await createTask(data);
          for (let i = 0; i < subtaskTitles.length; i++) {
            await createTask({ title: subtaskTitles[i], status: "todo", task_type: "one_time", parent_id: created.id, order: i });
          }
          // Returned so the form can attach its waiting files to the new task.
          return created;
        }}
      />
    </>
  );

  return { openNew, edit, toggleDone, update, remove, createTask, dialogs };
}
