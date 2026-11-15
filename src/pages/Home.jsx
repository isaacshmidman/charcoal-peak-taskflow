// @ts-nocheck
/**
 * @file Home: the day and the week at a glance, on a page the person
 * arranges themselves. A grid of blocks (components/home/blocks.jsx),
 * each a small view of something another page shows in full.
 *
 * Customize turns the page into its own editor: every block grows
 * controls to move it earlier or later, set its width, or remove it, and
 * a tray lists the blocks that aren't on the page. Nothing is arranged
 * automatically and nothing moves by itself. The layout is saved to the
 * account (hooks/useHomeLayout.js).
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns/format";
import { Plus, SlidersHorizontal } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import HomeBlock from "@/components/home/HomeBlock";
import { DoneBlock, MonthBlock, NotesBlock, QuickAddBlock, ScheduleBlock, TagsBlock, TaskRows, WeekBlock } from "@/components/home/blocks";
import { useTaskDialogs } from "@/components/tasks/useTaskDialogs";
import { useCalendarOrderState } from "@/hooks/useCalendarOrder";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import { useShortcutEvent } from "@/hooks/useShortcutEvent";
import { useTodayStart } from "@/hooks/useTodayStart";
import {
  addBlock,
  blockName,
  dueToday,
  hiddenBlocks,
  monthGrid,
  moveBlock,
  nextSevenDays,
  overdueTasks,
  pinnedNotes,
  removeBlock,
  resizeBlock,
  scheduleToday,
  tagRanking,
  upcomingDeadlines,
  weekProgress,
} from "@/lib/home-blocks";
import { SHORTCUT_EVENTS } from "@/lib/shortcuts";
import { excludeExternalEvents } from "@/lib/task-filters";
import { openTasks } from "@/lib/task-views";

/** Where a block's heading leads: the page that shows the same thing in full. */
const LEADS_TO = {
  today: "/Today",
  schedule: "/Calendar",
  overdue: "/Today",
  deadlines: "/Active",
  notes: "/Notes",
  week: "/Calendar",
  tags: "/Active",
  done: "/Completed",
  month: "/Calendar",
};

