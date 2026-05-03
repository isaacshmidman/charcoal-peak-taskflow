// @ts-nocheck
import { useState, useMemo, useEffect } from "react";
import { apiClient } from "@/api/apiClient";
import { useQuery } from "@tanstack/react-query";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { formatDeleteLabel, useDeleteWithUndo } from "@/hooks/useDeleteWithUndo";
import { showDeleteToast } from "@/components/tasks/DeleteToast";
import { Button } from "@/components/ui/button";
import { Plus, Search } from "lucide-react";
import { AnimatedSearchInput } from "@/components/ui/animated-search-input";
import { AnimatePresence } from "framer-motion";
import { addDays, isToday, isBefore, startOfDay } from "date-fns";
import TaskCard from "@/components/tasks/TaskCard";
import TaskForm from "@/components/tasks/TaskForm";
import SubtaskForm from "@/components/tasks/SubtaskForm";
import MultiSortPanel from "@/components/tasks/MultiSortPanel";
import RecurringDeleteDialog from "@/components/tasks/RecurringDeleteDialog";
import { compareDueDateTime } from "@/lib/sort-helpers";
import { excludeExternalEvents } from "@/lib/task-filters";
import { useCalendarOrderState } from "@/hooks/useCalendarOrder";
import { calendarKeyForTask, compareByCalendarOrder } from "@/lib/calendar-order";

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
    queryFn: () => apiClient.entities.Task.list("-created_date", 5000),
    // Calendar-imported events live only on /Calendar.
    select: excludeExternalEvents,
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

  // Subscribe to user-configured calendar order/visibility from Settings.
  // Updates here re-render automatically when the user toggles or reorders.
  const { hidden: hiddenCalendars, indexByKey: calendarIndexByKey } = useCalendarOrderState();

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
        return compareDueDateTime(a, b, "asc");
      case "date_desc":
        return compareDueDateTime(a, b, "desc");
      case "tag_az":
        if (!ta && tb) return 1;
        if (ta && !tb) return -1;
        return ta.localeCompare(tb);
      case "recurrence":
        if (!ra && rb) return 1;
        if (ra && !rb) return -1;
        return ra.localeCompare(rb);
      case "completed_first":
        return (a.status === "done" ? 0 : 1) - (b.status === "done" ? 0 : 1);
      case "uncompleted_first":
        return (a.status !== "done" ? 0 : 1) - (b.status !== "done" ? 0 : 1);
      case "calendar_order":
        return compareByCalendarOrder(a, b, calendarIndexByKey);
      case "none":
      default:
        return 0;
    }
  };

  const todayAndPast = useMemo(() => {
    const base = tasks
      .filter(t => !t.parent_id && t.status !== "done")
      // User-hidden calendars (Settings → Calendar Order) drop out here.
      // External events are already gone (excludeExternalEvents on the
      // query select), so this only affects calendars whose tasks were
      // visible by default — primarily Zephyrly + future task-style
      // imports. Subtasks always inherit the parent's calendar via
      // calendarKeyForTask falling back to "zephyrly".
      .filter(t => !hiddenCalendars.has(calendarKeyForTask(t)))
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
  }, [tasks, search, priorityOrderMap, todayStart, sorts, hiddenCalendars, calendarIndexByKey]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Today</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{todayAndPast.length} task{todayAndPast.length !== 1 ? "s" : ""}</p>
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
            onMouseDown={(e) => { if (showSearch) e.preventDefault(); }}
            onClick={() => { if (showSearch) setSearch(""); setShowSearch((v) => !v); }}
          >
            <Search className="w-4 h-4" />
          </Button>
          <MultiSortPanel sorts={sorts} onSortsChange={handleSortsChange} page="today" />
          <Button onClick={() => { setEditingTask(null); setAddSubtaskParent(null); setShowForm(true); }} className="bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 h-9 gap-1.5">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Task</span>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="bg-white dark:bg-[#111111] rounded-xl border border-slate-100 dark:border-[#303030] h-12 animate-pulse" />)}
        </div>
      ) : todayAndPast.length === 0 ? (
        <div className="py-14 text-center">
          {tasks.some((t) => !t.parent_id && t.status !== "done") ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">Everything's in flow. Enjoy the stillness.</p>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500">Clear skies. Add something when you're ready.</p>
          )}
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
            const existingSubCount = (subtaskMap[editingTask.id] || []).length;
            for (let i = 0; i < subtaskTitles.length; i++) {
              await createTask({ title: subtaskTitles[i], status: "todo", task_type: "one_time", parent_id: editingTask.id, order: existingSubCount + i });
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
