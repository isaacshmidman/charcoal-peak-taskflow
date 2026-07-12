import { describe, expect, it } from "vitest";
import { isEmptyViewFilters, taskMatchesQuery, taskMatchesView } from "./viewFilter";

const NOW = new Date(2026, 6, 15); // Wed Jul 15 2026

const task = (over = {}) => ({
  title: "write report",
  status: "todo",
  tags: ["work", "Deep Work"],
  priority_id: "p_high",
  due_date: "2026-07-15",
  ...over,
});

describe("taskMatchesQuery", () => {
  it("matches title or tags case-insensitively; empty query matches all", () => {
    expect(taskMatchesQuery(task(), "REPORT")).toBe(true);
    expect(taskMatchesQuery(task(), "deep")).toBe(true);
    expect(taskMatchesQuery(task(), "zzz")).toBe(false);
    expect(taskMatchesQuery(task(), "")).toBe(true);
  });
});

describe("taskMatchesView", () => {
  it("empty filters keep active tasks and drop done ones by default", () => {
    expect(taskMatchesView(task(), {}, { now: NOW })).toBe(true);
    expect(taskMatchesView(task({ status: "done" }), {}, { now: NOW })).toBe(false);
    expect(taskMatchesView(task({ status: "done" }), { status: "all" }, { now: NOW })).toBe(true);
  });

  it("tags are any-of and case-insensitive", () => {
    expect(taskMatchesView(task(), { tags: ["deep work"] }, { now: NOW })).toBe(true);
    expect(taskMatchesView(task(), { tags: ["home", "work"] }, { now: NOW })).toBe(true);
    expect(taskMatchesView(task(), { tags: ["home"] }, { now: NOW })).toBe(false);
  });

  it("priorities are any-of by id", () => {
    expect(taskMatchesView(task(), { priority_ids: ["p_high", "p_low"] }, { now: NOW })).toBe(true);
    expect(taskMatchesView(task(), { priority_ids: ["p_low"] }, { now: NOW })).toBe(false);
  });

  it("due windows: today, week, overdue, none", () => {
    expect(taskMatchesView(task(), { due: "today" }, { now: NOW })).toBe(true);
    expect(taskMatchesView(task({ due_date: "2026-07-16" }), { due: "today" }, { now: NOW })).toBe(false);
    expect(taskMatchesView(task({ due_date: "2026-07-21" }), { due: "week" }, { now: NOW })).toBe(true);
    expect(taskMatchesView(task({ due_date: "2026-07-22" }), { due: "week" }, { now: NOW })).toBe(false);
    expect(taskMatchesView(task({ due_date: "2026-07-14" }), { due: "overdue" }, { now: NOW })).toBe(true);
    expect(taskMatchesView(task({ due_date: "" }), { due: "none" }, { now: NOW })).toBe(true);
    expect(taskMatchesView(task(), { due: "none" }, { now: NOW })).toBe(false);
  });

  it("combines predicates with AND", () => {
    const filters = { tags: ["work"], priority_ids: ["p_high"], due: "today" };
    expect(taskMatchesView(task(), filters, { now: NOW })).toBe(true);
    expect(taskMatchesView(task({ priority_id: "p_low" }), filters, { now: NOW })).toBe(false);
  });
});

describe("isEmptyViewFilters", () => {
  it("detects unconstrained filters", () => {
    expect(isEmptyViewFilters({})).toBe(true);
    expect(isEmptyViewFilters({ due: "any", tags: [] })).toBe(true);
    expect(isEmptyViewFilters({ tags: ["work"] })).toBe(false);
    expect(isEmptyViewFilters({ due: "week" })).toBe(false);
  });
});
