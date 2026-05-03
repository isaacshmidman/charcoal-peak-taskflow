// @ts-nocheck
import { useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/apiClient";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { useDeleteWithUndo, formatDeleteLabel } from "@/hooks/useDeleteWithUndo";
import { showDeleteToast } from "@/components/tasks/DeleteToast";
import RecurringDeleteDialog from "@/components/tasks/RecurringDeleteDialog";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from "@dnd-kit/core";
import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  subDays,
  subWeeks,
  subMonths,
  subYears,
  startOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  isWithinInterval,
  isSameMonth,
  isSameYear,
  format,
} from "date-fns";
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Settings as SettingsIcon,
  RefreshCw,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { AnimatedSearchInput } from "@/components/ui/animated-search-input";
import { cn } from "@/lib/utils";
import MultiSortPanel from "@/components/tasks/MultiSortPanel";
import TaskForm from "@/components/tasks/TaskForm";
import CalendarVisibilityDropdown, {
  deriveCalendars,
  calendarKeyForTask,
} from "@/components/calendar/CalendarVisibilityDropdown";
import MonthCalendar, { toDateStr } from "@/components/calendar/MonthCalendar";
import DayView from "@/components/calendar/DayView";
import WeekView from "@/components/calendar/WeekView";
import YearView from "@/components/calendar/YearView";
import MiniMiniTaskCard from "@/components/calendar/MiniMiniTaskCard";
import {
  compareTaskTime,
  compareDueDateTime,
  parseTaskTime,
  minutesToTaskTime,
  nextQuarterHour,
} from "@/lib/sort-helpers";
import { useIntegrationsConnected, useIntegrations } from "@/hooks/useIntegrations";

const VIEWS = ["day", "week", "month", "year"];

