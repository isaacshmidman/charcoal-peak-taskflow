import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { timedDropTarget, useCalendarDnd } from "./useCalendarDnd";
import { isReadOnlyTask } from "@/lib/task-filters";
import MiniMiniTaskCard from "@/components/calendar/MiniMiniTaskCard";

const task = (over = {}) => ({
  id: "t1", title: "Standup", status: "todo", due_date: "2026-09-23",
  task_time: "9:00AM", task_end_time: "10:30AM", tags: [], ...over,
});

describe("timedDropTarget", () => {
  it("lands the card's top edge on the nearest quarter hour and keeps the duration", () => {
    // 44px hours: 14h + 5px ≈ 2:07 → 2:00; the 90-minute length carries over.
    expect(timedDropTarget({ activeTop: 1000 + 14 * 44 + 5, dropTop: 1000, hourHeight: 44, task: task() }))
      .toEqual({ start: 14 * 60, end: 15 * 60 + 30 });
    // 2:08 → 2:15
    expect(timedDropTarget({ activeTop: 14 * 44 + 6, dropTop: 0, hourHeight: 44, task: task() }).start).toBe(14 * 60 + 15);
  });

  it("gives an hour to a task that had no end time", () => {
    expect(timedDropTarget({ activeTop: 48 * 9, dropTop: 0, hourHeight: 48, task: task({ task_end_time: "" }) }))
      .toEqual({ start: 9 * 60, end: 10 * 60 });
  });

  it("keeps late drops inside the day instead of wrapping past midnight", () => {
    const late = timedDropTarget({ activeTop: 48 * 23.5, dropTop: 0, hourHeight: 48, task: task() });
    expect(late).toEqual({ start: 23 * 60 + 30, end: 24 * 60 - 1 });
    // Dragged above the top of the grid: midnight, not negative.
    expect(timedDropTarget({ activeTop: -40, dropTop: 0, hourHeight: 48, task: task() }).start).toBe(0);
  });

  it("refuses to guess when it can't measure the drop", () => {
    // The old fallback treated a missing rect as 0px — a move to midnight.
    expect(timedDropTarget({ activeTop: null, dropTop: 0, task: task() })).toBeNull();
    expect(timedDropTarget({ activeTop: 100, dropTop: undefined, task: task() })).toBeNull();
  });
});

describe("isReadOnlyTask", () => {
  it("is true only for calendar items explicitly marked not writable", () => {
    expect(isReadOnlyTask(task({ source_provider: "google", source_writable: false }))).toBe(true);
    expect(isReadOnlyTask(task({ source_provider: "apple", source_writable: 0 }))).toBe(true);
    expect(isReadOnlyTask(task({ source_provider: "google", source_writable: "0" }))).toBe(true);
    expect(isReadOnlyTask(task({ source_provider: "google", source_writable: true }))).toBe(false);
    // Legacy rows without the field are writable.
    expect(isReadOnlyTask(task({ source_provider: "google" }))).toBe(false);
    // Zephyrly's own tasks are never read-only.
    expect(isReadOnlyTask(task({ source_writable: false }))).toBe(false);
    expect(isReadOnlyTask(null)).toBe(false);
  });
});

describe("useCalendarDnd drops", () => {
  const setup = () => {
    const updateTask = vi.fn();
    const onTaskReschedule = vi.fn();
    const { result } = renderHook(() => useCalendarDnd({ updateTask, onTaskReschedule }));
    return { result, updateTask, onTaskReschedule };
  };
  const dropEvent = (t, over, translatedTop) => ({
    active: { data: { current: { task: t } }, rect: { current: { translated: translatedTop == null ? null : { top: translatedTop } } } },
    over,
  });
  const timedOver = (dateStr, top = 0) => ({ rect: { top }, data: { current: { kind: "timed", dateStr, hourHeight: 44 } } });

  it("moves a task to the day and time it was dropped on, and previews that exact slot first", () => {
    const { result, updateTask } = setup();
    const event = dropEvent(task(), timedOver("2026-09-24"), 14 * 44 + 3);

    act(() => result.current.handleDragMove(event));
    expect(result.current.dropPreview).toEqual({ dateStr: "2026-09-24", start: 14 * 60, end: 15 * 60 + 30 });

    act(() => result.current.handleDragEnd(event));
    expect(updateTask).toHaveBeenCalledWith("t1", { due_date: "2026-09-24", task_time: "2:00PM", task_end_time: "3:30PM" });
    expect(result.current.dropPreview).toBeNull();
  });

  it("makes a task all-day when dropped on an all-day strip", () => {
    const { result, updateTask } = setup();
    act(() => result.current.handleDragEnd(dropEvent(task(), { data: { current: { kind: "allday", dateStr: "2026-09-25" } } }, 0)));
    expect(updateTask).toHaveBeenCalledWith("t1", { task_time: "", task_end_time: "", due_date: "2026-09-25" });
  });

  it("never moves a read-only calendar item, in any view", () => {
    const { result, updateTask, onTaskReschedule } = setup();
    const holiday = task({ source_provider: "google", source_kind: "event", source_writable: false });
    act(() => {
      result.current.handleDragEnd(dropEvent(holiday, timedOver("2026-09-24"), 300));
      result.current.handleDragEnd(dropEvent(holiday, { data: { current: { kind: "allday", dateStr: "2026-09-25" } } }, 0));
      result.current.handleDragEnd(dropEvent(holiday, { data: { current: { kind: "day", dateStr: "2026-09-26" } } }, 0));
    });
    expect(updateTask).not.toHaveBeenCalled();
    expect(onTaskReschedule).not.toHaveBeenCalled();
  });

  it("leaves the time alone when the drop can't be measured", () => {
    const { result, updateTask } = setup();
    act(() => result.current.handleDragEnd(dropEvent(task(), timedOver("2026-09-24"), null)));
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("clears the preview when the card leaves the hour grid", () => {
    const { result } = setup();
    act(() => result.current.handleDragMove(dropEvent(task(), timedOver("2026-09-24"), 200)));
    expect(result.current.dropPreview).not.toBeNull();
    act(() => result.current.handleDragMove(dropEvent(task(), { data: { current: { kind: "allday", dateStr: "2026-09-24" } } }, 0)));
    expect(result.current.dropPreview).toBeNull();
  });
});

describe("read-only cards", () => {
  it("can't be picked up; everything else can", () => {
    const { getByTitle } = render(
      <DndContext>
        <MiniMiniTaskCard task={task({ id: "h", title: "Holiday", source_provider: "google", source_writable: false })} priorities={[]} onClick={() => {}} />
        <MiniMiniTaskCard task={task({ id: "s", title: "Mine" })} priorities={[]} onClick={() => {}} />
      </DndContext>
    );
    expect(getByTitle("Holiday").getAttribute("aria-disabled")).toBe("true");
    expect(getByTitle("Mine").getAttribute("aria-disabled")).toBe("false");
  });
});
