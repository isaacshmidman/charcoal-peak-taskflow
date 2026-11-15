// @ts-nocheck
/**
 * @file Home: the day and the week at a glance, on a page the person
 * arranges themselves. A grid of blocks (components/home/blocks.jsx),
 * each a small view of something another page shows in full.
 *
 * Customize turns the page into its own editor. A block is dragged by
 * its grip to another place; its settings button holds everything else
 * about it (how wide, its own few settings, earlier or later for the
 * keyboard); the x removes it. A tray at the top lists the blocks that
 * aren't on the page. Nothing is arranged automatically and nothing moves
 * by itself. Every change is saved as it is made, to the account
 * (hooks/useHomeLayout.js).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DndContext, PointerSensor, TouchSensor, pointerWithin, useSensor, useSensors } from "@dnd-kit/core";
import { format } from "date-fns/format";
import { Plus, SlidersHorizontal } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import HomeBlock, { HomeBlockOutline } from "@/components/home/HomeBlock";
import { awaitingFirstAnswer } from "@/lib/loading";
import { DoneBlock, MonthBlock, NotesBlock, ScheduleBlock, TagsBlock, TaskRows, WeekBlock } from "@/components/home/blocks";
import { showDeleteToast } from "@/components/tasks/DeleteToast";
import { useTaskDialogs } from "@/components/tasks/useTaskDialogs";
import { useCalendarOrderState } from "@/hooks/useCalendarOrder";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import { useShortcutEvent } from "@/hooks/useShortcutEvent";
import { useTodayStart } from "@/hooks/useTodayStart";
import {
  BLOCK_SETTINGS,
  addBlock,
  blockName,
  blockOptions,
  dayAgenda,
  dueToday,
  eventDays,
  finishedThisWeek,
  hiddenBlocks,
  moveBlock,
  moveBlockTo,
  nextSevenDays,
  overdueTasks,
  pinnedNotes,
  removeBlock,
  resizeBlock,
  scheduleToday,
  setBlockOption,
  tagRanking,
  tasksWithTag,
  upcomingDeadlines,
  weekProgress,
} from "@/lib/home-blocks";
import { SHORTCUT_EVENTS } from "@/lib/shortcuts";
import { excludeExternalEvents } from "@/lib/task-filters";
import { openTasks } from "@/lib/task-views";
import { taskPagePath } from "@/hooks/useTagFilter";

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

const SETTING_LABELS = { rows: "Rows", days: "Days ahead" };

/** One line of a block's settings: what it is, then the control. */
function SettingRow({ label, children }) {
  return (
    <>
      <span className="text-[12px] text-ink-500 dark:text-ink-400">{label}</span>
      <div className="min-w-0">{children}</div>
    </>
  );
}

/** One of a block's settings that is a choice of a few numbers. */
function ChoiceSetting({ block, name, value, choices, onChange }) {
  const label = SETTING_LABELS[name] || name;
  return (
    <SettingRow label={label}>
      <div role="group" aria-label={`${label} in ${block}`} className="ds-seg w-full">
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            className="ds-seg-item h-7 flex-1 px-1.5 text-[12px] tabular-nums"
            aria-pressed={value === choice}
            onClick={() => onChange(choice)}
          >
            {choice === 0 ? "None" : choice}
          </button>
        ))}
      </div>
    </SettingRow>
  );
}

/** One empty list, the same one every time, so the page's sums don't rerun on each draw. */
const NOTHING = [];

