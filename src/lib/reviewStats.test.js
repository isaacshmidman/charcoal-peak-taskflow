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

  it("keeps overdue items from a calendar the user marked as Tasks", () => {
    // The per-calendar setting is the authority: an imported row whose
    // calendar is marked Tasks arrives as source_kind "task" and belongs in
    // the mover, even though it carries a source_provider.
    const overdue = computeOverdue(
      [
        t({
          due_date: "2026-07-10",
          title: "from a task calendar",
          source_provider: "google",
          source_kind: "task",
        }),
        t({
          due_date: "2026-07-10",
          title: "a past meeting",
          source_provider: "google",
          source_kind: "event",
        }),
      ],
      { now: NOW }
    );
    expect(overdue.map((x) => x.title)).toEqual(["from a task calendar"]);
  });

  it("excludes imported events however many there are", () => {
    // The reported bug: a connected Google account produced hundreds of past
    // events, every one of them counted as an overdue task.
    const events = Array.from({ length: 200 }, (_, i) =>
      t({ due_date: "2026-07-01", source_provider: "google", source_kind: "event", title: `evt ${i}` })
    );
    const mine = t({ due_date: "2026-07-01", title: "mine" });
    expect(computeOverdue([...events, mine], { now: NOW }).map((x) => x.title)).toEqual(["mine"]);
  });
});
