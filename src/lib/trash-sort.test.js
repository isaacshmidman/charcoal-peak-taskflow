import { describe, expect, it } from "vitest";
import { compareDeletedNote, compareDeletedTask, sortTrash } from "./trash-sort";

// priority_id → order (lower = higher priority); unknown/unset sinks last.
const ORDER = { p_urgent: 0, p_high: 1, p_low: 3 };
const rank = (r) => ORDER[r.priority_id] ?? 99;

const task = (over = {}) => ({
  title: "t",
  deleted_at: "2026-07-10T12:00:00.000Z",
  due_date: "2026-07-10",
  task_time: "",
  tags: [],
  priority_id: "",
  was_completed: false,
  ...over,
});

const note = (over = {}) => ({
  title: "n",
  deleted_at: "2026-07-10T12:00:00.000Z",
  created_date: "2026-07-10T09:00:00.000Z",
  tags: [],
  priority_id: "",
  pinned: false,
  ...over,
});

const order = (records, sorts, comparator) =>
  sortTrash(records, sorts, comparator, rank).map((r) => r.title);

describe("compareDeletedTask", () => {
  it("sorts by deletion time in both directions", () => {
    const older = task({ title: "older", deleted_at: "2026-07-01T00:00:00.000Z" });
    const newer = task({ title: "newer", deleted_at: "2026-07-09T00:00:00.000Z" });
    expect(order([older, newer], ["deleted_desc"], compareDeletedTask)).toEqual(["newer", "older"]);
    expect(order([newer, older], ["deleted_asc"], compareDeletedTask)).toEqual(["older", "newer"]);
  });

  it("sorts by priority, sinking records whose priority is gone", () => {
    const urgent = task({ title: "urgent", priority_id: "p_urgent" });
    const low = task({ title: "low", priority_id: "p_low" });
    const orphan = task({ title: "orphan", priority_id: "deleted_priority" });
    expect(order([low, orphan, urgent], ["priority_asc"], compareDeletedTask))
      .toEqual(["urgent", "low", "orphan"]);
    expect(order([urgent, orphan, low], ["priority_desc"], compareDeletedTask))
      .toEqual(["orphan", "low", "urgent"]);
  });

  it("sorts by first tag with untagged last", () => {
    const apple = task({ title: "apple", tags: ["apple"] });
    const zebra = task({ title: "zebra", tags: ["zebra"] });
    const none = task({ title: "none", tags: [] });
    expect(order([none, zebra, apple], ["tag_az"], compareDeletedTask))
      .toEqual(["apple", "zebra", "none"]);
  });

  it("sorts by DUE date and by completion snapshot", () => {
    const early = task({ title: "early", due_date: "2026-07-01" });
    const late = task({ title: "late", due_date: "2026-07-20" });
    expect(order([late, early], ["date_asc"], compareDeletedTask)).toEqual(["early", "late"]);
    expect(order([early, late], ["date_desc"], compareDeletedTask)).toEqual(["late", "early"]);

    const done = task({ title: "done", was_completed: true });
    const open = task({ title: "open", was_completed: false });
    expect(order([open, done], ["completed_first"], compareDeletedTask)).toEqual(["done", "open"]);
    expect(order([done, open], ["uncompleted_first"], compareDeletedTask)).toEqual(["open", "done"]);
  });

  it("falls through to the next sort on ties", () => {
    const a = task({ title: "a", priority_id: "p_high", deleted_at: "2026-07-02T00:00:00.000Z" });
    const b = task({ title: "b", priority_id: "p_high", deleted_at: "2026-07-08T00:00:00.000Z" });
    expect(order([a, b], ["priority_asc", "deleted_desc"], compareDeletedTask)).toEqual(["b", "a"]);
  });
});

describe("compareDeletedNote", () => {
  it("treats 'date' as the CREATED date (not deletion)", () => {
    const oldNote = note({ title: "old", created_date: "2026-01-01T00:00:00.000Z" });
    const newNote = note({ title: "new", created_date: "2026-06-01T00:00:00.000Z" });
    expect(order([oldNote, newNote], ["date_desc"], compareDeletedNote)).toEqual(["new", "old"]);
    expect(order([newNote, oldNote], ["date_asc"], compareDeletedNote)).toEqual(["old", "new"]);
  });

  it("sorts by priority and tag like tasks do", () => {
    const urgent = note({ title: "urgent", priority_id: "p_urgent" });
    const low = note({ title: "low", priority_id: "p_low" });
    expect(order([low, urgent], ["priority_asc"], compareDeletedNote)).toEqual(["urgent", "low"]);

    const tagged = note({ title: "tagged", tags: ["work"] });
    const untagged = note({ title: "untagged", tags: [] });
    expect(order([untagged, tagged], ["tag_az"], compareDeletedNote)).toEqual(["tagged", "untagged"]);
  });

  it("ignores pinning — the trash sorts purely by the panel", () => {
    const pinned = note({ title: "pinned", pinned: true, priority_id: "p_low" });
    const plain = note({ title: "plain", pinned: false, priority_id: "p_urgent" });
    expect(order([pinned, plain], ["priority_asc"], compareDeletedNote)).toEqual(["plain", "pinned"]);
  });

  it("ignores completion sorts (not applicable to notes) and falls back to newest-deleted", () => {
    const older = note({ title: "older", deleted_at: "2026-07-01T00:00:00.000Z" });
    const newer = note({ title: "newer", deleted_at: "2026-07-09T00:00:00.000Z" });
    expect(order([older, newer], ["completed_first"], compareDeletedNote)).toEqual(["newer", "older"]);
  });
});

describe("sortTrash", () => {
  it("does not mutate the input array", () => {
    const records = [task({ title: "b" }), task({ title: "a", tags: ["a"] })];
    const snapshot = records.map((r) => r.title);
    sortTrash(records, ["tag_az"], compareDeletedTask, rank);
    expect(records.map((r) => r.title)).toEqual(snapshot);
  });
});
