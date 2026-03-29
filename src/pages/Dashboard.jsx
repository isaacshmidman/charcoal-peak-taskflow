// @ts-nocheck
import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { useDeleteWithUndo } from "@/hooks/useDeleteWithUndo";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { AnimatePresence } from "framer-motion";

import StatsBar from "@/components/tasks/StatsBar";
import TaskCard from "@/components/tasks/TaskCard";
import TaskForm from "@/components/tasks/TaskForm";
import FilterBar from "@/components/tasks/FilterBar";

export default function Dashboard() {
  const [searchParams] = useSearchParams();
  const pageFilter = searchParams.get("filter");

  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [filters, setFilters] = useState({
    search: "",
    priority: "all",
    taskType: "all",
    sort: "newest",
  });

  const { createTask, updateTask, deleteTask, completeRecurringTask } = useOfflineMutation();
  const deleteWithUndo = useDeleteWithUndo(deleteTask, createTask);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => base44.entities.Task.list("-created_date", 200),
  });

  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => base44.entities.Priority.list("order", 50),
  });

  const priorityOrderMap = useMemo(() => {
    const map = {};
    priorities.forEach((priority) => { map[priority.id] = priority.order; });
    return map;
  }, [priorities]);

  const subtaskMap = useMemo(() => {
    const map = {};
    tasks.filter((task) => task.parent_id).forEach((task) => {
      if (!map[task.parent_id]) map[task.parent_id] = [];
      map[task.parent_id].push(task);
    });
    Object.values(map).forEach((subtasks) => subtasks.sort((a, b) => (a.order ?? 999) - (b.order ?? 999)));
    return map;
  }, [tasks]);

  const handleSubmit = async (data, subtaskTitles = []) => {
    if (editingTask) {
      await updateTask(editingTask.id, data);
      for (let i = 0; i < subtaskTitles.length; i += 1) {
        await createTask({ title: subtaskTitles[i], status: "todo", task_type: "one_time", parent_id: editingTask.id, order: i });
      }
    } else {
      const createdTask = await createTask(data);
      for (let i = 0; i < subtaskTitles.length; i += 1) {
        await createTask({ title: subtaskTitles[i], status: "todo", task_type: "one_time", parent_id: createdTask.id, order: i });
      }
    }
    setEditingTask(null);
  };

  const handleToggleDone = (task) => {
    const isDone = task.status === "done";
    if (!isDone && task.task_type === "recurring") {
      completeRecurringTask(task);
      return;
    }
    updateTask(task.id, { status: isDone ? "todo" : "done", completed_at: isDone ? "" : new Date().toISOString() });
  };

  const handleEdit = (task) => {
    setEditingTask(task);
    setShowForm(true);
  };

  const handleDelete = (task) => {
    deleteWithUndo(task, { isSubtask: !!task.parent_id });
  };

  // Apply page-level filter from nav
  const preFiltered = useMemo(() => {
    const topLevelTasks = tasks.filter((task) => !task.parent_id);
    if (pageFilter === "active") return topLevelTasks.filter((task) => task.status !== "done");
    if (pageFilter === "recurring") return topLevelTasks.filter((task) => task.task_type === "recurring");
    if (pageFilter === "done") return topLevelTasks.filter((task) => task.status === "done");
    return topLevelTasks;
  }, [tasks, pageFilter]);

  // Apply user filters
  const filteredTasks = useMemo(() => {
    let result = [...preFiltered];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(t =>
        t.title?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.tags?.some(tag => tag.toLowerCase().includes(q))
      );
    }
    if (filters.priority !== "all") {
      result = result.filter((task) => task.priority_id === filters.priority);
    }
    if (filters.taskType !== "all") {
      result = result.filter(t => t.task_type === filters.taskType);
    }

    // Sort
    switch (filters.sort) {
      case "oldest":
        result.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        break;
      case "priority":
        result.sort((a, b) => (priorityOrderMap[a.priority_id] ?? 99) - (priorityOrderMap[b.priority_id] ?? 99));
        break;
      case "due_date":
        result.sort((a, b) => {
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return new Date(a.due_date) - new Date(b.due_date);
        });
        break;
      default:
        result.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    }

    return result;
  }, [preFiltered, filters, priorityOrderMap]);

  const pageTitle = {
    active: "Active Tasks",
    recurring: "Recurring Tasks",
    done: "Completed",
  }[pageFilter] || "All Tasks";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{pageTitle}</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {filteredTasks.length} task{filteredTasks.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button
          onClick={() => { setEditingTask(null); setShowForm(true); }}
          className="bg-slate-900 hover:bg-slate-800 h-10 gap-2"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New Task</span>
        </Button>
      </div>

      {/* Stats */}
      {!pageFilter && <StatsBar tasks={tasks} />}

      {/* Filters */}
      <FilterBar filters={filters} onFiltersChange={setFilters} priorities={priorities} />

      {/* Task list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 p-4 h-20 animate-pulse" />
          ))}
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <Plus className="w-6 h-6 text-slate-300" />
          </div>
          <p className="text-slate-500 text-sm">No tasks yet</p>
          <p className="text-slate-400 text-xs mt-1">Click "New Task" to get started</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {filteredTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                priorities={priorities}
                subtasks={subtaskMap[task.id] || []}
                onToggleDone={handleToggleDone}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onUpdate={(currentTask, changes) => updateTask(currentTask.id, changes)}
                hideMenu
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Form dialog */}
      <TaskForm
        open={showForm}
        onOpenChange={(open) => { setShowForm(open); if (!open) setEditingTask(null); }}
        task={editingTask}
        existingSubtasks={editingTask ? (subtaskMap[editingTask.id] || []) : []}
        onToggleSubtask={handleToggleDone}
        onDeleteSubtask={(subtask) => deleteWithUndo(subtask, { isSubtask: true })}
        onDelete={handleDelete}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
