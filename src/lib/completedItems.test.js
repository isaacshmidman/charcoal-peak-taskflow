import { buildCompletedItems } from "./completedItems";

describe("buildCompletedItems", () => {
  it("includes recurring completion history alongside live completed tasks", () => {
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
      ],
      deletedTasks: [
        {
          id: "deleted-1",
          task_id: "recurring-1",
          title: "Daily standup",
          task_type: "recurring",
          recurrence: "daily",
          was_completed: true,
          is_completion_record: true,
          completed_at: "2026-03-29T11:00:00.000Z",
          deleted_at: "2026-03-29T11:00:00.000Z",
          expires_at: "2026-04-05T11:00:00.000Z",
          subtasks: [],
          tags: ["Work"],
          priority_id: "priority-1",
        },
        {
          id: "deleted-2",
          task_id: "one-time-1",
          title: "Old completed task",
          task_type: "one_time",
          was_completed: true,
          is_completion_record: false,
          completed_at: "2026-03-29T12:00:00.000Z",
          deleted_at: "2026-03-29T12:00:00.000Z",
          expires_at: "2026-04-05T12:00:00.000Z",
          subtasks: [],
        },
      ],
      sorts: ["date_desc"],
    });

    expect(items.map((item) => item.id)).toEqual([
      "recurring-record:deleted-1",
      "task:task-1",
    ]);
  });

  it("filters across titles and tags for recurring completion history", () => {
    const items = buildCompletedItems({
      deletedTasks: [
        {
          id: "deleted-1",
          task_id: "recurring-1",
          title: "Daily standup",
          task_type: "recurring",
          recurrence: "daily",
          was_completed: true,
          is_completion_record: true,
          completed_at: "2026-03-29T11:00:00.000Z",
          deleted_at: "2026-03-29T11:00:00.000Z",
          expires_at: "2026-04-05T11:00:00.000Z",
          subtasks: [],
          tags: ["Work"],
        },
      ],
      search: "work",
    });

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("recurring-record");
  });
});
