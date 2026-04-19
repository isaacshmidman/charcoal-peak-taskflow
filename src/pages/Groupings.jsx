// @ts-nocheck
import { useState, useMemo, useEffect, useRef } from "react";
import { apiClient } from "@/api/apiClient";
import { useQuery } from "@tanstack/react-query";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { useDeleteWithUndo } from "@/hooks/useDeleteWithUndo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import {
  startOfDay, subDays, addDays, isWithinInterval, format, isBefore
} from "date-fns";
import CompactTaskCard from "@/components/tasks/CompactTaskCard";
import TaskForm from "@/components/tasks/TaskForm";
import MultiSortPanel from "@/components/tasks/MultiSortPanel";
import RecurringDeleteDialog from "@/components/tasks/RecurringDeleteDialog";

function GroupColumn({ title, subtitle, tasks, priorities, priorityOrderMap, onToggleDone, onEdit, onDelete, onUpdate, accent, wide, sorts }) {
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
      case "priority_asc":
        return pa - pb;
      case "priority_desc":
        return pb - pa;
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

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      for (const sortValue of sorts) {
        const result = compareFn(a, b, sortValue);
        if (result !== 0) return result;
      }
      return 0;
    });
  }, [tasks, sorts, priorityOrderMap]);

  return (
    <div className={`flex-shrink-0 ${wide ? "w-72" : "w-60"} flex flex-col rounded-2xl border ${accent || "border-slate-100 bg-slate-50"} overflow-hidden`}>
      <div className={`px-3 py-2.5 border-b ${accent ? "" : "border-slate-100"}`}>
        <p className="text-xs font-semibold text-slate-900">{title}</p>
        {subtitle && <p className="text-[10px] text-slate-400 mt-0.5">{subtitle}</p>}
        <p className="text-[10px] text-slate-400">{tasks.length} task{tasks.length !== 1 ? "s" : ""}</p>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 max-h-[70vh]">
        {sorted.length === 0 ? (
          <p className="text-[10px] text-slate-300 text-center py-6">Clear skies.</p>
        ) : (
          <AnimatePresence mode="popLayout">
            {sorted.map(task => (
              <CompactTaskCard
                key={task.id}
                task={task}
                priorities={priorities}
                onToggleDone={onToggleDone}
                onEdit={onEdit}
                onDelete={onDelete}
                onUpdate={onUpdate}
              />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

export default function Groupings() {
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [addSubtaskParent, setAddSubtaskParent] = useState(null);
  const [sorts, setSorts] = useState(() => {
    try {
      const saved = localStorage.getItem("sorts_groupings");
      const parsed = saved ? JSON.parse(saved).filter(Boolean) : null;
      return parsed?.length ? parsed : ["date_asc", "priority_asc"];
    } catch {
      return ["date_asc", "priority_asc"];
    }
  });
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [recurringDeleteTask, setRecurringDeleteTask] = useState(null);
  const todayColRef = useRef(null);
  const scrollContainerRef = useRef(null);

  const { createTask, updateTask, deleteTask, completeRecurringTask, skipRecurringTask } = useOfflineMutation();
  const deleteWithUndo = useDeleteWithUndo(deleteTask, createTask);

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiClient.entities.Task.list("-created_date", 500),
  });

  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => apiClient.entities.Priority.list("order", 50),
  });

  const { data: savedTags = [] } = useQuery({
    queryKey: ["savedTags"],
    queryFn: () => apiClient.entities.SavedTag.list("name", 100),
  });

  const priorityOrderMap = useMemo(() => {
    const map = {};
    priorities.forEach(p => { map[p.id] = p.order; });
    return map;
  }, [priorities]);

  // Recurring-aware toggle — same logic as TaskCard
  const handleToggleDone = (task) => {
    const isDone = task.status === "done";
    if (!isDone && task.task_type === "recurring") {
      completeRecurringTask(task);
      return;
    }
    updateTask(task.id, { status: isDone ? "todo" : "done", completed_at: isDone ? "" : new Date().toISOString() });
  };

  const handleSortsChange = (newSorts) => {
    setSorts(newSorts);
    localStorage.setItem("sorts_groupings", JSON.stringify(newSorts));
  };

  const handleEdit = (task) => { setEditingTask(task); setAddSubtaskParent(null); setShowForm(true); };
  const handleDelete = (task) => {
    if (task.task_type === "recurring" && !task.parent_id) {
      setRecurringDeleteTask(task);
      return;
    }

    deleteWithUndo(task, { isSubtask: !!task.parent_id });
  };
  const handleUpdate = (task, changes) => updateTask(task.id, changes);

  const today = startOfDay(new Date());
  const yesterday = startOfDay(subDays(today, 1));
  const tomorrow = startOfDay(addDays(today, 1));
  const nextSevenDaysEnd = startOfDay(addDays(today, 8));

  const topLevel = useMemo(() => {
    const q = search.toLowerCase();
    return tasks.filter(t => {
      if (t.parent_id || t.status === "done") return false;
      if (!search) return true;
      return t.title?.toLowerCase().includes(q) || t.tags?.some(tag => tag.toLowerCase().includes(q));
    });
  }, [tasks, search]);
  const getDate = (t) => t.due_date ? new Date(t.due_date + "T00:00:00") : null;

  const groups = useMemo(() => {
    const past = [], yest = [], tod = [], tom = [], next7 = [], future = [], noDue = [];
    topLevel.forEach(t => {
      const d = getDate(t);
      if (!d) { noDue.push(t); return; }
      const ds = startOfDay(d);
      if (isBefore(ds, yesterday)) { past.push(t); }
      else if (ds.getTime() === yesterday.getTime()) { yest.push(t); }
      else if (ds.getTime() === today.getTime()) { tod.push(t); }
      else if (ds.getTime() === tomorrow.getTime()) { tom.push(t); }
      else if (isWithinInterval(ds, { start: addDays(tomorrow, 1), end: nextSevenDaysEnd })) { next7.push(t); }
      else { future.push(t); }
    });
    return { past, yest, tod, tom, next7, future, noDue };
  }, [topLevel]);

  // Tag-based groups: all unique tags from savedTags, sorted A→Z
  const tagGroups = useMemo(() => {
    const allTags = savedTags.map(t => t.name).sort((a, b) => a.localeCompare(b));
    // Also pick up tags used in tasks but not yet in savedTags
    const usedTags = new Set();
    tasks.filter(t => !t.parent_id && t.status !== "done").forEach(t => (t.tags || []).forEach(tag => usedTags.add(tag)));
    const allUniqueTags = [...new Set([...allTags, ...[...usedTags].sort()])].sort((a, b) => a.localeCompare(b));
    return allUniqueTags
      .map(tag => ({
        tag,
        tasks: topLevel.filter(t => t.tags?.includes(tag)),
      }))
      .filter(g => g.tasks.length > 0);
  }, [savedTags, tasks, topLevel]);

  const centerToday = () => {
    if (scrollContainerRef.current && todayColRef.current) {
      const container = scrollContainerRef.current;
      const col = todayColRef.current;
      const containerRect = container.getBoundingClientRect();
      const colRect = col.getBoundingClientRect();
      // Center of today column relative to scroll content (accounting for current scroll position)
      const colMidFromScrollLeft = (colRect.left - containerRect.left) + container.scrollLeft + colRect.width / 2;
      // Half the visible width of the scroll container
      const containerHalf = container.clientWidth / 2;
      container.scrollLeft = colMidFromScrollLeft - containerHalf;
    }
  };

  useEffect(() => {
    centerToday();
  }, []);

  // Re-center once tasks have loaded and columns are rendered — runs exactly
  // once on the first non-empty load so completing a task later doesn't reset
  // the user's scroll position.
  const hasCenteredOnLoadRef = useRef(false);
  useEffect(() => {
    if (hasCenteredOnLoadRef.current) return;
    if (tasks.length === 0) return;
    hasCenteredOnLoadRef.current = true;
    requestAnimationFrame(centerToday);
  }, [tasks.length]);

  const columns = [
    { key: "past", title: "Past", subtitle: "Before yesterday", tasks: groups.past, accent: "border-slate-200 bg-slate-50/80" },
    { key: "yest", title: "Yesterday", subtitle: format(yesterday, "MMM d"), tasks: groups.yest, accent: "border-orange-100 bg-orange-50/50" },
    { key: "tod", title: "Today", subtitle: format(today, "MMM d"), tasks: groups.tod, accent: "border-blue-200 bg-blue-50/50", wide: true },
    { key: "tom", title: "Tomorrow", subtitle: format(tomorrow, "MMM d"), tasks: groups.tom, accent: "border-orange-100 bg-orange-50/50" },
    { key: "next7", title: "Next 7 Days", subtitle: `${format(addDays(tomorrow, 1), "MMM d")} – ${format(nextSevenDaysEnd, "MMM d")}`, tasks: groups.next7, accent: "border-slate-200 bg-slate-50/80" },
    { key: "future", title: "Future", subtitle: `After ${format(nextSevenDaysEnd, "MMM d")}`, tasks: groups.future, accent: "border-slate-200 bg-slate-50/80" },
    { key: "noDue", title: "No Due Date", tasks: groups.noDue, accent: "border-slate-100 bg-slate-50/60" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Groupings</h1>
          <p className="text-xs text-slate-400 mt-0.5">{topLevel.length} task{topLevel.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          {showSearch && (
            <Input
              placeholder="Search title or tag..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-44"
              autoFocus
              onBlur={() => { if (!search) setShowSearch(false); }}
            />
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-slate-400 hover:text-slate-700"
            onMouseDown={(e) => { if (showSearch) e.preventDefault(); }}
            onClick={() => { if (showSearch) setSearch(""); setShowSearch((v) => !v); }}
          >
            <Search className="w-4 h-4" />
          </Button>
          <MultiSortPanel sorts={sorts} onSortsChange={handleSortsChange} />
          <Button onClick={() => { setEditingTask(null); setAddSubtaskParent(null); setShowForm(true); }} className="bg-slate-900 hover:bg-slate-800 h-9 gap-1.5">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Task</span>
          </Button>
        </div>
      </div>

      {/* Date-based groups */}
      <h2 className="text-xs font-semibold text-slate-900 mb-3">By Date</h2>
      <div ref={scrollContainerRef} className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4">
        {columns.map(col => (
          <div key={col.key} ref={col.key === "tod" ? todayColRef : null}>
            <GroupColumn
              title={col.title}
              subtitle={col.subtitle}
              tasks={col.tasks}
              priorities={priorities}
              priorityOrderMap={priorityOrderMap}
              onToggleDone={handleToggleDone}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onUpdate={handleUpdate}
              accent={col.accent}
              wide={col.wide}
              sorts={sorts}
            />
          </div>
        ))}
      </div>

      {/* Tag-based groups */}
      {tagGroups.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-slate-900 mb-3">By Tag</h2>
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4">
            {tagGroups.map(({ tag, tasks: tagTasks }) => (
              <GroupColumn
                key={tag}
                title={tag}
                tasks={tagTasks}
                priorities={priorities}
                priorityOrderMap={priorityOrderMap}
                onToggleDone={handleToggleDone}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onUpdate={handleUpdate}
                accent="border-violet-100 bg-violet-50/40"
                sorts={sorts}
              />
            ))}
          </div>
        </div>
      )}

      <TaskForm
        open={showForm}
        onOpenChange={(o) => { setShowForm(o); if (!o) { setEditingTask(null); setAddSubtaskParent(null); } }}
        task={editingTask}
        parentId={addSubtaskParent?.id}
        defaultDueDate=""
        existingSubtasks={editingTask ? (tasks.filter(t => t.parent_id === editingTask.id).sort((a, b) => (a.order ?? 999) - (b.order ?? 999))) : []}
        onToggleSubtask={(sub) => updateTask(sub.id, { status: sub.status === "done" ? "todo" : "done", completed_at: sub.status === "done" ? "" : new Date().toISOString() })}
        onDeleteSubtask={(sub) => deleteWithUndo(sub, { isSubtask: true })}
        onDelete={handleDelete}
        onSubmit={async (data, subtaskTitles = []) => {
          if (editingTask) {
            await updateTask(editingTask.id, data);
            const existingSubCount = tasks.filter(t => t.parent_id === editingTask.id).length;
            for (let i = 0; i < subtaskTitles.length; i++) {
              await createTask({ title: subtaskTitles[i], status: "todo", task_type: "one_time", parent_id: editingTask.id, order: existingSubCount + i });
            }
          } else {
            const created = await createTask(data);
            for (let i = 0; i < subtaskTitles.length; i++) {
              await createTask({ title: subtaskTitles[i], status: "todo", task_type: "one_time", parent_id: created.id, order: i });
            }
          }
          setEditingTask(null); setAddSubtaskParent(null);
        }}
      />

      <RecurringDeleteDialog
        open={!!recurringDeleteTask}
        onOpenChange={(open) => { if (!open) setRecurringDeleteTask(null); }}
        task={recurringDeleteTask}
        onDeleteThis={() => {
          skipRecurringTask(recurringDeleteTask);
          setRecurringDeleteTask(null);
        }}
        onDeleteAll={() => {
          deleteWithUndo(recurringDeleteTask, {});
          setRecurringDeleteTask(null);
        }}
      />
    </div>
  );
}
