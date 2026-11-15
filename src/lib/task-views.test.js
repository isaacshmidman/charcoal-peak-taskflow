import { describe, expect, it } from "vitest";
import { dueDay, hasTag, isDueByToday, isOpenTopLevel, isOverdue, openTasks, tagCounts } from "./task-views";

const today = new Date(2026, 10, 14); // Sat 14 Nov 2026, midnight

describe("which tasks belong where", () => {
  it("counts a task of its own that isn't done, and nothing else", () => {
    expect(isOpenTopLevel({ status: "todo" })).toBe(true);
    expect(isOpenTopLevel({ status: "done" })).toBe(false);
    expect(isOpenTopLevel({ status: "todo", parent_id: "p" })).toBe(false);
  });

  it("leaves out tasks on a hidden calendar", () => {
    const tasks = [
      { id: "a", status: "todo" },
      { id: "b", status: "todo", source_provider: "google", source_calendar_id: "work" },
    ];
    expect(openTasks(tasks).map((t) => t.id)).toEqual(["a", "b"]);
    expect(openTasks(tasks, new Set(["google:work"])).map((t) => t.id)).toEqual(["a"]);
  });

  it("reads a due date as a local day", () => {
    expect(dueDay({ due_date: "2026-11-14" })?.getTime()).toBe(today.getTime());
    expect(dueDay({ due_date: "" })).toBe(null);
    expect(dueDay({ due_date: "not a date" })).toBe(null);
  });

  it("puts today and earlier on Today, and only earlier in Overdue", () => {
    expect(isDueByToday({ due_date: "2026-11-14" }, today)).toBe(true);
    expect(isDueByToday({ due_date: "2026-11-13" }, today)).toBe(true);
    expect(isDueByToday({ due_date: "2026-11-15" }, today)).toBe(false);
    expect(isDueByToday({}, today)).toBe(false);
    expect(isOverdue({ due_date: "2026-11-14" }, today)).toBe(false);
    expect(isOverdue({ due_date: "2026-11-13" }, today)).toBe(true);
  });

  it("counts tags, keeps saved ones at zero, and sorts by name", () => {
    const tasks = [{ tags: ["work", "home"] }, { tags: ["work"] }, { tags: null }, {}];
    expect(tagCounts(tasks, [{ name: "errands" }, { name: "home" }])).toEqual([
      { tag: "errands", count: 0 },
      { tag: "home", count: 1 },
      { tag: "work", count: 2 },
    ]);
    expect(hasTag(tasks[0], "home")).toBe(true);
    expect(hasTag(tasks[2], "home")).toBe(false);
  });
});
