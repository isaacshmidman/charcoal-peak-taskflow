import { describe, expect, it } from "vitest";
import { describeMove, moveChanges } from "./calendar-move";

const task = { id: "t1", title: "Standup", due_date: "2026-09-23", task_time: "9:00AM", task_end_time: "10:30AM" };

describe("moveChanges", () => {
  it("keeps only the fields that change, with what to put back", () => {
    expect(moveChanges(task, { due_date: "2026-09-24", task_time: "9:00AM", task_end_time: "10:30AM" })).toEqual({
      before: { due_date: "2026-09-23" },
      after: { due_date: "2026-09-24" },
    });
  });
  it("is empty when a task is dropped back where it was", () => {
    expect(moveChanges(task, { due_date: "2026-09-23", task_time: "9:00AM" }).after).toEqual({});
  });
  it("treats a missing field as empty", () => {
    expect(moveChanges({ id: "x" }, { task_time: "" }).after).toEqual({});
  });
});

describe("describeMove", () => {
  it("says where a timed move landed", () => {
    expect(describeMove(task, { due_date: "2026-09-24", task_time: "2:00PM", task_end_time: "3:30PM" }))
      .toBe("Moved “Standup” to Thu, Sep 24 at 2:00 PM");
  });
  it("says when a task became all-day", () => {
    expect(describeMove(task, { task_time: "", task_end_time: "", due_date: "2026-09-25" }))
      .toBe("Moved “Standup” to all day Fri, Sep 25");
  });
  it("names the new day for a Month move, keeping the time if it had one", () => {
    expect(describeMove(task, { due_date: "2026-09-30" })).toBe("Moved “Standup” to Wed, Sep 30 at 9:00 AM");
    expect(describeMove({ ...task, task_time: "" }, { due_date: "2026-09-30" })).toBe("Moved “Standup” to Wed, Sep 30");
  });
  it("describes a resize by its new end", () => {
    expect(describeMove(task, { task_end_time: "11:30AM" })).toBe("“Standup” now ends 11:30 AM");
  });
  it("shortens long titles", () => {
    const long = { ...task, title: "A".repeat(50) };
    expect(describeMove(long, { task_end_time: "11:30AM" })).toBe(`“${"A".repeat(31)}…” now ends 11:30 AM`);
  });
});
