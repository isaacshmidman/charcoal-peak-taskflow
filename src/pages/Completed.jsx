// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Search, Trash2, CheckSquare } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { restoreDeletionSnapshots, useDeleteWithUndo } from "@/hooks/useDeleteWithUndo";
import { useDeletedTasks } from "@/hooks/useDeletedTasks";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { buildCompletedItems, buildCompletedTaskItem, sortCompletedItems } from "@/lib/completedItems";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { showDeleteToast } from "@/components/tasks/DeleteToast";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import TaskCard from "@/components/tasks/TaskCard";
import TaskForm from "@/components/tasks/TaskForm";
import MultiSortPanel from "@/components/tasks/MultiSortPanel";

const colorBg = {
  red: "bg-red-50 border-red-100",
  orange: "bg-orange-50 border-orange-100",
  yellow: "bg-yellow-50 border-yellow-100",
  green: "bg-green-50 border-green-100",
  blue: "bg-blue-50 border-blue-100",
  violet: "bg-violet-50 border-violet-100",
  pink: "bg-pink-50 border-pink-100",
  teal: "bg-teal-50 border-teal-100",
  cyan: "bg-cyan-50 border-cyan-100",
  rose: "bg-rose-50 border-rose-100",
  slate: "bg-slate-50 border-slate-100",
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildRecurrenceShortLabel(record) {
  if (record.task_type !== "recurring" || !record.recurrence || record.recurrence === "none") return null;
  if (record.recurrence === "custom_days" && record.recurrence_days?.length) {
    return record.recurrence_days.map((day) => DAY_LABELS[day]).join(", ");
  }

  const labels = {
    daily: "Daily",
    weekdays: "Weekdays",
    weekly: "Weekly",
    biweekly: "Biweekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    yearly: "Yearly",
  };

  return labels[record.recurrence] || "Repeat";
}

export default function Completed() {
  const [editingTask, setEditingTask] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
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
  const { permanentlyDelete, permanentlyDeleteMany, restoreDeletedRecord } = useDeletedTasks();
  const deleteWithUndo = useDeleteWithUndo(deleteTask, createTask);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiClient.entities.Task.list("-completed_at", 500),
  });

  const { data: deletedTasks = [] } = useQuery({
    queryKey: ["deletedTasks"],
    queryFn: () => apiClient.entities.DeletedTask.list("-deleted_at", 500),
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
    const liveItems = buildCompletedItems({ tasks, deletedTasks, search, sorts, priorityOrderMap });
    const liveIds = new Set(liveItems.map((item) => item.id));
    const visibleUndoingItems = undoingItems.filter((item) => !liveIds.has(item.id));
    return sortCompletedItems([...liveItems, ...visibleUndoingItems], sorts, priorityOrderMap);
  }, [deletedTasks, priorityOrderMap, search, sorts, tasks, undoingItems]);

  const handleUncompleteTask = (task) => {
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
    const recurringRecordItems = completedItems.filter((item) => item.kind === "recurring-record");
    const taskDeletions = await deleteTasks(liveTaskItems.map((item) => item.task.id));
    await permanentlyDeleteMany(recurringRecordItems.map((item) => item.record.id));

    if (completedItems.length > 0) {
      showDeleteToast({
        label: `${completedItems.length} completed item${completedItems.length === 1 ? "" : "s"} deleted`,
        onUndo: async () => {
          await restoreDeletionSnapshots(taskDeletions, { createTask, permanentlyDelete });
          await Promise.all(recurringRecordItems.map((item) => restoreDeletedRecord(item.record)));
        },
      });
    }
  };

  const handleDeleteRecurringCompletion = async (record) => {
    await permanentlyDelete(record.id);
    showDeleteToast({
      label: `Completed instance "${record.title || "Untitled task"}" was deleted`,
      onUndo: () => restoreDeletedRecord(record),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Completed</h1>
          <p className="text-xs text-slate-400 mt-0.5">{completedItems.length} task{completedItems.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          {showSearch && (
            <Input
              placeholder="Search..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-40 text-sm bg-white border-slate-100"
              autoFocus
              onBlur={() => {
                if (!search) setShowSearch(false);
              }}
            />
          )}
          <Button variant="ghost" size="icon" className="h-9 w-9 text-slate-400 hover:text-slate-700" onClick={() => setShowSearch(!showSearch)}>
            <Search className="w-4 h-4" />
          </Button>
          <MultiSortPanel sorts={sorts} onSortsChange={handleSortsChange} />
          {completedItems.length > 0 && (
            <Dialog open={showDeleteAllDialog} onOpenChange={setShowDeleteAllDialog}>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-red-400 hover:text-red-600 hover:bg-red-50"
                title="Delete all completed"
                onClick={() => setShowDeleteAllDialog(true)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete all completed tasks?</DialogTitle>
                </DialogHeader>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setShowDeleteAllDialog(false)}>
                    Cancel
                  </Button>
                  <Button type="button" className="bg-red-600 hover:bg-red-700" onClick={deleteAll}>
                    Delete all
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="bg-white rounded-xl border border-slate-100 h-12 animate-pulse" />)}
        </div>
      ) : completedItems.length === 0 ? (
        <div className="text-center py-14">
          <p className="text-xs text-slate-400">No completed tasks yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {completedItems.map((item) =>
              item.kind === "task" ? (
                <TaskCard
                  key={item.id}
                  task={item.task}
                  priorities={priorities}
                  subtasks={subtaskMap[item.task.id] || []}
                  onToggleDone={handleUncompleteTask}
                  onEdit={(task) => {
                    setEditingTask(task);
                    setShowForm(true);
                  }}
                  onDelete={(task) => deleteWithUndo(task, { isSubtask: !!task.parent_id })}
                  hideMenu
                />
              ) : (
                <RecurringCompletionCard
                  key={item.id}
                  record={item.record}
                  priorities={priorities}
                  onDelete={() => handleDeleteRecurringCompletion(item.record)}
                />
              )
            )}
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
        onSubmit={async (data, subtaskTitles = []) => {
          await updateTask(editingTask.id, data);
          for (let index = 0; index < subtaskTitles.length; index += 1) {
            await createTask({ title: subtaskTitles[index], status: "todo", task_type: "one_time", parent_id: editingTask.id, order: index });
          }
          setEditingTask(null);
        }}
      />
    </div>
  );
}

function RecurringCompletionCard({ record, priorities, onDelete }) {
  const priority = priorities.find((item) => item.id === record.priority_id);
  const recurrenceLabel = buildRecurrenceShortLabel(record);
  const completedDate = record.completed_at || record.deleted_at;
  const cardBg = priority ? colorBg[priority.color] || colorBg.slate : "bg-white border-slate-100";

  return (
    <div className={cn("rounded-xl border flex overflow-hidden opacity-60", cardBg)}>
      <div className="flex-1 min-w-0 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="shrink-0 w-7 h-7 rounded-md border-2 flex items-center justify-center bg-slate-900 border-slate-900 text-white">
            <CheckSquare className="w-3.5 h-3.5 text-white" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-400 line-through truncate">{record.title}</p>

            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {completedDate && (
                <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                  Completed {format(new Date(completedDate), "MMM d, yyyy")}
                </span>
              )}
              {record.due_date && (
                <span className="text-[10px] text-slate-400">
                  Due {format(new Date(`${record.due_date}T00:00:00`), "MMM d")}
                </span>
              )}
              {recurrenceLabel && (
                <span className="text-[10px] font-medium text-slate-500 bg-white/80 border border-slate-200 px-1.5 py-0.5 rounded">
                  {recurrenceLabel}
                </span>
              )}
              {record.tags?.slice(0, 2).map((tag) => (
                <span key={tag} className="text-[10px] font-medium text-slate-400 bg-white/70 px-1.5 py-0.5 rounded border border-slate-200">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
            title="Delete completed instance"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
