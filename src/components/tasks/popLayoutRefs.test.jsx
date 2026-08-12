import React, { createRef } from "react";
import { render } from "@testing-library/react";
import TaskCard from "./TaskCard";
import CompactTaskCard from "./CompactTaskCard";

/**
 * The task lists render these rows inside
 * <AnimatePresence mode="popLayout">. popLayout measures an exiting child
 * through a ref so it can hold that child's box while it animates out. A row
 * that doesn't forward a ref makes React warn, framer measure nothing, and a
 * removed row vanish instantly while the rest of the list snaps upward.
 *
 * It's a silent failure — the app renders fine and only the exit animation
 * degrades — so these assert the plumbing directly: the ref must land on a
 * real DOM node, not merely be accepted.
 *
 * RecentlyDeleted's DeletedTaskCard / DeletedNoteCard follow the same rule
 * but are module-private to that page, so they're covered by the comments
 * beside them rather than here.
 */

const priorities = [{ id: "priority-1", name: "Medium", order: 1, color: "slate" }];

const task = {
  id: "task-1",
  title: "A task",
  description: "",
  priority_id: "priority-1",
  status: "todo",
  task_type: "one_time",
  recurrence: "none",
  recurrence_days: [],
  recurrence_end_date: "",
  due_date: "2026-03-28",
  task_time: "",
  tags: [],
  completed_at: "",
};

const noop = () => {};

describe("popLayout row components forward refs", () => {
  it("TaskCard puts the ref on its root element", () => {
    const ref = createRef();
    render(
      <TaskCard
        ref={ref}
        task={task}
        priorities={priorities}
        subtasks={[]}
        onToggleDone={noop}
        onEdit={noop}
        onDelete={noop}
        onAddSubtask={noop}
        onUpdate={noop}
        onEditSubtask={noop}
        onReorderSubtasks={noop}
      />
    );

    expect(ref.current).toBeInstanceOf(HTMLElement);
    // Must be the OUTERMOST node — that's the box popLayout holds open.
    // An inner element would measure too small and the list would still jump.
    expect(ref.current).toBe(document.querySelector('[data-testid="task-card-task-1"]'));
  });

  it("CompactTaskCard puts the ref on its root element", () => {
    const ref = createRef();
    render(
      <CompactTaskCard
        ref={ref}
        task={task}
        priorities={priorities}
        onToggleDone={noop}
        onEdit={noop}
        onUpdate={noop}
      />
    );

    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current.textContent).toContain("A task");
  });
});
