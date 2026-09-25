// @ts-nocheck
/**
 * @file Calendar page shell. Owns queries (tasks + priorities), top-
 * level state (view, anchorDate, sorts, form open/edit state),
 * navigation helpers (prev / next / today), and composes:
 *   - CalendarToolbar (header + view switcher + nav arrows)
 *   - useCalendarFilters (visibility + search + sort)
 *   - useCalendarDnd (DragOverlay + drop handlers)
 *   - The four view components (Day / Week / Month / Year)
 *   - TaskForm + RecurringDeleteDialog modals
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/apiClient";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { useDeleteWithUndo, formatDeleteLabel } from "@/hooks/useDeleteWithUndo";
import { showDeleteToast } from "@/components/tasks/DeleteToast";
import RecurringDeleteDialog from "@/components/tasks/RecurringDeleteDialog";
import { DndContext, DragOverlay, pointerWithin } from "@dnd-kit/core";
import { addDays } from "date-fns/addDays";
import { addMonths } from "date-fns/addMonths";
import { addWeeks } from "date-fns/addWeeks";
import { addYears } from "date-fns/addYears";
import { endOfWeek } from "date-fns/endOfWeek";
import { format } from "date-fns/format";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import { isSameMonth } from "date-fns/isSameMonth";
import { isSameYear } from "date-fns/isSameYear";
import { isWithinInterval } from "date-fns/isWithinInterval";
import { startOfDay } from "date-fns/startOfDay";
import { startOfMonth } from "date-fns/startOfMonth";
import { startOfWeek } from "date-fns/startOfWeek";
import { startOfYear } from "date-fns/startOfYear";
import { subDays } from "date-fns/subDays";
import { subMonths } from "date-fns/subMonths";
import { subWeeks } from "date-fns/subWeeks";
import { subYears } from "date-fns/subYears";
import TaskForm from "@/components/tasks/TaskForm";
import { formatSlotTime, timeRangeLabel } from "@/components/calendar/useEmptySlotClick";
import MonthCalendar from "@/components/calendar/MonthCalendar";
import DayView from "@/components/calendar/DayView";
import WeekView from "@/components/calendar/WeekView";
import YearView from "@/components/calendar/YearView";
import MiniMiniTaskCard from "@/components/calendar/MiniMiniTaskCard";
import { minutesToTaskTime, nextQuarterHour } from "@/lib/sort-helpers";
import { toDateStr } from "@/lib/dates";
import { useIntegrationsConnected, useIntegrations } from "@/hooks/useIntegrations";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useShortcutEvent } from "@/hooks/useShortcutEvent";
import { SHORTCUT_EVENTS } from "@/lib/shortcuts";
import CalendarToolbar from "./CalendarToolbar.jsx";
import { useCalendarFilters } from "./useCalendarFilters.js";
import { useCalendarDnd } from "./useCalendarDnd.js";

const VIEWS = ["day", "week", "month", "year"];

export default function Calendar() {
  const location = useLocation();
  const online = useOnlineStatus();
  const handledNotificationUrlRef = useRef("");
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [formDefaultDueDate, setFormDefaultDueDate] = useState(null);
  const [formDefaultTimeStart, setFormDefaultTimeStart] = useState(null);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  // Initial view uses the user's configured "Default Calendar View" (Settings),
  // defaulting to "month" when unset.
  const [view, setView] = useState(() => {
    const configured = localStorage.getItem("defaultCalendarView");
    return VIEWS.includes(configured) ? configured : "month";
  });
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()));

  const [sorts, setSorts] = useState(() => {
    try {
      const saved = localStorage.getItem("sorts_calendar");
      const parsed = saved ? JSON.parse(saved).filter(Boolean) : null;
      return parsed?.length ? parsed : ["uncompleted_first", "priority_asc"];
    } catch {
      return ["uncompleted_first", "priority_asc"];
    }
  });
  const handleSortsChange = (next) => {
    setSorts(next);
    localStorage.setItem("sorts_calendar", JSON.stringify(next));
  };

  const handleViewChange = (v) => setView(v);

  const { createTask, updateTask, deleteTask, completeRecurringTask, skipRecurringTask } = useOfflineMutation();
  const deleteWithUndo = useDeleteWithUndo(deleteTask, createTask);
  // Calendar-page-local "are you sure (and which scope)?" prompt for
  // recurring deletes. Mirrors Today/Active/Groupings — without it, hitting
  // the trash on a recurring task in the Calendar nav skipped the dialog
  // and just deleted the entire series silently.
  const [recurringDeleteTask, setRecurringDeleteTask] = useState(null);
  const handleDelete = (task) => {
    if (task.task_type === "recurring" && !task.parent_id) {
      setRecurringDeleteTask(task);
    } else {
      deleteWithUndo(task, { isSubtask: !!task.parent_id });
    }
  };

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiClient.entities.Task.list("-created_date", 5000),
  });
  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => apiClient.entities.Priority.list("order", 50),
  });

  useEffect(() => {
    if (!location.search || handledNotificationUrlRef.current === location.search) return;
    const params = new URLSearchParams(location.search);
    const dateParam = params.get("date");
    const taskId = params.get("task");
    const viewParam = params.get("view");
    if (!dateParam && !taskId && !viewParam) return;

    if (viewParam && VIEWS.includes(viewParam)) setView(viewParam);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateParam || ""))) {
      const nextDate = startOfDay(new Date(`${dateParam}T00:00:00`));
      if (!Number.isNaN(nextDate.getTime())) setAnchorDate(nextDate);
    }

    if (taskId && tasks.length) {
      const task = tasks.find((t) => String(t.id) === String(taskId));
      if (task) {
        setEditingTask(task);
        setFormDefaultDueDate(null);
        setFormDefaultTimeStart(null);
        setShowForm(true);
        handledNotificationUrlRef.current = location.search;
      }
    } else if (!taskId) {
      handledNotificationUrlRef.current = location.search;
    }
  }, [location.search, tasks]);

  const subtaskMap = useMemo(() => {
    const map = {};
    for (const task of tasks) {
      if (!task.parent_id) continue;
      if (!map[task.parent_id]) map[task.parent_id] = [];
      map[task.parent_id].push(task);
    }
    Object.values(map).forEach((items) => {
      items.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    });
    return map;
  }, [tasks]);

  const priorityOrderMap = useMemo(() => {
    const map = {};
    priorities.forEach((p) => { map[p.id] = p.order; });
    return map;
  }, [priorities]);

  const handleToggleDone = (task) => {
    const isDone = task.status === "done";
    if (!isDone && task.task_type === "recurring") {
      completeRecurringTask(task);
      return;
    }
    updateTask(task.id, {
      status: isDone ? "todo" : "done",
      completed_at: isDone ? "" : new Date().toISOString(),
    });
  };

  const handleTaskClick = (task) => {
    setEditingTask(task);
    setFormDefaultDueDate(null);
    setShowForm(true);
  };

  const handleTaskReschedule = (task, newDateStr) => {
    updateTask(task.id, { due_date: newDateStr });
  };

  const {
    hiddenCalendars,
    setHiddenCalendars,
    calendarsList,
    viewRange,
    filteredTasks,
    scopedCount,
  } = useCalendarFilters({ tasks, view, anchorDate, search, sorts, priorityOrderMap });

  const {
    sensors,
    activeTask,
    overlayWidth,
    dropPreview,
    handleDragStart,
    handleDragOver,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  } = useCalendarDnd({ updateTask, onTaskReschedule: handleTaskReschedule });

  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "";
    }
  }, []);

  const goPrev = () => {
    setAnchorDate((d) => {
      if (view === "day") return subDays(d, 1);
      if (view === "week") return subWeeks(d, 1);
      if (view === "year") return subYears(d, 1);
      return subMonths(d, 1);
    });
  };
  const goNext = () => {
    setAnchorDate((d) => {
      if (view === "day") return addDays(d, 1);
      if (view === "week") return addWeeks(d, 1);
      if (view === "year") return addYears(d, 1);
      return addMonths(d, 1);
    });
  };
  const goToday = () => setAnchorDate(startOfDay(new Date()));

  const rangeLabel = useMemo(() => {
    if (view === "day") return format(anchorDate, "MMM d, yyyy");
    if (view === "week") {
      const s = startOfWeek(anchorDate, { weekStartsOn: 0 });
      const e = endOfWeek(anchorDate, { weekStartsOn: 0 });
      return `${format(s, "MMM d")} – ${format(e, "MMM d, yyyy")}`;
    }
    if (view === "year") return format(anchorDate, "yyyy");
    return format(anchorDate, "MMMM yyyy");
  }, [view, anchorDate]);

  const integrationsConnected = useIntegrationsConnected();
  const { integrations, sync, syncing } = useIntegrations();
  // Show sync UI for the most recent active integration (almost always 1 today).
  const activeIntegration = useMemo(
    () => (integrations || []).find((i) => i.status === "active") || null,
    [integrations]
  );
  const lastSyncedLabel = useMemo(() => {
    if (!activeIntegration?.last_synced_at) return "Never synced";
    try {
      return `Synced ${formatDistanceToNow(new Date(activeIntegration.last_synced_at), { addSuffix: true })}`;
    } catch {
      return "Synced recently";
    }
  }, [activeIntegration?.last_synced_at]);
  const handleSyncNow = async () => {
    if (!activeIntegration || !online) return;
    try {
      await sync(activeIntegration.id);
    } catch {
      /* surfaced via integration row last_error */
    }
  };

  const handleDayEmptyClick = (dateStr) => {
    setAnchorDate(new Date(dateStr + "T00:00:00"));
    handleViewChange("day");
  };

  const handleYearDayClick = (dateStr) => {
    setAnchorDate(new Date(dateStr + "T00:00:00"));
    handleViewChange("day");
  };

  // Clicking empty time (or an all-day area) in Day/Week: a new task on
  // that day, at that time — or all-day when minutes is null.
  const openNewTaskAt = (dateStr, minutes) => {
    setEditingTask(null);
    setFormDefaultDueDate(dateStr);
    setFormDefaultTimeStart(minutes == null ? null : formatSlotTime(minutes));
    setShowForm(true);
  };

  // Dragging an event's bottom edge in Day/Week: a new end time.
  const handleResizeEnd = (task, endMinutes) => {
    updateTask(task.id, { task_end_time: minutesToTaskTime(endMinutes) });
  };

  const openNewTask = () => {
    const today = startOfDay(new Date());
    let defaultDate;
    if (view === "day") {
      defaultDate = anchorDate;
    } else if (view === "week") {
      const wStart = startOfWeek(anchorDate, { weekStartsOn: 0 });
      const wEnd = endOfWeek(anchorDate, { weekStartsOn: 0 });
      defaultDate = isWithinInterval(today, { start: wStart, end: wEnd })
        ? today
        : wStart;
    } else if (view === "month") {
      defaultDate = isSameMonth(anchorDate, today)
        ? today
        : startOfMonth(anchorDate);
    } else {
      defaultDate = isSameYear(anchorDate, today)
        ? today
        : startOfYear(anchorDate);
    }
    setEditingTask(null);
    setFormDefaultDueDate(toDateStr(defaultDate));
    if (view === "day" || view === "week") {
      setFormDefaultTimeStart(nextQuarterHour());
    } else {
      setFormDefaultTimeStart(null);
    }
    setShowForm(true);
  };

  // Keyboard shortcuts (parsed centrally in useGlobalShortcuts; the
  // calendar-* events only fire while this route is active).
  useShortcutEvent(SHORTCUT_EVENTS.newTask, openNewTask);
  useShortcutEvent(SHORTCUT_EVENTS.search, () => setShowSearch(true));
  useShortcutEvent(SHORTCUT_EVENTS.calendarView, (v) => handleViewChange(v));
  useShortcutEvent(SHORTCUT_EVENTS.calendarToday, goToday);
  useShortcutEvent(SHORTCUT_EVENTS.calendarStep, (dir) => (dir === -1 ? goPrev() : goNext()));
  useShortcutEvent(SHORTCUT_EVENTS.calendarSync, handleSyncNow);

  return (
    <div className="space-y-4">
      <CalendarToolbar
        view={view}
        onViewChange={handleViewChange}
        rangeLabel={rangeLabel}
        scopedCount={scopedCount}
        search={search}
        setSearch={setSearch}
        showSearch={showSearch}
        setShowSearch={setShowSearch}
        sorts={sorts}
        onSortsChange={handleSortsChange}
        calendarsList={calendarsList}
        hiddenCalendars={hiddenCalendars}
        onHiddenCalendarsChange={setHiddenCalendars}
        integrationsConnected={integrationsConnected}
        activeIntegration={activeIntegration}
        online={online}
        syncing={syncing}
        lastSyncedLabel={lastSyncedLabel}
        onSyncNow={handleSyncNow}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        onNewTask={openNewTask}
      />

      {/* View body — DnD wraps Day, Week and Month. Dropping on an hour
          column sets the day and time; on an all-day strip, makes it
          all-day; on a month cell, moves the date. */}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {view === "day" && (
          <DayView
            anchorDate={anchorDate}
            tasks={filteredTasks}
            priorities={priorities}
            onTaskClick={handleTaskClick}
            onToggleDone={handleToggleDone}
            onCreateAt={openNewTaskAt}
            dropPreview={dropPreview}
            onResizeEnd={handleResizeEnd}
          />
        )}
        {view === "week" && (
          <WeekView
            anchorDate={anchorDate}
            tasks={filteredTasks}
            priorities={priorities}
            onTaskClick={handleTaskClick}
            onToggleDone={handleToggleDone}
            onDayClick={handleDayEmptyClick}
            onCreateAt={openNewTaskAt}
            dropPreview={dropPreview}
            onResizeEnd={handleResizeEnd}
          />
        )}
        {view === "month" && (
          <MonthCalendar
            anchorDate={anchorDate}
            tasks={filteredTasks}
            priorities={priorities}
            onTaskClick={handleTaskClick}
            onToggleDone={handleToggleDone}
            onDayEmptyClick={handleDayEmptyClick}
          />
        )}
        {view === "year" && (
          <YearView
            anchorDate={anchorDate}
            onDayClick={handleYearDayClick}
          />
        )}

        {/* Portalled to <body>. Rendered in place, the overlay's fixed-position
            wrapper was a child of this page's space-y-4 container and picked
            up its margin-top: 16px — so every dragged card floated 16px
            below the pointer, and a Day/Week drop landed ~20 minutes later
            than where it was picked up relative to. */}
        {createPortal(
        <DragOverlay>
          {activeTask ? (
            <div
              className="relative ring-2 ring-slate-900 shadow-lg rounded transition-[width] duration-150 ease-out origin-center"
              style={overlayWidth ? { width: overlayWidth } : undefined}
            >
              {/* Over an hour column: the time it will land at, riding on
                  the card so it's never hidden (the grid outline shows the
                  slot and duration). */}
              {dropPreview && (
                <div
                  data-testid="calendar-drop-time"
                  className="pointer-events-none absolute bottom-full left-0 mb-1 whitespace-nowrap rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow dark:bg-slate-100 dark:text-slate-900"
                >
                  {timeRangeLabel(dropPreview.start, dropPreview.end)}
                </div>
              )}
              <MiniMiniTaskCard
                task={activeTask}
                priorities={priorities}
                onClick={() => {}}
              />
            </div>
          ) : null}
        </DragOverlay>,
        document.body
        )}
      </DndContext>

      {timezone && (
        <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-4">
          Time Zone: {timezone}
        </p>
      )}

      <TaskForm
        open={showForm}
        onOpenChange={(o) => {
          setShowForm(o);
          if (!o) {
            setEditingTask(null);
            setFormDefaultDueDate(null);
            setFormDefaultTimeStart(null);
          }
        }}
        task={editingTask}
        defaultDueDate={formDefaultDueDate}
        defaultTaskTime={formDefaultTimeStart}
        existingSubtasks={editingTask ? (subtaskMap[editingTask.id] || []) : []}
        onToggleSubtask={handleToggleDone}
        onDeleteSubtask={(sub) => deleteWithUndo(sub, { isSubtask: true })}
        onDelete={handleDelete}
        onSubmit={async (data, subtaskTitles = [], existingId = null) => {
          // Upsert for autosave (editing reset lives in onOpenChange).
          const id = editingTask?.id ?? existingId;
          if (id) {
            await updateTask(id, data);
            const existingSubCount = (subtaskMap[id] || []).length;
            for (let i = 0; i < subtaskTitles.length; i++) {
              await createTask({
                title: subtaskTitles[i],
                status: "todo",
                task_type: "one_time",
                parent_id: id,
                order: existingSubCount + i,
              });
            }
            return { id };
          }
          const created = await createTask(data);
          for (let i = 0; i < subtaskTitles.length; i++) {
            await createTask({
              title: subtaskTitles[i],
              status: "todo",
              task_type: "one_time",
              parent_id: created.id,
              order: i,
            });
          }
          return created;
        }}
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
    </div>
  );
}
