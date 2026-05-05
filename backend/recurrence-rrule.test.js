// @ts-check
import { describe, it, expect } from "vitest";
import {
  parseRruleValueToTaskRecurrence,
  taskToRruleLine,
} from "./recurrence-rrule.js";

describe("taskToRruleLine", () => {
  it("returns null for non-recurring tasks", () => {
    expect(taskToRruleLine({ task_type: "one_time", recurrence: "none" })).toBeNull();
    expect(taskToRruleLine({ task_type: "recurring", recurrence: "none" })).toBeNull();
    expect(taskToRruleLine({ task_type: "recurring" })).toBeNull(); // no recurrence
  });

  it("rounds-trips imported source_recurrence_rule only for unsupported custom rules", () => {
    expect(
      taskToRruleLine({
        task_type: "recurring",
        recurrence: "custom",
        source_recurrence_rule: "RRULE:FREQ=MONTHLY;BYMONTHDAY=15",
      })
    ).toBe("RRULE:FREQ=MONTHLY;BYMONTHDAY=15");
    // Adds RRULE: prefix when missing.
    expect(
      taskToRruleLine({
        task_type: "recurring",
        recurrence: "custom",
        source_recurrence_rule: "FREQ=YEARLY",
      })
    ).toBe("RRULE:FREQ=YEARLY");
  });

  it("uses native recurrence fields over stale imported source rules", () => {
    expect(
      taskToRruleLine({
        task_type: "recurring",
        recurrence: "weekly",
        source_recurrence_rule: "RRULE:FREQ=MONTHLY;BYDAY=1MO",
      })
    ).toBe("RRULE:FREQ=WEEKLY");
    expect(
      taskToRruleLine({
        task_type: "one_time",
        recurrence: "none",
        source_recurrence_rule: "RRULE:FREQ=DAILY",
      })
    ).toBeNull();
  });

  it("maps daily / weekly / biweekly / monthly / quarterly / yearly", () => {
    const base = { task_type: "recurring" };
    expect(taskToRruleLine({ ...base, recurrence: "daily" })).toBe("RRULE:FREQ=DAILY");
    expect(taskToRruleLine({ ...base, recurrence: "weekly" })).toBe("RRULE:FREQ=WEEKLY");
    expect(taskToRruleLine({ ...base, recurrence: "biweekly" })).toBe("RRULE:FREQ=WEEKLY;INTERVAL=2");
    expect(taskToRruleLine({ ...base, recurrence: "monthly" })).toBe("RRULE:FREQ=MONTHLY");
    expect(taskToRruleLine({ ...base, recurrence: "quarterly" })).toBe("RRULE:FREQ=MONTHLY;INTERVAL=3");
    expect(taskToRruleLine({ ...base, recurrence: "yearly" })).toBe("RRULE:FREQ=YEARLY");
  });

  it("emits BYDAY for weekdays-only", () => {
    expect(
      taskToRruleLine({ task_type: "recurring", recurrence: "weekdays" })
    ).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  });

  it("maps custom_days numeric weekdays to BYDAY codes", () => {
    // 1=Mon, 3=Wed, 5=Fri (date-fns getDay)
    expect(
      taskToRruleLine({
        task_type: "recurring",
        recurrence: "custom_days",
        recurrence_days: [1, 3, 5],
      })
    ).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR");
  });

  it("falls back to plain weekly when custom_days has no days", () => {
    expect(
      taskToRruleLine({
        task_type: "recurring",
        recurrence: "custom_days",
        recurrence_days: [],
      })
    ).toBe("RRULE:FREQ=WEEKLY");
  });

  it("appends UNTIL=YYYYMMDD for all-day recurrence_end_date", () => {
    expect(
      taskToRruleLine({
        task_type: "recurring",
        recurrence: "weekly",
        recurrence_end_date: "2026-12-31",
      })
    ).toBe("RRULE:FREQ=WEEKLY;UNTIL=20261231");
  });

  it("appends UNTIL=YYYYMMDDT235959Z for timed recurrence_end_date", () => {
    expect(
      taskToRruleLine({
        task_type: "recurring",
        recurrence: "weekly",
        task_time: "9:00AM",
        recurrence_end_date: "2026-12-31",
      })
    ).toBe("RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z");
  });

  it("ignores invalid recurrence_end_date", () => {
    expect(
      taskToRruleLine({
        task_type: "recurring",
        recurrence: "weekly",
        recurrence_end_date: "not-a-date",
      })
    ).toBe("RRULE:FREQ=WEEKLY");
  });

  it("returns null for unknown recurrence values", () => {
    expect(
      taskToRruleLine({ task_type: "recurring", recurrence: "every-other-tuesday" })
    ).toBeNull();
  });
});

describe("parseRruleValueToTaskRecurrence", () => {
  it("maps provider BYDAY rules into Zephyrly custom_days", () => {
    expect(
      parseRruleValueToTaskRecurrence("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20260630T235959Z")
    ).toEqual({
      recurrence: "custom_days",
      recurrence_days: [1, 3, 5],
      recurrence_end_date: "2026-06-30",
    });
  });

  it("maps weekday and interval rules to native recurrence values", () => {
    expect(
      parseRruleValueToTaskRecurrence("FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR")
    ).toEqual({
      recurrence: "weekdays",
      recurrence_days: [],
      recurrence_end_date: "",
    });
    expect(
      parseRruleValueToTaskRecurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU")
    ).toEqual({
      recurrence: "biweekly",
      recurrence_days: [],
      recurrence_end_date: "",
    });
  });

  it("maps simple monthly, quarterly, and yearly date rules when DTSTART matches", () => {
    expect(
      parseRruleValueToTaskRecurrence("FREQ=MONTHLY;BYMONTHDAY=4", {
        dtstartYmd: "2026-05-04",
      })
    ).toEqual({
      recurrence: "monthly",
      recurrence_days: [],
      recurrence_end_date: "",
    });
    expect(
      parseRruleValueToTaskRecurrence("FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=4", {
        dtstartYmd: "2026-05-04",
      })
    ).toEqual({
      recurrence: "quarterly",
      recurrence_days: [],
      recurrence_end_date: "",
    });
    expect(
      parseRruleValueToTaskRecurrence("FREQ=YEARLY;BYMONTH=5;BYMONTHDAY=4", {
        dtstartYmd: "2026-05-04",
      })
    ).toEqual({
      recurrence: "yearly",
      recurrence_days: [],
      recurrence_end_date: "",
    });
  });

  it("keeps unsupported finite or positional provider rules as custom", () => {
    expect(parseRruleValueToTaskRecurrence("FREQ=DAILY;COUNT=5")).toEqual({
      recurrence: "custom",
      recurrence_days: [],
      recurrence_end_date: "",
    });
    expect(
      parseRruleValueToTaskRecurrence("FREQ=MONTHLY;BYDAY=1MO", {
        dtstartYmd: "2026-05-04",
      })
    ).toEqual({
      recurrence: "custom",
      recurrence_days: [],
      recurrence_end_date: "",
    });
  });
});
