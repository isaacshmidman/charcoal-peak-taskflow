/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { parseReminder } from "./reminders.js";
import { getTaskNotificationTime, sanitizeNotificationSettings } from "./notifications.js";

describe("parseReminder", () => {
  it("reads each rule", () => {
    expect(parseReminder("")).toEqual({ kind: "default" });
    expect(parseReminder(null)).toEqual({ kind: "default" });
    expect(parseReminder("none")).toEqual({ kind: "none" });
    expect(parseReminder("before:15")).toEqual({ kind: "before", minutes: 15 });
    expect(parseReminder("before:0")).toEqual({ kind: "before", minutes: 0 });
    expect(parseReminder("at:8:30AM")).toEqual({ kind: "at", minutes: 8 * 60 + 30 });
  });

  it("treats anything unrecognised as the default, never as silence", () => {
    for (const junk of ["before:-5", "before:abc", "before:999999", "at:25:00PM", "at:", "soon", "NONE "]) {
      expect(parseReminder(junk)).toEqual({ kind: "default" });
    }
  });
});

describe("getTaskNotificationTime with per-task rules", () => {
  // UTC keeps the arithmetic readable: 2:00 PM on the day is 14:00Z.
  const settings = sanitizeNotificationSettings({
    enabled: true,
    timeZone: "UTC",
    timedOffsetMinutes: -10,
    allDayEnabled: true,
    allDayTime: "9:00AM",
  });
  const timed = { due_date: "2026-09-25", task_time: "2:00PM" };
  const allDay = { due_date: "2026-09-25", task_time: "" };
  const iso = (task, s = settings) => getTaskNotificationTime(task, s)?.toISOString() ?? null;

  it("uses the account settings by default", () => {
    expect(iso(timed)).toBe("2026-09-25T13:50:00.000Z");
    expect(iso(allDay)).toBe("2026-09-25T09:00:00.000Z");
  });

  it("uses the task's own offset for a timed task", () => {
    expect(iso({ ...timed, reminder: "before:60" })).toBe("2026-09-25T13:00:00.000Z");
    expect(iso({ ...timed, reminder: "before:0" })).toBe("2026-09-25T14:00:00.000Z");
    expect(iso({ ...timed, reminder: "before:1440" })).toBe("2026-09-24T14:00:00.000Z");
  });

  it("uses the task's own time for an all-day task, even with all-day reminders off", () => {
    expect(iso({ ...allDay, reminder: "at:7:15AM" })).toBe("2026-09-25T07:15:00.000Z");
    const off = { ...settings, allDayEnabled: false };
    expect(iso(allDay, off)).toBeNull();
    expect(iso({ ...allDay, reminder: "at:7:15AM" }, off)).toBe("2026-09-25T07:15:00.000Z");
  });

  it("sends nothing for a task set to no reminder", () => {
    expect(iso({ ...timed, reminder: "none" })).toBeNull();
    expect(iso({ ...allDay, reminder: "none" })).toBeNull();
  });
});
