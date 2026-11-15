import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOME_LAYOUT,
  HOME_BLOCKS,
  addBlock,
  dueToday,
  hiddenBlocks,
  monthGrid,
  moveBlock,
  nextSevenDays,
  overdueTasks,
  pinnedNotes,
  removeBlock,
  resizeBlock,
  resolveHomeLayout,
  scheduleToday,
  tagRanking,
  upcomingDeadlines,
  weekProgress,
} from "./home-blocks";

const today = new Date(2026, 10, 14); // Sat 14 Nov 2026, midnight
const ids = (rows) => rows.map((row) => row.id);

describe("the Home layout", () => {
  it("starts with every block, each row adding up to the full width", () => {
    expect(ids(DEFAULT_HOME_LAYOUT).sort()).toEqual(ids(HOME_BLOCKS).sort());
    const width = { third: 2, half: 3, full: 6 };
    const columns = DEFAULT_HOME_LAYOUT.reduce((sum, block) => sum + width[block.size], 0);
    expect(columns % 6).toBe(0);
  });

  it("uses the starting layout only when nothing was ever saved", () => {
    expect(resolveHomeLayout(null)).toBe(DEFAULT_HOME_LAYOUT);
    expect(resolveHomeLayout(undefined)).toBe(DEFAULT_HOME_LAYOUT);
    // Every block removed is a choice, not an absence.
    expect(resolveHomeLayout([])).toEqual([]);
  });

  it("drops what it doesn't know and repairs the rest", () => {
    expect(
      resolveHomeLayout([
        { id: "tags", size: "full" },
        { id: "weather", size: "half" },
        { id: "tags", size: "third" },
        { id: "today", size: "huge" },
        null,
      ]),
    ).toEqual([
      { id: "tags", size: "full" },
      { id: "today", size: "third" },
    ]);
  });

  it("moves, resizes, removes and adds, and leaves the original alone", () => {
    const layout = [
      { id: "today", size: "half" },
      { id: "tags", size: "half" },
      { id: "week", size: "full" },
    ];
    expect(ids(moveBlock(layout, "tags", -1))).toEqual(["tags", "today", "week"]);
    expect(ids(moveBlock(layout, "tags", 1))).toEqual(["today", "week", "tags"]);
    // Already at an end: nothing changes.
    expect(moveBlock(layout, "today", -1)).toBe(layout);
    expect(moveBlock(layout, "week", 1)).toBe(layout);

    expect(resizeBlock(layout, "tags", "third")[1]).toEqual({ id: "tags", size: "third" });
    expect(resizeBlock(layout, "tags", "giant")).toBe(layout);

    expect(ids(removeBlock(layout, "tags"))).toEqual(["today", "week"]);

    const added = addBlock(layout, "quick");
    expect(added.at(-1)).toEqual({ id: "quick", size: "full" });
    expect(addBlock(layout, "today")).toBe(layout);
    expect(addBlock(layout, "weather")).toBe(layout);
    expect(ids(layout)).toEqual(["today", "tags", "week"]);
  });

  it("lists the blocks that aren't on the page", () => {
    expect(hiddenBlocks(DEFAULT_HOME_LAYOUT)).toEqual([]);
    expect(ids(hiddenBlocks([{ id: "today", size: "half" }]))).not.toContain("today");
    expect(hiddenBlocks([]).length).toBe(HOME_BLOCKS.length);
  });
});

