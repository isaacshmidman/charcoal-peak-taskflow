// @ts-nocheck
import { useState, useMemo, useEffect } from "react";
import { apiClient } from "@/api/apiClient";
import { useQuery } from "@tanstack/react-query";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { useDeleteWithUndo } from "@/hooks/useDeleteWithUndo";
import { Button } from "@/components/ui/button";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { AnimatePresence } from "framer-motion";
import { addDays, isToday, isBefore, startOfDay } from "date-fns";
import TaskCard from "@/components/tasks/TaskCard";
import TaskForm from "@/components/tasks/TaskForm";
import SubtaskForm from "@/components/tasks/SubtaskForm";
import MultiSortPanel from "@/components/tasks/MultiSortPanel";
import RecurringDeleteDialog from "@/components/tasks/RecurringDeleteDialog";

export default function Today() {
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [addSubtaskParent, setAddSubtaskParent] = useState(null);
  const [editingSubtask, setEditingSubtask] = useState(null);
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [recurringDeleteTask, setRecurringDeleteTask] = useState(null);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [sorts, setSorts] = useState(() => {
    try {
      const saved = localStorage.getItem("sorts_today");
      const parsed = saved ? JSON.parse(saved).filter(Boolean) : null;
      return parsed?.length ? parsed : ["priority_asc"];
    } catch {
      return ["priority_asc"];
    }
  });

  const handleSortsChange = (newSorts) => {
    setSorts(newSorts);
    localStorage.setItem("sorts_today", JSON.stringify(newSorts));
  };

  const { createTask, updateTask, deleteTask, completeRecurringTask, skipRecurringTask } = useOfflineMutation();
  const deleteWithUndo = useDeleteWithUndo(deleteTask, createTask);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiClient.entities.Task.list("-created_date", 500),
  });

  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => apiClient.entities.Priority.list("order", 50),
  });

  const priorityOrderMap = useMemo(() => {
    const map = {};
    priorities.forEach(p => { map[p.id] = p.order; });
    return map;
  }, [priorities]);

  const handleToggleDone = (task) => {
    const isDone = task.status === "done";
    if (!isDone && task.task_type === "recurring") {
      completeRecurringTask(task);
      return;
    }
    updateTask(task.id, { status: isDone ? "todo" : "done", completed_at: isDone ? "" : new Date().toISOString() });
  };

  const handleEdit = (task) => { setEditingTask(task); setAddSubtaskParent(null); setShowForm(true); };
  const handleDelete = (task) => {
    if (task.task_type === "recurring" && !task.parent_id) {
      setRecurringDeleteTask(task);
    } else {
      deleteWithUndo(task, { isSubtask: !!task.parent_id });
    }
  };
  const handleAddSubtask = (parent) => { setAddSubtaskParent(parent); setEditingSubtask(null); setShowSubtaskForm(true); };
  const handleUpdate = (task, changes) => updateTask(task.id, changes);
  const handleEditSubtask = (sub) => { setEditingSubtask(sub); setShowSubtaskForm(true); };
  const handleReorderSubtasks = (reordered) => {
    reordered.forEach((sub, i) => updateTask(sub.id, { order: i }));
  };

  const subtaskMap = useMemo(() => {
    const map = {};
    tasks.filter(t => t.parent_id).forEach(t => {
      if (!map[t.parent_id]) map[t.parent_id] = [];
      map[t.parent_id].push(t);
    });
    Object.values(map).forEach(arr => arr.sort((a, b) => (a.order ?? 999) - (b.order ?? 999)));
    return map;
  }, [tasks]);

  const [todayStart, setTodayStart] = useState(() => startOfDay(new Date()));

  useEffect(() => {
    const nextMidnight = startOfDay(addDays(new Date(), 1));
    const timeout = setTimeout(() => {
      setTodayStart(startOfDay(new Date()));
    }, Math.max(1000, nextMidnight.getTime() - Date.now() + 1000));

    return () => clearTimeout(timeout);
  }, [todayStart]);

  const compareFn = (a, b, sortValue) => {
    const pa = priorityOrderMap[a.priority_id] ?? 99;
    const pb = priorityOrderMap[b.priority_id] ?? 99;
    const da = a.due_date ? new Date(a.due_date + "T00:00:00") : null;
    const db = b.due_date ? new Date(b.due_date + "T00:00:00") : null;
    const ta = a.tags?.[0] || "";
    const tb = b.tags?.[0] || "";
    const ra = a.task_type === "recurring" ? a.recurrence || "" : "";
    const rb = b.task_type === "recurring" ? b.recurrence || "" : "";

    switch (sortValue) {
      case "priority_asc":
        return pa - pb;
      case "priority_desc":
        return pb - pa;
      case "date_asc":
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da - db;
      case "date_desc":
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return db - da;
      case "tag_az":
        if (!ta && tb) return 1;
        if (ta && !tb) return -1;
        return ta.localeCompare(tb);
      case "recurrence":
        if (!ra && rb) return 1;
        if (ra && !rb) return -1;
        return ra.localeCompare(rb);
      default:
        return 0;
    }
  };

  const todayAndPast = useMemo(() => {
    const base = tasks
      .filter(t => !t.parent_id && t.status !== "done")
      .filter(t => {
        if (!t.due_date) return false;
        const d = startOfDay(new Date(t.due_date + "T00:00:00"));
        return isToday(d) || isBefore(d, todayStart);
      })
      .filter(t => !search || t.title?.toLowerCase().includes(search.toLowerCase()) || t.tags?.some(tag => tag.toLowerCase().includes(search.toLowerCase())));

    return base.sort((a, b) => {
      for (const sortValue of sorts) {
        const result = compareFn(a, b, sortValue);
        if (result !== 0) return result;
      }
      return 0;
    });
  }, [tasks, search, priorityOrderMap, todayStart, sorts]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Today</h1>
          <p className="text-xs text-slate-400 mt-0.5">{todayAndPast.length} task{todayAndPast.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          {showSearch && (
            <Input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-40"
              autoFocus
              onBlur={(e) => { if (!search && !e.relatedTarget?.dataset.searchToggle) setShowSearch(false); }}
            />
          )}
          <Button data-search-toggle="true" variant="ghost" size="icon" className="h-9 w-9 text-slate-400 hover:text-slate-700" onClick={() => { setShowSearch(v => !v); if (showSearch) setSearch(""); }}>
            <Search className="w-4 h-4" />
          </Button>
          <MultiSortPanel sorts={sorts} onSortsChange={handleSortsChange} />
          <Button onClick={() => { setEditingTask(null); setAddSubtaskParent(null); setShowForm(true); }} className="bg-slate-900 hover:bg-slate-800 h-9 gap-1.5">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Task</span>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="bg-white rounded-xl border border-slate-100 h-12 animate-pulse" />)}
        </div>
      ) : todayAndPast.length === 0 ? (
        <div className="py-14 text-center">
          <p className="text-xs text-slate-400">Nothing due today — enjoy the breathing room! 🌿</p>
          <p className="text-xs text-slate-400 mt-1">Tap "New Task" to add something.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {todayAndPast.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                priorities={priorities}
                subtasks={subtaskMap[task.id] || []}
                onToggleDone={handleToggleDone}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onAddSubtask={handleAddSubtask}
                onUpdate={handleUpdate}
                onEditSubtask={handleEditSubtask}
                onReorderSubtasks={handleReorderSubtasks}
                hideMenu
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <SubtaskForm
        open={showSubtaskForm}
        onOpenChange={(o) => { setShowSubtaskForm(o); if (!o) { setEditingSubtask(null); setAddSubtaskParent(null); } }}
        task={editingSubtask}
        parentId={addSubtaskParent?.id}
        onSubmit={(data) => {
          if (editingSubtask) {
            updateTask(editingSubtask.id, { ...editingSubtask, ...data });
          } else if (addSubtaskParent) {
            createTask({ ...data, status: "todo", task_type: "one_time", parent_id: addSubtaskParent.id });
          }
          setEditingSubtask(null); setAddSubtaskParent(null);
        }}
        onDelete={(sub) => { deleteWithUndo(sub, { isSubtask: true }); setEditingSubtask(null); }}
      />

      <RecurringDeleteDialog
        open={!!recurringDeleteTask}
        onOpenChange={(o) => { if (!o) setRecurringDeleteTask(null); }}
        task={recurringDeleteTask}
        onDeleteThis={() => { skipRecurringTask(recurringDeleteTask); setRecurringDeleteTask(null); }}
        onDeleteAll={() => { deleteWithUndo(recurringDeleteTask, {}); setRecurringDeleteTask(null); }}
      />

      <TaskForm
        open={showForm}
        onOpenChange={(o) => { setShowForm(o); if (!o) setEditingTask(null); }}
        task={editingTask}
        existingSubtasks={editingTask ? (subtaskMap[editingTask.id] || []) : []}
        onToggleSubtask={handleToggleDone}
        onDeleteSubtask={(sub) => deleteWithUndo(sub, { isSubtask: true })}
        onEditSubtask={(sub) => { setShowForm(false); setEditingSubtask(sub); setShowSubtaskForm(true); }}
        onDelete={handleDelete}
        onSubmit={async (data, subtaskTitles = []) => {
          if (editingTask) {
            await updateTask(editingTask.id, data);
            for (let i = 0; i < subtaskTitles.length; i++) {
              await createTask({ title: subtaskTitles[i], status: "todo", task_type: "one_time", parent_id: editingTask.id, order: i });
            }
          } else {
            const created = await createTask(data);
            for (let i = 0; i < subtaskTitles.length; i++) {
              await createTask({ title: subtaskTitles[i], status: "todo", task_type: "one_time", parent_id: created.id, order: i });
            }
          }
          setEditingTask(null);
        }}
      />
    </div>
  );
}