export default function Home() {
  const [editing, setEditing] = useState(false);
  const { layout, isCustom, isLoading: layoutLoading, save } = useHomeLayout();
  const todayStart = useTodayStart();
  const { hidden: hiddenCalendars } = useCalendarOrderState();

  // Everything, calendar events included: the Schedule block shows them.
  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiClient.entities.Task.list("-created_date", 5000),
  });
  const everything = tasksQuery.data || NOTHING;
  // Outlines until there is something true to show: the tasks, and how
  // this person arranged the page.
  const isLoading = layoutLoading || awaitingFirstAnswer(tasksQuery);
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

  // Each block's own settings (rows, days ahead, which tag), as they stand.
  const options = useMemo(() => Object.fromEntries(layout.map((block) => [block.id, blockOptions(block)])), [layout]);
  const deadlineDays = options.deadlines?.days ?? BLOCK_SETTINGS.deadlines.days.start;
  const chosenTag = options.tag?.tag || "";

  // Each block's content, worked out once per change to the data.
  const data = useMemo(() => {
    const priorityOrder = {};
    priorities.forEach((priority) => { priorityOrder[priority.id] = priority.order; });
    const open = openTasks(tasks, hiddenCalendars);
    return {
      open,
      priorityOrder,
      today: dueToday(open, todayStart, priorityOrder),
      overdue: overdueTasks(open, todayStart),
      deadlines: upcomingDeadlines(open, todayStart, deadlineDays),
      oneTag: tasksWithTag(open, chosenTag),
      week: nextSevenDays(open, todayStart),
      progress: weekProgress(tasks, open, todayStart, hiddenCalendars),
      finished: finishedThisWeek(tasks, todayStart, hiddenCalendars),
      ranking: tagRanking(open),
      schedule: scheduleToday(everything, todayStart, hiddenCalendars),
      eventsOn: eventDays(everything, hiddenCalendars),
      pinned: pinnedNotes(notes),
    };
  }, [everything, tasks, priorities, notes, hiddenCalendars, todayStart, deadlineDays, chosenTag]);

  // What is on any one day, for the panel a day opens (the week's bars, the month's days).
  const agendaFor = useCallback(
    (day) => dayAgenda(data.open, everything, day, hiddenCalendars, data.priorityOrder),
    [data.open, data.priorityOrder, everything, hiddenCalendars],
  );

  // Dragging a block by its grip. A small movement first, so a press on
  // the grip that isn't a drag stays a press; on a touch screen a short
  // hold, so the page can still be scrolled past the grips.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const next = moveBlockTo(layout, String(active.id), String(over.id));
    if (next !== layout) save(next);
  };

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

  const rowsOf = (id) => options[id]?.rows ?? BLOCK_SETTINGS[id]?.rows?.start;
  // The tags someone can point the "One tag" block at: every tag in use or saved.
  const tagChoices = useMemo(
    () => [...new Set([...savedTags.map((tag) => tag.name), ...data.ranking.map((row) => row.tag)])].filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [savedTags, data.ranking],
  );

  /** A block's count beside its name, and its content. */
  const parts = {
    today: {
      count: data.today.length,
      body: <TaskRows tasks={data.today} most={rowsOf("today")} to="/Today" empty="Nothing due today." meta="time" ui={ui} priorities={priorities} />,
    },
    schedule: {
      count: data.schedule.length || "",
      body: <ScheduleBlock rows={data.schedule} most={rowsOf("schedule")} onOpen={ui.edit} />,
    },
    overdue: {
      count: data.overdue.length,
      body: <TaskRows tasks={data.overdue} most={rowsOf("overdue")} to="/Today" empty="Nothing overdue." late ui={ui} priorities={priorities} />,
    },
    deadlines: {
      count: `next ${deadlineDays} days`,
      body: (
        <TaskRows
          tasks={data.deadlines}
          most={rowsOf("deadlines")}
          to="/Active"
          empty={`Nothing due in the next ${deadlineDays} days.`}
          ui={ui}
          priorities={priorities}
        />
      ),
    },
    notes: {
      count: data.pinned.length || "",
      body: <NotesBlock notes={data.pinned} most={rowsOf("notes")} />,
    },
    week: {
      count: plural(weekTotal, "task"),
      body: <WeekBlock days={data.week} agendaFor={agendaFor} ui={ui} priorities={priorities} />,
    },
    tags: {
      count: "open tasks",
      body: <TagsBlock ranking={data.ranking} most={rowsOf("tags")} />,
    },
    done: {
      body: <DoneBlock progress={data.progress} recent={data.finished} most={rowsOf("done")} ui={ui} priorities={priorities} />,
    },
    month: {
      body: <MonthBlock open={data.open} todayStart={todayStart} eventsOn={data.eventsOn} agendaFor={agendaFor} ui={ui} priorities={priorities} />,
    },
    tag: {
      // Named after its tag once one is chosen, and its heading leads there.
      name: chosenTag ? `#${chosenTag}` : undefined,
      to: chosenTag ? taskPagePath("/Active", chosenTag) : undefined,
      count: chosenTag ? data.oneTag.length : "",
      body: chosenTag ? (
        <TaskRows
          tasks={data.oneTag}
          most={rowsOf("tag")}
          to={taskPagePath("/Active", chosenTag)}
          empty="Nothing open with this tag."
          ui={ui}
          priorities={priorities}
        />
      ) : (
        <p className="px-3 pb-4 pt-0.5 text-[13px] text-ink-400 dark:text-ink-500">Choose a tag in Customize.</p>
      ),
    },
  };

  /** The controls for a block's own settings, for its settings panel while customizing. */
  const settingsFor = (block) => {
    const spec = BLOCK_SETTINGS[block.id];
    if (!spec) return null;
    const name = blockName(block.id);
    return (
      <>
        {block.id === "tag" && (
          <SettingRow label="Tag">
            <Select
              value={chosenTag}
              // Radix's hidden native <select> can report "" as it mounts.
              onValueChange={(value) => { if (value) save(setBlockOption(layout, "tag", "tag", value)); }}
            >
              <SelectTrigger aria-label="Which tag this block shows" className="h-8 w-full gap-2 px-2 text-[12px]">
                <SelectValue placeholder="Choose a tag" />
              </SelectTrigger>
              <SelectContent>
                {/* A tag chosen earlier and since removed from every task stays listed, so it isn't silently swapped. */}
                {[...new Set([...(chosenTag ? [chosenTag] : []), ...tagChoices])].map((tag) => (
                  <SelectItem key={tag} value={tag}>{tag}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        )}
        {Object.entries(spec)
          .filter(([, setting]) => setting.choices)
          .map(([key, setting]) => (
            <ChoiceSetting
              key={key}
              block={name}
              name={key}
              value={options[block.id]?.[key]}
              choices={setting.choices}
              onChange={(value) => save(setBlockOption(layout, block.id, key, value))}
            />
          ))}
      </>
    );
  };

  /** Back to the starting layout, with a way back: it is someone's own arrangement being thrown away. */
  const reset = async () => {
    const before = layout;
    if (await save(null)) {
      showDeleteToast({ label: "Home is back to its starting layout.", onUndo: () => save(before), duration: 8000 });
    }
  };

  const tray = hiddenBlocks(layout);

  return (
    <div className="space-y-4" data-testid="home" data-editing={editing || undefined}>
      <PageHeader title="Home" sub={format(todayStart, "EEEE, MMMM d")}>
        {editing ? (
          <>
            {isCustom && (
              <Button type="button" variant="ghost" className="h-9" onClick={reset}>
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

      {editing && (
        <section
          aria-label="Add a block"
          data-testid="home-tray"
          className="rounded-xl border border-dashed border-ink-300 px-3.5 py-3 dark:border-ink-600"
        >
          <p className="text-[13px] text-ink-600 dark:text-ink-300">
            Drag a block by its grip to move it. Its settings button changes how wide it is and what it shows. Everything is saved as you go.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
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
                  onClick={() => {
                    // First on the page, right under this tray, where it can be seen and dragged from.
                    const added = addBlock(layout, block.id, "first");
                    // "One tag" arrives pointed at the busiest tag rather than at nothing.
                    const busiest = data.ranking[0]?.tag;
                    save(block.id === "tag" && busiest ? setBlockOption(added, "tag", "tag", busiest) : added);
                  }}
                  aria-label={`Add ${block.name}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {block.name}
                </Button>
              ))
            )}
          </div>
        </section>
      )}

      {isLoading ? (
        // The page as it will be laid out, each block an outline of itself.
        <div
          role="status"
          aria-label="Loading"
          aria-busy="true"
          data-testid="placeholder"
          className="grid animate-pulse grid-cols-1 items-stretch gap-3 motion-reduce:animate-none sm:grid-cols-2 xl:grid-cols-6"
        >
          {layout.map((block) => (
            <HomeBlockOutline key={block.id} size={block.size} rows={block.id === "quick" ? 1 : 3} />
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
        <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {layout.map((block, index) => (
              <HomeBlock
                key={block.id}
                id={block.id}
                name={parts[block.id]?.name || blockName(block.id)}
                size={block.size}
                count={parts[block.id]?.count}
                to={parts[block.id]?.to || LEADS_TO[block.id]}
                editing={editing}
                first={index === 0}
                last={index === layout.length - 1}
                settings={settingsFor(block)}
                onMove={(step) => save(moveBlock(layout, block.id, step))}
                onResize={(size) => save(resizeBlock(layout, block.id, size))}
                onRemove={() => save(removeBlock(layout, block.id))}
              >
                {parts[block.id]?.body}
              </HomeBlock>
            ))}
          </div>
        </DndContext>
      )}

      {ui.dialogs}
    </div>
  );
}
