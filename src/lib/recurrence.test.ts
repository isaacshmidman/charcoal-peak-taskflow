import { getNextRecurrenceDate, getNextRecurringDueDate } from "./recurrence";

describe("recurrence helpers", () => {
  it("skips weekends for weekday recurrences", () => {
    const next = getNextRecurrenceDate({
      due_date: "2026-03-27",
      recurrence: "weekdays",
    });

    expect(next?.toISOString().slice(0, 10)).toBe("2026-03-30");
  });

  it("finds the next custom weekday from the allowed set", () => {
    const next = getNextRecurrenceDate({
      due_date: "2026-03-27",
      recurrence: "custom_days",
      recurrence_days: [1, 4],
    });

    expect(next?.toISOString().slice(0, 10)).toBe("2026-03-30");
  });

  it("returns null when the next recurring instance would exceed the end date", () => {
    const next = getNextRecurringDueDate({
      due_date: "2026-03-27",
      recurrence: "daily",
      recurrence_end_date: "2026-03-27",
    });

    expect(next).toBeNull();
  });
});