describe("what the Home blocks show", () => {
  const open = [
    { id: "late", title: "Invoice", due_date: "2026-11-12" },
    { id: "later", title: "Electricity", due_date: "2026-11-13", task_time: "9:00AM" },
    { id: "noon", title: "Passport", due_date: "2026-11-14", task_time: "12:30PM", priority_id: "low" },
    { id: "morning", title: "Back up", due_date: "2026-11-14", task_time: "10:30AM", priority_id: "low", tags: ["home"] },
    { id: "anyHigh", title: "Dentist", due_date: "2026-11-14", priority_id: "high", tags: ["home", "health"] },
    { id: "anyLow", title: "Plants", due_date: "2026-11-14", priority_id: "low", tags: ["home"] },
    { id: "tomorrow", title: "Landlord", due_date: "2026-11-15", tags: ["home"] },
    { id: "fortnight", title: "Budget", due_date: "2026-11-28", tags: ["work"] },
    { id: "far", title: "Taxes", due_date: "2026-11-29", tags: ["work"] },
    { id: "someday", title: "Learn the cello" },
  ];
  const priorityOrder = { high: 0, low: 2 };

  it("Today: due today only, timed first in order, then by priority", () => {
    expect(ids(dueToday(open, today, priorityOrder))).toEqual(["morning", "noon", "anyHigh", "anyLow"]);
  });

  it("Overdue: before today, longest overdue first; with Today it is the Today page's list", () => {
    expect(ids(overdueTasks(open, today))).toEqual(["late", "later"]);
    const byToday = open.filter((task) => task.due_date && task.due_date <= "2026-11-14");
    expect(dueToday(open, today).length + overdueTasks(open, today).length).toBe(byToday.length);
  });

  it("Deadlines: after today, up to a fortnight out, soonest first", () => {
    expect(ids(upcomingDeadlines(open, today))).toEqual(["tomorrow", "fortnight"]);
    expect(ids(upcomingDeadlines(open, today, 1))).toEqual(["tomorrow"]);
  });

  it("Next 7 days: today and the six after, each with its count", () => {
    const days = nextSevenDays(open, today);
    expect(days.map((day) => day.key)).toEqual([
      "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20",
    ]);
    expect(days.map((day) => day.count)).toEqual([4, 1, 0, 0, 0, 0, 0]);
    expect(days.map((day) => day.label)[0]).toBe("Sat");
    expect(days.filter((day) => day.isToday).map((day) => day.key)).toEqual(["2026-11-14"]);
  });

  it("By tag: busiest first, a tie by name, bars measured against the busiest", () => {
    expect(tagRanking(open)).toEqual([
      { tag: "home", count: 4, share: 1 },
      { tag: "work", count: 2, share: 0.5 },
      { tag: "health", count: 1, share: 0.25 },
    ]);
    expect(tagRanking([{ id: "x" }])).toEqual([]);
  });

  it("Done this week: finished since Sunday, and what is still due by Saturday", () => {
    const sunday = new Date(2026, 10, 8, 9).toISOString();
    const lastWeek = new Date(2026, 10, 7, 23).toISOString();
    const tasks = [
      ...open,
      { id: "d1", status: "done", completed_at: sunday },
      { id: "d2", status: "done", completed_at: new Date(2026, 10, 14, 8).toISOString() },
      { id: "old", status: "done", completed_at: lastWeek },
      { id: "sub", status: "done", completed_at: sunday, parent_id: "d1" },
      { id: "undated", status: "done", completed_at: "" },
      { id: "hidden", status: "done", completed_at: sunday, source_provider: "google", source_calendar_id: "work" },
    ];
    // Left: the two overdue and the four due today (Saturday ends the week).
    expect(weekProgress(tasks, open, today, new Set(["google:work"]))).toEqual({ done: 2, left: 6, total: 8 });
    expect(weekProgress(tasks, open, today).done).toBe(3);
    expect(weekProgress([], [], today)).toEqual({ done: 0, left: 0, total: 0 });
  });

  it("Schedule: today's events and timed open tasks, all-day first, then by the clock", () => {
    const everything = [
      ...open,
      { id: "standup", title: "Team check-in", due_date: "2026-11-14", task_time: "9:00AM", task_end_time: "9:30AM", source_kind: "event", source_calendar_name: "Work", source_color_hex: "#3366cc" },
      { id: "holiday", title: "Holiday", due_date: "2026-11-14", source_kind: "event" },
      { id: "secret", title: "Hidden", due_date: "2026-11-14", task_time: "8:00AM", source_kind: "event", source_provider: "google", source_calendar_id: "x" },
      { id: "elsewhere", title: "Tomorrow's", due_date: "2026-11-15", task_time: "8:00AM", source_kind: "event" },
      { id: "finished", title: "Done", due_date: "2026-11-14", task_time: "7:00AM", status: "done" },
      { id: "part", title: "A subtask", due_date: "2026-11-14", task_time: "7:00AM", parent_id: "noon" },
    ];
    const rows = scheduleToday(everything, today, new Set(["google:x"]));
    expect(ids(rows)).toEqual(["holiday", "standup", "morning", "noon"]);
    expect(rows[0]).toMatchObject({ isEvent: true, start: null });
    expect(rows[1]).toMatchObject({ isEvent: true, start: 540, end: 570, calendar: "Work", color: "#3366cc" });
    expect(rows[2]).toMatchObject({ isEvent: false, start: 630 });
  });

  it("Month: whole weeks from Sunday, today marked, counts on their days", () => {
    const { label, weeks } = monthGrid(open, today);
    expect(label).toBe("November");
    // November 2026 starts on a Sunday and ends on a Monday: five weeks.
    expect(weeks.length).toBe(5);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0][0]).toMatchObject({ key: "2026-11-01", inMonth: true });
    expect(weeks[4][1]).toMatchObject({ key: "2026-11-30", inMonth: true });
    expect(weeks[4][2]).toMatchObject({ key: "2026-12-01", inMonth: false });
    const flat = weeks.flat();
    expect(flat.filter((day) => day.isToday).map((day) => day.key)).toEqual(["2026-11-14"]);
    expect(flat.find((day) => day.key === "2026-11-14").count).toBe(4);
    expect(flat.find((day) => day.key === "2026-11-16").count).toBe(0);
    // A month that starts midweek is padded from the month before.
    const october = monthGrid([], new Date(2026, 9, 10));
    expect(october.weeks[0][0]).toMatchObject({ key: "2026-09-27", inMonth: false });
    expect(october.weeks[0][4]).toMatchObject({ key: "2026-10-01", inMonth: true });
  });

  it("Pinned notes: only pinned, most recently edited first", () => {
    const notes = [
      { id: "a", pinned: true, updated_date: "2026-11-10T10:00:00Z" },
      { id: "b", pinned: false, updated_date: "2026-11-14T10:00:00Z" },
      { id: "c", pinned: true, updated_date: "2026-11-13T10:00:00Z" },
    ];
    expect(ids(pinnedNotes(notes))).toEqual(["c", "a"]);
  });
});
