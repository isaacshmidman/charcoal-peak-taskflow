// @ts-nocheck
import { describe, it, expect } from "vitest";
import { layoutTimedTasks } from "@/lib/calendar-layout";

// Helper — short-form task constructor for terser tests.
const t = (id, time, end) => ({
  id,
  task_time: time,
  task_end_time: end || "",
});

// Find the layout entry for a task id.
const find = (laidOut, id) => laidOut.find((e) => e.task.id === id);

describe("layoutTimedTasks", () => {
  it("places non-overlapping events all in column 0 with full width", () => {
    const out = layoutTimedTasks([
      t("a", "9:00AM", "10:00AM"),
      t("b", "11:00AM", "12:00PM"),
      t("c", "2:00PM", "3:00PM"),
    ]);
    for (const e of out) {
      expect(e.col).toBe(0);
      expect(e.cols).toBe(1);
      expect(e.colSpan).toBe(1);
    }
  });

  it("splits two simultaneous events 50/50", () => {
    const out = layoutTimedTasks([
      t("a", "9:00AM", "10:00AM"),
      t("b", "9:00AM", "10:00AM"),
    ]);
    expect(find(out, "a").cols).toBe(2);
    expect(find(out, "b").cols).toBe(2);
    expect(find(out, "a").colSpan).toBe(1);
    expect(find(out, "b").colSpan).toBe(1);
    expect(new Set([find(out, "a").col, find(out, "b").col])).toEqual(new Set([0, 1]));
  });

  it("expands sparse part of cluster — Google's right-fill behavior", () => {
    // Bridge cluster: A and B fight for cols 0,1 from 9–10; X holds col 2
    // (9:30–10:30) so the cluster has 3 cols; D arrives at 10 and reuses
    // col 0 (A has ended). At D's time slot col 1 is also empty (B ended
    // at 10), so D should expand RIGHT through col 1 — but stop at col 2,
    // which still has X (9:30–10:30) overlapping D (10–11).
    //
    // Result: cluster cols=3, D in col 0 with colSpan=2 (renders at 2/3 width).
    // Without the expand pass D would render at 1/3 — that's the "weird narrow
    // event" bug.
    const out = layoutTimedTasks([
      t("a", "9:00AM", "10:00AM"),
      t("b", "9:00AM", "10:00AM"),
      t("x", "9:30AM", "10:30AM"),
      t("d", "10:00AM", "11:00AM"),
    ]);
    const a = find(out, "a");
    const b = find(out, "b");
    const x = find(out, "x");
    const d = find(out, "d");
    expect(a.cols).toBe(3);
    expect(d.cols).toBe(3);
    expect(d.col).toBe(0);     // reuses col 0 after A ended
    expect(d.colSpan).toBe(2); // expands through col 1 (B ended), stops at col 2 (X still active)
    // The crowded events can't expand.
    expect(a.colSpan).toBe(1);
    expect(b.colSpan).toBe(1);
    expect(x.colSpan).toBe(1);
  });

  it("three concurrent events get cols=3, all colSpan=1", () => {
    const out = layoutTimedTasks([
      t("a", "9:00AM", "10:00AM"),
      t("b", "9:00AM", "10:00AM"),
      t("c", "9:00AM", "10:00AM"),
    ]);
    for (const e of out) {
      expect(e.cols).toBe(3);
      expect(e.colSpan).toBe(1);
    }
  });

  it("lays out a long event beside sequential overlaps in stable columns", () => {
    const out = layoutTimedTasks([
      t("long", "9:00AM", "12:00PM"),
      t("b", "9:00AM", "10:00AM"),
      t("c", "10:00AM", "11:00AM"),
      t("d", "11:00AM", "12:00PM"),
    ]);
    expect(find(out, "long")).toMatchObject({ col: 0, cols: 2, colSpan: 1 });
    expect(find(out, "b")).toMatchObject({ col: 1, cols: 2, colSpan: 1 });
    expect(find(out, "c")).toMatchObject({ col: 1, cols: 2, colSpan: 1 });
    expect(find(out, "d")).toMatchObject({ col: 1, cols: 2, colSpan: 1 });
  });

  it("defaults end to start+60min when task_end_time is missing", () => {
    const out = layoutTimedTasks([
      t("a", "9:00AM"),
      t("b", "9:30AM"),
    ]);
    // a is 9-10 (default), b is 9:30-10:30. They overlap.
    expect(find(out, "a").cols).toBe(2);
    expect(find(out, "b").cols).toBe(2);
  });

  it("ignores tasks without a parseable task_time", () => {
    const out = layoutTimedTasks([
      t("a", "9:00AM", "10:00AM"),
      t("b", "", ""), // all-day — should be excluded entirely
      { id: "c", task_time: "garbage" },
    ]);
    expect(out.map((e) => e.task.id)).toEqual(["a"]);
  });

  it("treats invalid end (end ≤ start) as default 60min", () => {
    const out = layoutTimedTasks([
      t("a", "9:00AM", "8:00AM"), // end before start
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].endMin - out[0].startMin).toBe(60);
  });
});
