// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Search, Trash2 } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { formatDeleteLabel, restoreDeletionSnapshots, useDeleteWithUndo } from "@/hooks/useDeleteWithUndo";
import { useDeletedTasks } from "@/hooks/useDeletedTasks";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { buildCompletedItems, buildCompletedTaskItem, sortCompletedItems } from "@/lib/completedItems";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AnimatedSearchInput } from "@/components/ui/animated-search-input";
import { showDeleteToast } from "@/components/tasks/DeleteToast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import TaskCard from "@/components/tasks/TaskCard";
import TaskForm from "@/components/tasks/TaskForm";
import MultiSortPanel from "@/components/tasks/MultiSortPanel";
import { excludeExternalEvents } from "@/lib/task-filters";
import { useCalendarOrderState } from "@/hooks/useCalendarOrder";
import { useShortcutEvent } from "@/hooks/useShortcutEvent";
import { SHORTCUT_EVENTS } from "@/lib/shortcuts";

export default function Completed() {
  const [editingTask, setEditingTask] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  // Keyboard shortcut: "/" opens search (no New Task on this page).
  useShortcutEvent(SHORTCUT_EVENTS.search, () => setShowSearch(true));
  const [undoingItems, setUndoingItems] = useState([]);
  const undoingTimersRef = useRef(new Map());
  const [sorts, setSorts] = useState(() => {
    try {
      const saved = localStorage.getItem("sorts_completed");
      const parsed = saved ? JSON.parse(saved).filter(Boolean) : null;
      return parsed?.length ? parsed : ["date_desc"];
    } catch {
      return ["date_desc"];
    }
  });

  const handleSortsChange = (newSorts) => {
    setSorts(newSorts);
    localStorage.setItem("sorts_completed", JSON.stringify(newSorts));
  };

  const { updateTask, deleteTask, deleteTasks, createTask } = useOfflineMutation();
  const { permanentlyDelete, permanentlyDeleteMany } = useDeletedTasks();
  const deleteWithUndo = useDeleteWithUndo(deleteTask, createTask);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiClient.entities.Task.list("-completed_at", 5000),
    // Calendar-imported events live only on /Calendar.
    select: excludeExternalEvents,
  });

  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => apiClient.entities.Priority.list("order", 50),
  });

  const priorityOrderMap = useMemo(() => {
    const map = {};
    priorities.forEach((priority) => {
      map[priority.id] = priority.order;
    });
    return map;
  }, [priorities]);

  // Calendar visibility + order from Settings.
  const { hidden: hiddenCalendars, indexByKey: calendarIndexByKey } = useCalendarOrderState();

  const subtaskMap = useMemo(() => {
    const map = {};
    tasks.filter((task) => task.parent_id).forEach((task) => {
      if (!map[task.parent_id]) map[task.parent_id] = [];
      map[task.parent_id].push(task);
    });
    Object.values(map).forEach((items) => items.sort((a, b) => (a.order ?? 999) - (b.order ?? 999)));
    return map;
  }, [tasks]);

  useEffect(() => {
    return () => {
      undoingTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      undoingTimersRef.current.clear();
    };
  }, []);

  const completedItems = useMemo(() => {
    const liveItems = buildCompletedItems({
      tasks, search, sorts, priorityOrderMap,
      hiddenCalendars, calendarIndexByKey,
    });
    const liveIds = new Set(liveItems.map((item) => item.id));
    const visibleUndoingItems = undoingItems.filter((item) => !liveIds.has(item.id));
    return sortCompletedItems(
      [...liveItems, ...visibleUndoingItems],
      sorts,
      priorityOrderMap,
      calendarIndexByKey
    );
  }, [priorityOrderMap, search, sorts, tasks, undoingItems, hiddenCalendars, calendarIndexByKey]);

  const handleToggleDone = (task) => {
    // Subtask: toggle its status independently — do not touch parent.
    if (task.parent_id) {
      const next = task.status === "done" ? "todo" : "done";
      updateTask(task.id, {
        status: next,
        completed_at: next === "done" ? new Date().toISOString() : "",
      });
      return;
    }

    const itemId = `task:${task.id}`;
    const undoingTask = {
      ...task,
      status: "todo",
      completed_at: "",
    };

    setUndoingItems((current) => {
      const next = current.filter((item) => item.id !== itemId);
      next.push(buildCompletedTaskItem(undoingTask));
      return next;
    });

    const existingTimer = undoingTimersRef.current.get(itemId);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    const timerId = window.setTimeout(() => {
      setUndoingItems((current) => current.filter((item) => item.id !== itemId));
      undoingTimersRef.current.delete(itemId);
    }, 140);

    undoingTimersRef.current.set(itemId, timerId);
    updateTask(task.id, { status: "todo", completed_at: "" });
  };

  const deleteAll = async () => {
    setShowDeleteAllDialog(false);

    const liveTaskItems = completedItems.filter((item) => item.kind === "task");
    const taskDeletions = await deleteTasks(liveTaskItems.map((item) => item.task.id));

    if (completedItems.length > 0) {
      showDeleteToast({
        label: formatDeleteLabel({ scenario: "task_bulk", count: completedItems.length }),
        onUndo: async () => {
          await restoreDeletionSnapshots(taskDeletions, { createTask, permanentlyDelete });
        },
      });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Completed</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{completedItems.length} task{completedItems.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <AnimatedSearchInput
            open={showSearch}
            value={search}
            onChange={setSearch}
            onClose={() => setShowSearch(false)}
          />
          <Button
            variant="ghost"
            size="icon"
            data-search-toggle
            className="h-9 w-9 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
            onMouseDown={(event) => { if (showSearch) event.preventDefault(); }}
            onClick={() => { if (showSearch) setSearch(""); setShowSearch((v) => !v); }}
          >
            <Search className="w-4 h-4" />
          </Button>
          <MultiSortPanel sorts={sorts} onSortsChange={handleSortsChange} page="completed" />
          {completedItems.length > 0 && (
            <Dialog open={showDeleteAllDialog} onOpenChange={setShowDeleteAllDialog}>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-[#2a1116]"
                title="Delete all completed"
                onClick={() => setShowDeleteAllDialog(true)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Delete all completed tasks?</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => { deleteAll(); setShowDeleteAllDialog(false); }}
                    className="w-full h-12 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium shadow-sm transition-colors"
                  >
                    Delete all
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteAllDialog(false)}
                    className="w-full h-12 rounded-xl bg-slate-100 dark:bg-[#161616] hover:bg-slate-200 dark:hover:bg-[#222222] text-slate-700 dark:text-slate-200 text-sm font-medium shadow-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Card key={i} className="h-12 animate-pulse" />)}
        </div>
      ) : completedItems.length === 0 ? (
        <div className="text-center py-14">
          <p className="text-xs text-slate-400 dark:text-slate-500">Nothing finished yet. Completed tasks settle here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {completedItems.map((item) => {
              return (
                <TaskCard
                  key={item.id}
                  task={item.task}
                  priorities={priorities}
                  subtasks={subtaskMap[item.task.id] || []}
                  onToggleDone={handleToggleDone}
                  onEdit={(task) => {
                    setEditingTask(task);
                    setShowForm(true);
                  }}
                  onDelete={(task) => deleteWithUndo(task, { isSubtask: !!task.parent_id })}
                  hideMenu
                />
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <TaskForm
        open={showForm}
        onOpenChange={(open) => {
          setShowForm(open);
          if (!open) setEditingTask(null);
        }}
        task={editingTask}
        existingSubtasks={editingTask ? subtaskMap[editingTask.id] || [] : []}
        onToggleSubtask={(subtask) =>
          updateTask(subtask.id, {
            status: subtask.status === "done" ? "todo" : "done",
            completed_at: subtask.status === "done" ? "" : new Date().toISOString(),
          })
        }
        onDeleteSubtask={(subtask) => deleteWithUndo(subtask, { isSubtask: true })}
        onDelete={(task) => {
          deleteWithUndo(task);
          setEditingTask(null);
        }}
        onSubmit={async (data, subtaskTitles = [], existingId = null) => {
          // Completed only edits existing tasks (autosave upserts by id;
          // editing reset lives in onOpenChange).
          const id = editingTask?.id ?? existingId;
          await updateTask(id, data);
          const existingSubCount = (subtaskMap[id] || []).length;
          for (let index = 0; index < subtaskTitles.length; index += 1) {
            await createTask({ title: subtaskTitles[index], status: "todo", task_type: "one_time", parent_id: id, order: existingSubCount + index });
          }
          return { id };
        }}
      />
    </div>
  );
}