export default function Calendar() {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [formDefaultDueDate, setFormDefaultDueDate] = useState(null);
  const [formDefaultTimeStart, setFormDefaultTimeStart] = useState(null);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  // Hidden calendar keys for the visibility dropdown. Default-empty Set =
  // all calendars visible. Persisted so toggles survive a reload. We store
  // an array (JSON-friendly) and lift it into a Set on read.
  const [hiddenCalendars, setHiddenCalendars] = useState(() => {
    try {
      const raw = localStorage.getItem("calendar_hidden_calendars");
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  });
  const handleHiddenCalendarsChange = (next) => {
    setHiddenCalendars(next);
    try {
      localStorage.setItem("calendar_hidden_calendars", JSON.stringify([...next]));
    } catch {}
  };

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

  const handleViewChange = (v) => {
    setView(v);
  };

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

  const viewRange = useMemo(() => {
    if (view === "day") return { start: startOfDay(anchorDate), end: startOfDay(anchorDate) };
    if (view === "week") {
      return {
        start: startOfWeek(anchorDate, { weekStartsOn: 0 }),
        end: endOfWeek(anchorDate, { weekStartsOn: 0 }),
      };
    }
    if (view === "month") {
      return { start: startOfMonth(anchorDate), end: endOfMonth(anchorDate) };
    }
    return { start: startOfYear(anchorDate), end: endOfYear(anchorDate) };
  }, [view, anchorDate]);

  // Apply search + user sorts + time tiebreaker.
  const compareFn = (a, b, sortValue) => {
    const pa = priorityOrderMap[a.priority_id] ?? 99;
    const pb = priorityOrderMap[b.priority_id] ?? 99;
    const ta = a.tags?.[0] || "";
    const tb = b.tags?.[0] || "";
    const ra = a.task_type === "recurring" ? a.recurrence || "" : "";
    const rb = b.task_type === "recurring" ? b.recurrence || "" : "";
    switch (sortValue) {
      case "priority_asc": return pa - pb;
      case "priority_desc": return pb - pa;
      case "date_asc": return compareDueDateTime(a, b, "asc");
      case "date_desc": return compareDueDateTime(a, b, "desc");
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
      case "all_day_first": {
        // "All-day" = no task_time set. We compare 0/1 booleans so all-day
        // sorts ahead of timed; timed-vs-timed ties fall through to other
        // sorts (and ultimately the time tiebreaker after this switch).
        const aAllDay = !a.task_time ? 0 : 1;
        const bAllDay = !b.task_time ? 0 : 1;
        return aAllDay - bAllDay;
      }
      case "all_day_last": {
        const aAllDay = !a.task_time ? 1 : 0;
        const bAllDay = !b.task_time ? 1 : 0;
        return aAllDay - bAllDay;
      }
      case "none":
      default: return 0;
    }
  };

  // Available calendars for the visibility dropdown.
  const calendarsList = useMemo(() => deriveCalendars(tasks), [tasks]);

  const filteredTasks = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = tasks.filter((t) => {
      if (t.parent_id) return false;
      // Hide tasks belonging to a calendar the user has un-checked in
      // the visibility dropdown.
      if (hiddenCalendars.size > 0 && hiddenCalendars.has(calendarKeyForTask(t))) {
        return false;
      }
      if (!q) return true;
      return (
        t.title?.toLowerCase().includes(q) ||
        t.tags?.some((tag) => tag.toLowerCase().includes(q))
      );
    });
    const sorted = [...filtered].sort((a, b) => {
      for (const sv of sorts) {
        const r = compareFn(a, b, sv);
        if (r !== 0) return r;
      }
      return compareTaskTime(a.task_time, b.task_time, "asc");
    });
    return sorted;
  }, [tasks, search, sorts, priorityOrderMap, hiddenCalendars]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );
  const [activeTask, setActiveTask] = useState(null);
  const [overlayWidth, setOverlayWidth] = useState(null);
  const initialOverlayWidthRef = useRef(null);

  const handleDragStart = (event) => {
    const t = event.active?.data?.current?.task;
    if (t) setActiveTask(t);
    // Remember the dragged card's original rendered width so the overlay can
    // snap back to it when hovering over a non-calendar-section droppable.
    const rect = event.active?.rect?.current?.initial;
    initialOverlayWidthRef.current = rect?.width ?? null;
    setOverlayWidth(rect?.width ?? null);
  };

  const handleDragOver = (event) => {
    const overRect = event.over?.rect;
    const kind = event.over?.data?.current?.kind;
    // Only resize when hovering the two Day sections (timed / all-day).
    // For Week/Month we keep the card at its original width.
    if ((kind === "timed" || kind === "allday") && overRect?.width) {
      setOverlayWidth(overRect.width);
    } else {
      setOverlayWidth(initialOverlayWidthRef.current);
    }
  };
  const handleDragEnd = (event) => {
    setActiveTask(null);
    setOverlayWidth(null);
    initialOverlayWidthRef.current = null;
    const over = event.over;
    const task = event.active?.data?.current?.task;
    if (!over || !task) return;
    const overData = over.data?.current || {};
    const kind = overData.kind;

    if (kind === "allday") {
      const patch = { task_time: "", task_end_time: "" };
      if (overData.dateStr !== task.due_date) patch.due_date = overData.dateStr;
      updateTask(task.id, patch);
      return;
    }

    if (kind === "timed") {
      const dropRect = over.rect;
      const activeRect = event.active.rect?.current?.translated;
      const hourHeight = overData.hourHeight || 44;
      const yInDrop = activeRect && dropRect
        ? Math.max(0, activeRect.top - dropRect.top)
        : 0;
      const rawMins = (yInDrop / hourHeight) * 60;
      const snapped = Math.round(rawMins / 15) * 15;
      const clamped = Math.min(23 * 60 + 45, Math.max(0, snapped));
      const startStr = minutesToTaskTime(clamped);

      const prevStart = parseTaskTime(task.task_time);
      const prevEnd = parseTaskTime(task.task_end_time);
      const durationMin =
        prevStart != null && prevEnd != null && prevEnd > prevStart
          ? prevEnd - prevStart
          : 60;
      const endStr = minutesToTaskTime(Math.min(24 * 60, clamped + durationMin));

      updateTask(task.id, {
        due_date: overData.dateStr,
        task_time: startStr,
        task_end_time: endStr,
      });
      return;
    }

    if (kind === "day") {
      if (overData.dateStr !== task.due_date) {
        handleTaskReschedule(task, overData.dateStr);
      }
    }
  };
  const handleDragCancel = () => {
    setActiveTask(null);
    setOverlayWidth(null);
    initialOverlayWidthRef.current = null;
  };

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
    if (!activeIntegration) return;
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

  const scopedCount = useMemo(() => {
    if (!filteredTasks?.length) return 0;
    return filteredTasks.filter((t) => {
      if (!t.due_date) return false;
      const d = new Date(t.due_date + "T00:00:00");
      return isWithinInterval(d, viewRange);
    }).length;
  }, [filteredTasks, viewRange]);

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

  return (
    <div className="space-y-4">
      {/* Top row: title + count + centered empty-state link + actions */}
      <div className="flex items-center justify-between gap-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Calendar</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            {scopedCount} task{scopedCount !== 1 ? "s" : ""}
          </p>
        </div>
        {!integrationsConnected && (
          <div className="hidden lg:flex items-center shrink-0">
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 leading-none whitespace-nowrap">
              Connect Calendars in
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  navigate("/Settings", {
                    state: { scrollTo: "bottom" },
                  })
                }
                className="h-7 px-2 gap-1 text-xs font-medium text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <SettingsIcon className="w-3.5 h-3.5" />
                Settings
              </Button>
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0">
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
            onClick={() => {
              if (showSearch) setSearch("");
              setShowSearch((v) => !v);
            }}
          >
            <Search className="w-4 h-4" />
          </Button>
          <CalendarVisibilityDropdown
            calendars={calendarsList}
            hidden={hiddenCalendars}
            onChange={handleHiddenCalendarsChange}
          />
          <MultiSortPanel sorts={sorts} onSortsChange={handleSortsChange} page="calendar" />
          <Button
            onClick={openNewTask}
            className="bg-slate-900 hover:bg-slate-800 h-9 gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Task</span>
          </Button>
        </div>
      </div>

      {/* Second row: range label + tz / view switcher + nav arrows */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{rangeLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          {activeIntegration && (
            <div className="inline-flex items-center gap-1.5 mr-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSyncNow}
                disabled={syncing}
                className="h-8 px-2 gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                title="Sync calendars now"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", syncing && "animate-spin")} />
                <span className="hidden sm:inline">Sync</span>
              </Button>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 leading-none whitespace-nowrap hidden md:inline">
                {syncing ? "Syncing…" : lastSyncedLabel}
              </span>
            </div>
          )}
          <div className="inline-flex rounded-lg border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => handleViewChange(v)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-md capitalize transition-colors",
                  view === v
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
              onClick={goPrev}
              title="Previous"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <button
              type="button"
              onClick={goToday}
              className="text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-slate-100 px-2 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-800"
              title="Jump to today"
            >
              Today
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
              onClick={goNext}
              title="Next"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* View body — DnD wraps Month/Week (Day/Year use click nav) */}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
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

        <DragOverlay>
          {activeTask ? (
            <div
              className="ring-2 ring-slate-900 shadow-lg rounded transition-[width] duration-150 ease-out origin-center"
              style={overlayWidth ? { width: overlayWidth } : undefined}
            >
              <MiniMiniTaskCard
                task={activeTask}
                priorities={priorities}
                onClick={() => {}}
              />
            </div>
          ) : null}
        </DragOverlay>
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
        onSubmit={async (data, subtaskTitles = []) => {
          if (editingTask) {
            await updateTask(editingTask.id, data);
            const existingSubCount = (subtaskMap[editingTask.id] || []).length;
            for (let i = 0; i < subtaskTitles.length; i++) {
              await createTask({
                title: subtaskTitles[i],
                status: "todo",
                task_type: "one_time",
                parent_id: editingTask.id,
                order: existingSubCount + i,
              });
            }
          } else {
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
          }
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
