import { describe, expect, it } from "vitest";
import { computeOverdue } from "./reviewStats";

const NOW = new Date(2026, 6, 15, 10, 0); // Wed Jul 15 2026

const t = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  title: "task",
  status: "todo",
  parent_id: "",
  due_date: "",
  ...over,
});

describe("computeOverdue", () => {
  it("returns only overdue, top-level, ours, not-done tasks", () => {
    const tasks = [
      t({ due_date: "2026-07-14" }),                 // overdue ✓
      t({ due_date: "2026-07-01" }),                 // overdue ✓
      t({ due_date: "2026-07-15" }),                 // due today — not overdue
      t({ due_date: "2026-07-20" }),                 // future
      t({ due_date: "2026-07-10", status: "done" }), // done — excluded
      t({ due_date: "2026-07-10", parent_id: "x" }), // subtask — excluded
      t({ due_date: "2026-07-10", source_kind: "event" }), // external — excluded
      t({ due_date: "" }),                            // no date — excluded
    ];
    const overdue = computeOverdue(tasks, { now: NOW });
    expect(overdue.map((x) => x.due_date).sort()).toEqual(["2026-07-01", "2026-07-14"]);
  });

  it("handles the empty case", () => {
    expect(computeOverdue([], { now: NOW })).toEqual([]);
  });
});
