// @ts-nocheck
import { useState, useMemo, useEffect, useRef } from "react";
import { apiClient } from "@/api/apiClient";
import { useQuery } from "@tanstack/react-query";
import { useGrowingList } from "@/hooks/useGrowingList";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { formatDeleteLabel, useDeleteWithUndo } from "@/hooks/useDeleteWithUndo";
import { showDeleteToast } from "@/components/tasks/DeleteToast";
import { Button } from "@/components/ui/button";
import PageHeader, { PageSearch } from "@/components/PageHeader";
import { Plus } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { addDays } from "date-fns/addDays";
import { format } from "date-fns/format";
import { isBefore } from "date-fns/isBefore";
import { isWithinInterval } from "date-fns/isWithinInterval";
import { startOfDay } from "date-fns/startOfDay";
import { subDays } from "date-fns/subDays";
import CompactTaskCard from "@/components/tasks/CompactTaskCard";
import TaskForm from "@/components/tasks/TaskForm";
import MultiSortPanel from "@/components/tasks/MultiSortPanel";
import RecurringDeleteDialog from "@/components/tasks/RecurringDeleteDialog";
import { compareTasks } from "@/lib/task-sort";
import { excludeExternalEvents, taskMatchesSearch } from "@/lib/task-filters";
import { useCalendarOrderState } from "@/hooks/useCalendarOrder";
import { calendarKeyForTask } from "@/lib/calendar-order";
import { useShortcutEvent } from "@/hooks/useShortcutEvent";
import { SHORTCUT_EVENTS } from "@/lib/shortcuts";

/**
 * One column of a board: a heading, a count, and its tasks.
 *
 * Every column is the same plain surface. Only Today is marked, with a
 * wash of sun behind its heading — one accent, not a colour per column.
 * A column of overdue tasks shows its count in red, and nothing else
 * about it changes.
 */
function GroupColumn({ title, subtitle, tasks, priorities, priorityOrderMap, onToggleDone, onEdit, onDelete, onUpdate, today, overdue, meta, sorts, calendarIndexByKey, columnRef, testid }) {
  // One comparator for every task list — see lib/task-sort.js.
  const compareFn = (a, b, sortValue) =>
    compareTasks(a, b, sortValue, { priorityOrderMap, calendarIndexByKey });

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      for (const sortValue of sorts) {
        const result = compareFn(a, b, sortValue);
        if (result !== 0) return result;
      }
      return 0;
    });
  }, [tasks, sorts, priorityOrderMap, calendarIndexByKey]);
  // Drawn a couple of screens at a time; the rest as the page is scrolled.
  const list = useGrowingList(sorted);

  return (
    <section
      ref={columnRef}
      data-testid={testid}
      aria-label={`${title}, ${tasks.length} task${tasks.length !== 1 ? "s" : ""}`}
      // On a phone a column is most of the screen and the board snaps to
      // it. From a tablet up, columns share the width when they all fit
      // and keep a readable minimum (so the board scrolls) when they don't.
      className={cn(
        "flex w-[80vw] max-w-[19rem] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-border-hairline bg-surface-card",
        "sm:w-auto sm:max-w-[22rem] sm:flex-1",
        today ? "sm:min-w-[17rem]" : "sm:min-w-[15rem]"
      )}
    >
      <header className={cn("border-b border-border-hairline px-3 py-2.5", today && "bg-sun-100 dark:bg-sun-400/[0.12]")}>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold text-ink-900 dark:text-ink-100" title={title}>{title}</h3>
          <span
            className={cn(
              "shrink-0 text-xs tabular-nums",
              overdue && tasks.length > 0 ? "font-semibold text-red-600 dark:text-red-400" : "text-ink-500 dark:text-ink-400"
            )}
          >
            {tasks.length}
          </span>
        </div>
        {subtitle ? <p className="mt-0.5 text-[11px] text-ink-500 dark:text-ink-400">{subtitle}</p> : null}
      </header>
      {/* An empty column keeps the height of a two-task one, so a board
          with empty columns doesn't look ragged. A long one scrolls
          inside itself, so the board never grows taller than the screen. */}
      <div className="max-h-[max(14rem,calc(100dvh-23.5rem))] min-h-[4.75rem] flex-1 divide-y divide-[var(--border-hairline)] overflow-y-auto overscroll-contain sm:max-h-[max(14rem,calc(100dvh-19rem))]">
        {sorted.length === 0 ? null : (
          <AnimatePresence mode="popLayout">
            {list.shown.map(task => (
              <CompactTaskCard
                key={task.id}
                task={task}
                priorities={priorities}
                onToggleDone={onToggleDone}
                onEdit={onEdit}
                onDelete={onDelete}
                onUpdate={onUpdate}
                meta={meta}
              />
            ))}
          </AnimatePresence>
        )}
        {list.more && <div ref={list.markerRef} aria-hidden="true" className="h-px !border-0" data-testid="list-more" />}
      </div>
    </section>
  );
}

