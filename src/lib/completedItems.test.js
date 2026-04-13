import { buildCompletedItems } from "./completedItems";

describe("buildCompletedItems", () => {
  it("includes only done tasks without a parent_id", () => {
    const items = buildCompletedItems({
      tasks: [
        {
          id: "task-1",
          title: "Ship launch checklist",
          status: "done",
          task_type: "one_time",
          completed_at: "2026-03-29T10:00:00.000Z",
          priority_id: "priority-2",
        },
        {
          id: "task-2",
          title: "Recurring snapshot",
          status: "done",
          task_type: "one_time",
          completed_at: "2026-03-29T11:00:00.000Z",
          priority_id: "priority-1",
          tags: ["Work"],
        },
        {
          id: "task-3",
          title: "Active task",
          status: "todo",
          task_type: "one_time",
        },
        {
          id: "subtask-1",
          title: "Subtask",
          status: "done",
          task_type: "one_time",
          parent_id: "task-1",
        },
      ],
      sorts: ["date_desc"],
    });

    expect(items.map((item) => item.id)).toEqual([
      "task:task-2",
      "task:task-1",
    ]);
  });

  it("filters across titles and tags", () => {
    const items = buildCompletedItems({
      tasks: [
        {
          id: "task-1",
          title: "Daily standup",
          status: "done",
          task_type: "one_time",
          completed_at: "2026-03-29T11:00:00.000Z",
          tags: ["Work"],
        },
        {
          id: "task-2",
          title: "Unrelated task",
          status: "done",
          task_type: "one_time",
          completed_at: "2026-03-29T12:00:00.000Z",
          tags: [],
        },
      ],
      search: "work",
    });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Daily standup");
  });
});
