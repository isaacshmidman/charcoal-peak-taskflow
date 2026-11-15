import { describe, expect, it } from "vitest";
import { dayLabel, dayTimeLabel, fromDateStr, toDateStr } from "./dates";

const now = new Date(2026, 10, 14, 15, 30); // Sat 14 Nov 2026, mid-afternoon

describe("a day the way a person would say it", () => {
  it("names today, tomorrow and yesterday", () => {
    expect(dayLabel("2026-11-14", now)).toBe("Today");
    expect(dayLabel("2026-11-15", now)).toBe("Tomorrow");
    expect(dayLabel("2026-11-13", now)).toBe("Yesterday");
  });

  it("uses the weekday for the rest of the coming week, then the date", () => {
    expect(dayLabel("2026-11-16", now)).toBe("Mon");
    expect(dayLabel("2026-11-20", now)).toBe("Fri");
    // A week from today is not "Sat": that would read as today.
    expect(dayLabel("2026-11-21", now)).toBe("Nov 21");
    expect(dayLabel("2026-11-12", now)).toBe("Nov 12");
  });

  it("adds the year only when it isn't this one", () => {
    expect(dayLabel("2027-01-03", now)).toBe("Jan 3, 2027");
    expect(dayLabel("2025-12-31", now)).toBe("Dec 31, 2025");
  });

  it("counts days across a clock change", () => {
    // In places where clocks went back on 1 Nov 2026 that day had 25 hours.
    const afterChange = new Date(2026, 10, 1, 9);
    expect(dayLabel("2026-10-31", afterChange)).toBe("Yesterday");
    expect(dayLabel("2026-11-02", afterChange)).toBe("Tomorrow");
  });

  it("says nothing for no date or a broken one", () => {
    expect(dayLabel("", now)).toBe("");
    expect(dayLabel(null, now)).toBe("");
    expect(dayLabel("soon", now)).toBe("");
  });

  it("puts the time after the day, and drops 'Today' when there is a time", () => {
    expect(dayTimeLabel("2026-11-14", "10:30AM", now)).toBe("10:30 AM");
    expect(dayTimeLabel("2026-11-14", "", now)).toBe("Today");
    expect(dayTimeLabel("2026-11-15", "9:00PM", now)).toBe("Tomorrow, 9:00 PM");
    expect(dayTimeLabel("2026-11-30", "12:00PM", now)).toBe("Nov 30, 12:00 PM");
    expect(dayTimeLabel("", "9:00AM", now)).toBe("");
  });

  it("round-trips a date string through local time", () => {
    expect(toDateStr(fromDateStr("2026-03-08"))).toBe("2026-03-08");
  });
});