/** The row of columns. Scrolls sideways when they don't all fit. */
function Board({ scrollRef, children }) {
  return (
    <div
      ref={scrollRef}
      data-testid="groupings-board"
      className="-mx-4 flex snap-x snap-proximity items-start gap-3 overflow-x-auto scroll-px-4 px-4 pb-4 sm:-mx-6 sm:scroll-px-6 sm:px-6"
    >
      {children}
    </div>
  );
}

const VIEWS = [["date", "By date"], ["tag", "By tag"]];

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
  // One board at a time — by date or by tag — remembered between visits.
  const [view, setView] = useState(() => {
    try { return localStorage.getItem("groupings_view") === "tag" ? "tag" : "date"; } catch { return "date"; }
  });
  const chooseView = (next) => {
    setView(next);
    try { localStorage.setItem("groupings_view", next); } catch { /* private mode: just don't remember */ }
  };
  const todayColRef = useRef(null);
  const scrollContainerRef = useRef(null);

  // Keyboard shortcuts (parsed centrally in useGlobalShortcuts).
  useShortcutEvent(SHORTCUT_EVENTS.newTask, () => {
    setEditingTask(null); setAddSubtaskParent(null); setShowForm(true);
  });
  useShortcutEvent(SHORTCUT_EVENTS.search, () => setShowSearch(true));

  const { createTask, updateTask, deleteTask, completeRecurringTask, skipRecurringTask } = useOfflineMutation();
  const deleteWithUndo = useDeleteWithUndo(deleteTask, createTask);

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiClient.entities.Task.list("-created_date", 5000),
    // Calendar-imported events live only on /Calendar.
    select: excludeExternalEvents,
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

  // Calendar visibility + order from Settings.
  const { hidden: hiddenCalendars, indexByKey: calendarIndexByKey } = useCalendarOrderState();

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
    return tasks.filter(t => {
      if (t.parent_id || t.status === "done") return false;
      // Hide tasks belonging to user-hidden calendars (Settings → Calendar Order).
      if (hiddenCalendars.has(calendarKeyForTask(t))) return false;
      return taskMatchesSearch(t, search);
    });
  }, [tasks, search, hiddenCalendars]);
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
      // Today's left edge within the scrolling content.
      const colLeft = (colRect.left - containerRect.left) + container.scrollLeft;
      // On a wide screen Today sits in the middle, with what's overdue
      // on its left and what's coming on its right. On a phone a column
      // is most of the screen, so Today starts at the edge instead —
      // centred, it would rest between two snap points.
      const narrow = colRect.width > container.clientWidth * 0.6;
      container.scrollLeft = narrow
        ? colLeft - 16
        : colLeft + colRect.width / 2 - container.clientWidth / 2;
    }
  };

  // On arrival, and whenever the date board comes back into view.
  useEffect(() => {
    if (view === "date") centerToday();
  }, [view]);

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

  // Past, Yesterday and "No date" only appear when something is in them:
  // an empty Past is the good state, and not worth a column. The four
  // that look ahead are always there.
  const columns = [
    { key: "past", title: "Past", subtitle: `Before ${format(yesterday, "MMM d")}`, tasks: groups.past, overdue: true, optional: true },
    { key: "yest", title: "Yesterday", subtitle: format(yesterday, "EEE, MMM d"), tasks: groups.yest, overdue: true, optional: true, meta: "time" },
    { key: "tod", title: "Today", subtitle: format(today, "EEE, MMM d"), tasks: groups.tod, today: true, meta: "time" },
    { key: "tom", title: "Tomorrow", subtitle: format(tomorrow, "EEE, MMM d"), tasks: groups.tom, meta: "time" },
    { key: "next7", title: "Next 7 days", subtitle: `${format(addDays(tomorrow, 1), "MMM d")} – ${format(nextSevenDaysEnd, "MMM d")}`, tasks: groups.next7 },
    { key: "future", title: "Later", subtitle: `After ${format(nextSevenDaysEnd, "MMM d")}`, tasks: groups.future },
    { key: "noDue", title: "No date", tasks: groups.noDue, optional: true },
  ].filter((col) => !col.optional || col.tasks.length > 0);

  const columnProps = {
    priorities,
    priorityOrderMap,
    onToggleDone: handleToggleDone,
    onEdit: handleEdit,
    onDelete: handleDelete,
    onUpdate: handleUpdate,
    sorts,
  };

  return (
    <div>
      <PageHeader
        title="Groupings"
        sub={<>{topLevel.length} task{topLevel.length !== 1 ? "s" : ""}</>}
        below={
          <div className="mt-3 flex">
            <div className="ds-seg flex-1 sm:flex-none">
              {VIEWS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => chooseView(key)}
                  aria-pressed={view === key}
                  className="ds-seg-item flex-1 px-3 py-1 text-xs sm:flex-none"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <PageSearch open={showSearch} onOpenChange={setShowSearch} value={search} onChange={setSearch} placeholder="Search title or tag" />
        <MultiSortPanel sorts={sorts} onSortsChange={handleSortsChange} page="groupings" />
        <Button aria-label="New Task" onClick={() => { setEditingTask(null); setAddSubtaskParent(null); setShowForm(true); }} className="h-9 gap-1.5">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New Task</span>
        </Button>
      </PageHeader>

      <div className="mt-3">
        {view === "date" ? (
          // Keyed, so each board is its own element and starts from its
          // own beginning rather than inheriting the other's scroll.
          <Board key="date" scrollRef={scrollContainerRef}>
            {columns.map((col) => (
              <GroupColumn
                key={col.key}
                testid={`group-${col.key}`}
                columnRef={col.key === "tod" ? todayColRef : undefined}
                title={col.title}
                subtitle={col.subtitle}
                tasks={col.tasks}
                today={col.today}
                overdue={col.overdue}
                meta={col.meta}
                calendarIndexByKey={calendarIndexByKey}
                {...columnProps}
              />
            ))}
          </Board>
        ) : tagGroups.length > 0 ? (
          <Board key="tag">
            {tagGroups.map(({ tag, tasks: tagTasks }) => (
              <GroupColumn key={tag} testid={`group-tag-${tag}`} title={tag} tasks={tagTasks} {...columnProps} />
            ))}
          </Board>
        ) : (
          <div className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center" data-testid="groupings-no-tags">
            <p className="text-sm font-medium text-ink-900 dark:text-ink-100">
              {search ? "No tagged tasks match your search" : "No tagged tasks yet"}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-ink-500 dark:text-ink-400">
              {search ? "Try a different word, or clear the search." : "Add a tag to a task and it gets a column here, with every other task that shares it."}
            </p>
          </div>
        )}
      </div>

      <TaskForm
        open={showForm}
        onOpenChange={(o) => { setShowForm(o); if (!o) { setEditingTask(null); setAddSubtaskParent(null); } }}
        task={editingTask}
        parentId={addSubtaskParent?.id}
        existingSubtasks={editingTask ? (tasks.filter(t => t.parent_id === editingTask.id).sort((a, b) => (a.order ?? 999) - (b.order ?? 999))) : []}
        onToggleSubtask={(sub) => updateTask(sub.id, { status: sub.status === "done" ? "todo" : "done", completed_at: sub.status === "done" ? "" : new Date().toISOString() })}
        onDeleteSubtask={(sub) => deleteWithUndo(sub, { isSubtask: true })}
        onDelete={handleDelete}
        onSubmit={async (data, subtaskTitles = [], existingId = null) => {
          // Upsert for autosave (editing reset lives in onOpenChange).
          const id = editingTask?.id ?? existingId;
          if (id) {
            await updateTask(id, data);
            const existingSubCount = tasks.filter(t => t.parent_id === id).length;
            for (let i = 0; i < subtaskTitles.length; i++) {
              await createTask({ title: subtaskTitles[i], status: "todo", task_type: "one_time", parent_id: id, order: existingSubCount + i });
            }
            return { id };
          }
          const created = await createTask(data);
          for (let i = 0; i < subtaskTitles.length; i++) {
            await createTask({ title: subtaskTitles[i], status: "todo", task_type: "one_time", parent_id: created.id, order: i });
          }
          return created;
        }}
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
        onDeleteAll={() => {
          deleteWithUndo(recurringDeleteTask, {});
          setRecurringDeleteTask(null);
        }}
      />
    </div>
  );
}
