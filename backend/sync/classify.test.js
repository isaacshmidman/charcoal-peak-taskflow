/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { classifyCalendarItem } from "./classify.js";

const cal = (over = {}) => ({
  access_role: "owner",
  summary: "Personal",
  item_kind: "event",
  ...over,
});

describe("classifyCalendarItem", () => {
  it("defaults a writable calendar to events", () => {
    // The bug this whole change exists to fix: a writable calendar used to
    // mean "everything on it is a task", so every meeting on the user's own
    // calendar became an overdue task.
    expect(classifyCalendarItem(cal())).toBe("event");
  });

  it("returns tasks only when the calendar is marked item_kind='task'", () => {
    expect(classifyCalendarItem(cal({ item_kind: "task" }))).toBe("task");
    expect(classifyCalendarItem(cal({ item_kind: "task" }), { eventType: "default" })).toBe("task");
  });

  it("never calls a read-only calendar's items tasks, even if marked", () => {
    // Marking is blocked by the API, but the read path must not trust that:
    // a task here would be re-datable, and we can't push the change back.
    for (const role of ["reader", "freeBusyReader", null, undefined]) {
      expect(classifyCalendarItem(cal({ access_role: role, item_kind: "task" }))).toBe("event");
    }
  });

  it("keeps special Google event types as events on a task calendar", () => {
    const taskCal = cal({ item_kind: "task" });
    for (const eventType of [
      "birthday",
      "fromGmail",
      "outOfOffice",
      "focusTime",
      "workingLocation",
    ]) {
      expect(classifyCalendarItem(taskCal, { eventType })).toBe("event");
    }
  });

  it("treats a missing calendar row as an event", () => {
    // No row means no user choice to honor — events are the safe side,
    // since they never reach the date mover.
    expect(classifyCalendarItem(null)).toBe("event");
    expect(classifyCalendarItem(undefined, { eventType: "default" })).toBe("event");
  });

  it("ignores the calendar name — naming is no longer a signal", () => {
    // The old rule sniffed for "holiday"/"birthday" in the summary. Those
    // calendars are read-only in practice and now default to events anyway,
    // so a calendar called "Holiday planning" marked Tasks stays tasks.
    expect(classifyCalendarItem(cal({ summary: "Holidays", item_kind: "task" }))).toBe("task");
    expect(classifyCalendarItem(cal({ summary: "Birthdays", item_kind: "task" }))).toBe("task");
  });
});
