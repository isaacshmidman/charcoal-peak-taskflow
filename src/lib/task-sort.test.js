import { describe, expect, it } from "vitest";
import { compareTasks, compareTasksBy } from "./task-sort";
import { compareDueDateTime } from "./sort-helpers";
import { compareByCalendarOrder } from "./calendar-order";

/**
 * The comparator the four task lists each carried before task-sort.js,
 * frozen verbatim (Today's copy, plus the Calendar's two all-day keys and
 * Groupings' guard on calendar order). The shared one must agree with it
 * on every key for every pair, so the refactor changes no list's order.
 */
function legacyCompare(a, b, sortValue, priorityOrderMap, calendarIndexByKey) {
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
    case "completed_first": return (a.status === "done" ? 0 : 1) - (b.status === "done" ? 0 : 1);
    case "uncompleted_first": return (a.status !== "done" ? 0 : 1) - (b.status !== "done" ? 0 : 1);
    case "calendar_order": return calendarIndexByKey ? compareByCalendarOrder(a, b, calendarIndexByKey) : 0;
    case "all_day_first": return (!a.task_time ? 0 : 1) - (!b.task_time ? 0 : 1);
    case "all_day_last": return (!a.task_time ? 1 : 0) - (!b.task_time ? 1 : 0);
    default: return 0;
  }
}

const KEYS = [
  "priority_asc", "priority_desc", "date_asc", "date_desc", "tag_az", "recurrence",
  "completed_first", "uncompleted_first", "calendar_order", "all_day_first", "all_day_last", "none",
];

// A deterministic spread of tasks covering blanks, ties and every field.
const tasks = [];
const pick = (arr, i) => arr[i % arr.length];
for (let i = 0; i < 40; i += 1) {
  tasks.push({
    id: `t${i}`,
    priority_id: pick(["p1", "p2", "p3", "", "unknown"], i),
    due_date: pick(["2026-09-24", "2026-09-25", "", "2026-10-01"], i * 3),
    task_time: pick(["", "9:00AM", "2:30PM", "11:45PM"], i * 7),
    tags: pick([[], ["work"], ["home", "x"], ["Work"], [""]], i * 5),
    task_type: pick(["one_time", "recurring"], i),
    recurrence: pick(["daily", "weekly", "", "custom_days"], i * 11),
    status: pick(["todo", "done"], i * 13),
    source_provider: pick(["", "google", "apple"], i),
    source_calendar_id: pick(["", "cal-a", "cal-b"], i * 2),
  });
}
const priorityOrderMap = { p1: 0, p2: 1, p3: 2 };

describe("compareTasks", () => {
  it("agrees with the old per-page comparator on every key and pair", () => {
    for (const calendarIndexByKey of [null, new Map([["google:cal-a", 0], ["apple:cal-b", 1]])]) {
      for (const key of KEYS) {
        for (const a of tasks) {
          for (const b of tasks) {
            const expected = Math.sign(legacyCompare(a, b, key, priorityOrderMap, calendarIndexByKey));
            const actual = Math.sign(compareTasks(a, b, key, { priorityOrderMap, calendarIndexByKey }));
            if (actual !== expected) {
              throw new Error(`${key}: ${a.id} vs ${b.id} — expected ${expected}, got ${actual}`);
            }
          }
        }
      }
    }
  });

  it("puts blank tags and non-recurring tasks last", () => {
    const tagged = { tags: ["b"] };
    const blank = { tags: [] };
    expect(compareTasks(blank, tagged, "tag_az")).toBe(1);
    expect(compareTasks({ task_type: "one_time" }, { task_type: "recurring", recurrence: "daily" }, "recurrence")).toBe(1);
  });
});

describe("compareTasksBy", () => {
  it("falls through keys until one breaks the tie", () => {
    const a = { priority_id: "p1", due_date: "2026-09-25", status: "todo" };
    const b = { priority_id: "p1", due_date: "2026-09-24", status: "todo" };
    expect(compareTasksBy(a, b, ["priority_asc", "date_asc"], { priorityOrderMap })).toBeGreaterThan(0);
    expect(compareTasksBy(a, b, ["priority_asc"], { priorityOrderMap })).toBe(0);
  });
});