export default function Home() {
  const [editing, setEditing] = useState(false);
  const { layout, isCustom, save } = useHomeLayout();
  const todayStart = useTodayStart();
  const { hidden: hiddenCalendars } = useCalendarOrderState();

  // Everything, calendar events included: the Schedule block shows them.
  const { data: everything = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiClient.entities.Task.list("-created_date", 5000),
  });
  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => apiClient.entities.Priority.list("order", 50),
  });
  const { data: savedTags = [] } = useQuery({
    queryKey: ["savedTags"],
    queryFn: () => apiClient.entities.SavedTag.list("name", 100),
  });
  const { data: notes = [] } = useQuery({
    queryKey: ["notes"],
    queryFn: () => apiClient.entities.Note.list("-updated_date", 500),
  });

  const tasks = useMemo(() => excludeExternalEvents(everything), [everything]);
  const ui = useTaskDialogs(tasks);

  const sortedPriorities = useMemo(() => [...priorities].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)), [priorities]);

  // Each block's content, worked out once per change to the data.
  const data = useMemo(() => {
    const priorityOrder = {};
    priorities.forEach((priority) => { priorityOrder[priority.id] = priority.order; });
    const open = openTasks(tasks, hiddenCalendars);
    return {
      today: dueToday(open, todayStart, priorityOrder),
      overdue: overdueTasks(open, todayStart),
      deadlines: upcomingDeadlines(open, todayStart),
      week: nextSevenDays(open, todayStart),
      progress: weekProgress(tasks, open, todayStart, hiddenCalendars),
      ranking: tagRanking(open),
      schedule: scheduleToday(everything, todayStart, hiddenCalendars),
      month: monthGrid(open, todayStart),
      pinned: pinnedNotes(notes),
    };
  }, [everything, tasks, priorities, notes, hiddenCalendars, todayStart]);

  // "n", the palette's New task, and the phone's + button.
  useShortcutEvent(SHORTCUT_EVENTS.newTask, () => ui.openNew());
  // The phone's +, pressed on a page with no form of its own, can land here.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!location.state?.newTask) return;
    ui.openNew();
    navigate(location.pathname, { replace: true, state: null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, location.pathname, navigate]);

  const weekTotal = data.week.reduce((sum, day) => sum + day.count, 0);
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

  /** A block's count beside its name, and its content. */
  const parts = {
    quick: {
      body: <QuickAddBlock priorities={sortedPriorities} savedTags={savedTags} todayStart={todayStart} onCreate={ui.createTask} />,
    },
    today: {
      count: data.today.length,
      body: <TaskRows tasks={data.today} most={8} to="/Today" empty="Nothing due today." meta="time" ui={ui} priorities={priorities} />,
    },
    schedule: {
      count: data.schedule.length || "",
      body: <ScheduleBlock rows={data.schedule} onEditTask={ui.edit} />,
    },
    overdue: {
      count: data.overdue.length,
      body: <TaskRows tasks={data.overdue} most={5} to="/Today" empty="Nothing overdue." late ui={ui} priorities={priorities} />,
    },
    deadlines: {
      count: "next 14 days",
      body: <TaskRows tasks={data.deadlines} most={6} to="/Active" empty="Nothing due in the next two weeks." ui={ui} priorities={priorities} />,
    },
    notes: {
      count: data.pinned.length || "",
      body: <NotesBlock notes={data.pinned} />,
    },
    week: {
      count: plural(weekTotal, "task"),
      body: <WeekBlock days={data.week} />,
    },
    tags: {
      count: "open tasks",
      body: <TagsBlock ranking={data.ranking} />,
    },
    done: {
      body: <DoneBlock progress={data.progress} />,
    },
    month: {
      count: data.month.label,
      body: <MonthBlock grid={data.month} />,
    },
  };

  const tray = hiddenBlocks(layout);

  return (
    <div className="space-y-4" data-testid="home" data-editing={editing || undefined}>
      <PageHeader title="Home" sub={format(todayStart, "EEEE, MMMM d")}>
        {editing ? (
          <>
            {isCustom && (
              <Button type="button" variant="ghost" className="h-9" onClick={() => save(null)}>
                Reset
              </Button>
            )}
            <Button type="button" className="h-9" onClick={() => setEditing(false)}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" className="h-9 gap-1.5" onClick={() => setEditing(true)}>
              <SlidersHorizontal className="h-4 w-4" />
              Customize
            </Button>
            <Button aria-label="New Task" onClick={() => ui.openNew()} className="hidden h-9 gap-1.5 sm:inline-flex">
              <Plus className="h-4 w-4" />
              New task
            </Button>
          </>
        )}
      </PageHeader>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-hidden="true">
          {["xl:col-span-3", "xl:col-span-3", "xl:col-span-2", "xl:col-span-2", "xl:col-span-2"].map((span, index) => (
            <div key={index} className={`h-40 animate-pulse rounded-xl border border-border-hairline bg-surface-card ${span}`} />
          ))}
        </div>
      ) : layout.length === 0 && !editing ? (
        <div className="py-16 text-center">
          <p className="text-[13px] text-ink-500 dark:text-ink-400">Home is empty.</p>
          <Button type="button" variant="outline" className="mt-3 h-9" onClick={() => setEditing(true)}>
            Add blocks
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {layout.map((block, index) => (
            <HomeBlock
              key={block.id}
              id={block.id}
              name={blockName(block.id)}
              size={block.size}
              count={parts[block.id]?.count}
              to={LEADS_TO[block.id]}
              editing={editing}
              first={index === 0}
              last={index === layout.length - 1}
              onMove={(step) => save(moveBlock(layout, block.id, step))}
              onResize={(size) => save(resizeBlock(layout, block.id, size))}
              onRemove={() => save(removeBlock(layout, block.id))}
            >
              {parts[block.id]?.body}
            </HomeBlock>
          ))}
        </div>
      )}

      {editing && (
        <section
          aria-label="Add a block"
          data-testid="home-tray"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-ink-300 px-3.5 py-3 dark:border-ink-600"
        >
          <h2 className="mr-1 text-[13px] font-semibold text-ink-800 dark:text-ink-200">Add a block</h2>
          {tray.length === 0 ? (
            <p className="text-[13px] text-ink-400 dark:text-ink-500">Every block is on the page.</p>
          ) : (
            tray.map((block) => (
              <Button
                key={block.id}
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => save(addBlock(layout, block.id))}
                aria-label={`Add ${block.name}`}
              >
                <Plus className="h-3.5 w-3.5" />
                {block.name}
              </Button>
            ))
          )}
        </section>
      )}

      {ui.dialogs}
    </div>
  );
}
