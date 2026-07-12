import { describe, expect, it } from "vitest";
import { computeDailyReview, computeWeeklyReview } from "./reviewStats";

const NOW = new Date(2026, 6, 15, 10, 0); // Wed Jul 15 2026

const t = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  title: "task",
  status: "todo",
  parent_id: "",
  tags: [],
  due_date: "",
  completed_at: "",
  ...over,
});

describe("computeDailyReview", () => {
  it("counts yesterday/today completions and collects overdue waiting tasks", () => {
    const tasks = [
      t({ status: "done", completed_at: "2026-07-14T18:00:00.000Z" }),
      t({ status: "done", completed_at: "2026-07-15T08:00:00.000Z" }),
      t({ due_date: "2026-07-13" }),
      t({ due_date: "2026-07-14" }),
      t({ due_date: "2026-07-15" }), // due today — not waiting
      t({ due_date: "2026-07-13", parent_id: "x" }), // subtask ignored
      t({ due_date: "2026-07-13", source_kind: "event" }), // external ignored
    ];
    const r = computeDailyReview(tasks, { now: NOW });
    expect(r.doneYesterday).toBe(1);
    expect(r.doneToday).toBe(1);
    expect(r.waiting.map((x) => x.due_date)).toEqual(["2026-07-13", "2026-07-14"]);
  });

  it("handles the empty case", () => {
    const r = computeDailyReview([], { now: NOW });
    expect(r).toEqual({ doneYesterday: 0, doneToday: 0, waiting: [] });
  });
});

describe("computeWeeklyReview", () => {
  it("counts the last 7 days, finds the busiest tag and oldest waiting", () => {
    const tasks = [
      t({ status: "done", completed_at: "2026-07-09T12:00:00.000Z", tags: ["work"] }),
      t({ status: "done", completed_at: "2026-07-14T12:00:00.000Z", tags: ["work", "deep"] }),
      t({ status: "done", completed_at: "2026-07-08T12:00:00.000Z", tags: ["work"] }), // 8th < weekAgo(9th)
      t({ due_date: "2026-07-01" }),
      t({ due_date: "2026-07-10" }),
    ];
    const r = computeWeeklyReview(tasks, { now: NOW });
    expect(r.doneThisWeek).toBe(2);
    expect(r.busiestTag).toEqual({ name: "work", count: 2 });
    expect(r.oldestWaiting.due_date).toBe("2026-07-01");
  });

  it("returns nulls when quiet", () => {
    const r = computeWeeklyReview([], { now: NOW });
    expect(r.busiestTag).toBe(null);
    expect(r.oldestWaiting).toBe(null);
  });
});
