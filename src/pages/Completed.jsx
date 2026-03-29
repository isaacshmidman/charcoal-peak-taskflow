// @ts-nocheck
import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { useDeleteWithUndo } from "@/hooks/useDeleteWithUndo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Trash2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import TaskCard from "@/components/tasks/TaskCard";
import TaskForm from "@/components/tasks/TaskForm";
import MultiSortPanel from "@/components/tasks/MultiSortPanel";

export default function Completed() {
  const [editingTask, setEditingTask] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
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

  const { updateTask, deleteTask, createTask } = useOfflineMutation();
  const deleteWithUndo = useDeleteWithUndo(deleteTask, createTask);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => base44.entities.Task.list("-completed_at", 500)
  });

  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => base44.entities.Priority.list("order", 50)
  });

  const priorityOrderMap = useMemo(() => {
    const map = {};
    priorities.forEach((p) => {map[p.id] = p.order;});
    return map;
  }, [priorities]);

  const subtaskMap = useMemo(() => {
    const map = {};
    tasks.filter((t) => t.parent_id).forEach((t) => {
      if (!map[t.parent_id]) map[t.parent_id] = [];
      map[t.parent_id].push(t);
    });
    Object.values(map).forEach((arr) => arr.sort((a, b) => (a.order ?? 999) - (b.order ?? 999)));
    return map;
  }, [tasks]);

  const compareFn = (a, b, sortValue) => {
    const pa = (t) => priorityOrderMap[t.priority_id] ?? 99;
    const da = (t) => t.due_date ? new Date(t.due_date + "T00:00:00") : null;
    const ca = (t) => new Date(t.completed_at || t.updated_date);
    const ta = a.tags?.[0] || "";
    const tb = b.tags?.[0] || "";
    const ra = a.task_type === "recurring" ? a.recurrence || "" : "";
    const rb = b.task_type === "recurring" ? b.recurrence || "" : "";

    switch (sortValue) {
      case "date_asc":
        return (da(a) || ca(a)) - (da(b) || ca(b));
      case "date_desc":
        return (da(b) || ca(b)) - (da(a) || ca(a));
      case "priority_asc":
        return pa(a) - pa(b);
      case "priority_desc":
        return pa(b) - pa(a);
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

  const completedTasks = useMemo(() => {
    const base = tasks.
    filter((t) => t.status === "done" && !t.parent_id).
    filter((t) => !search || t.title?.toLowerCase().includes(search.toLowerCase()) || t.tags?.some((tag) => tag.toLowerCase().includes(search.toLowerCase())));

    return base.sort((a, b) => {
      for (const sortValue of sorts) {
        const result = compareFn(a, b, sortValue);
        if (result !== 0) return result;
      }
      return 0;
    });
  }, [tasks, search, sorts, priorityOrderMap]);

  const deleteAll = async () => {
    await deleteWithUndo.many(completedTasks, {
      label: `${completedTasks.length} completed task${completedTasks.length === 1 ? "" : "s"} deleted`,
    });
    setShowDeleteAllDialog(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Completed</h1>
          <p className="text-xs text-slate-400 mt-0.5">{completedTasks.length} task{completedTasks.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          {showSearch &&
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-40 text-sm bg-white border-slate-100"
            autoFocus
            onBlur={() => {if (!search) setShowSearch(false);}} />

          }
          <Button variant="ghost" size="icon" className="h-9 w-9 text-slate-400 hover:text-slate-700" onClick={() => setShowSearch(!showSearch)}>
            <Search className="w-4 h-4" />
          </Button>
          <MultiSortPanel sorts={sorts} onSortsChange={handleSortsChange} />
          {completedTasks.length > 0 &&
          <AlertDialog open={showDeleteAllDialog} onOpenChange={setShowDeleteAllDialog}>
              <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-red-400 hover:text-red-600 hover:bg-red-50"
              title="Delete all completed"
              onClick={() => setShowDeleteAllDialog(true)}>
                
                <Trash2 className="w-4 h-4" />
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete all completed tasks?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove {completedTasks.length} completed task{completedTasks.length === 1 ? "" : "s"} now, with a single undo toast right after.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={deleteAll}>Delete all</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        </div>
      </div>

      {isLoading ?
      <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="bg-white rounded-xl border border-slate-100 h-12 animate-pulse" />)}
        </div> :
      completedTasks.length === 0 ?
      <div className="text-center py-14">
          <p className="text-xs text-slate-400">No completed tasks yet</p>
        </div> :

      <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {completedTasks.map((task) =>
          <TaskCard
            key={task.id}
            task={task}
            priorities={priorities}
            subtasks={subtaskMap[task.id] || []}
            onToggleDone={(t) => updateTask(t.id, { status: "todo", completed_at: "" })}
            onEdit={(t) => {setEditingTask(t);setShowForm(true);}}
            onDelete={(t) => deleteWithUndo(t, { isSubtask: !!t.parent_id })}
            hideMenu />

          )}
          </AnimatePresence>
        </div>
      }

      <TaskForm
        open={showForm}
        onOpenChange={(o) => {setShowForm(o);if (!o) setEditingTask(null);}}
        task={editingTask}
        existingSubtasks={editingTask ? subtaskMap[editingTask.id] || [] : []}
        onToggleSubtask={(sub) => updateTask(sub.id, { status: sub.status === "done" ? "todo" : "done", completed_at: sub.status === "done" ? "" : new Date().toISOString() })}
        onDeleteSubtask={(sub) => deleteWithUndo(sub, { isSubtask: true })}
        onDelete={(t) => {deleteWithUndo(t);setEditingTask(null);}}
        onSubmit={async (data, subtaskTitles = []) => {
          await updateTask(editingTask.id, data);
          for (let i = 0; i < subtaskTitles.length; i++) {
            await createTask({ title: subtaskTitles[i], status: "todo", task_type: "one_time", parent_id: editingTask.id, order: i });
          }
          setEditingTask(null);
        }} />
      
    </div>);

}
