import { renderHook } from "@testing-library/react";

const showDeleteToast = vi.fn();
const permanentlyDelete = vi.fn();

vi.mock("@/components/tasks/DeleteToast", () => ({
  showDeleteToast,
}));

vi.mock("@/hooks/useDeletedTasks", () => ({
  useDeletedTasks: () => ({
    permanentlyDelete,
  }),
}));

describe("useDeleteWithUndo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores a deleted parent task and its subtasks on undo", async () => {
    const createTask = vi
      .fn()
      .mockResolvedValueOnce({ id: "restored-parent" })
      .mockResolvedValueOnce({ id: "restored-subtask" });
    const deleteTask = vi.fn().mockResolvedValue({
      task: {
        id: "task-1",
        title: "Parent task",
        description: "top level",
        priority_id: "priority-1",
        status: "todo",
        task_type: "one_time",
        recurrence: "none",
        recurrence_days: [],
        recurrence_end_date: "",
        due_date: "2026-03-28",
        task_time: "9:00AM",
        tags: ["Work"],
        completed_at: "",
      },
      subtasks: [
        {
          id: "subtask-1",
          title: "Child task",
          parent_id: "task-1",
          order: 2,
          status: "todo",
        },
      ],
      deletedRecordId: "deleted-1",
    });

    const { useDeleteWithUndo } = await import("./useDeleteWithUndo");
    const { result } = renderHook(() => useDeleteWithUndo(deleteTask, createTask));

    await result.current({ id: "task-1", title: "Parent task" });

    expect(deleteTask).toHaveBeenCalledWith("task-1", {});
    expect(showDeleteToast).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Task "Parent task" was deleted',
      })
    );

    await showDeleteToast.mock.calls[0][0].onUndo();

    expect(createTask).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        title: "Parent task",
        due_date: "2026-03-28",
        tags: ["Work"],
      })
    );
    expect(createTask).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        title: "Child task",
        parent_id: "restored-parent",
      })
    );
    expect(permanentlyDelete).toHaveBeenCalledWith("deleted-1");
  });

  it("restores a deleted subtask without recreating a parent", async () => {
    const createTask = vi.fn().mockResolvedValue({ id: "restored-subtask" });
    const deleteTask = vi.fn().mockResolvedValue({
      task: {
        id: "subtask-1",
        title: "Child task",
        parent_id: "task-1",
        status: "todo",
      },
      subtasks: [],
      deletedRecordId: null,
    });

    const { useDeleteWithUndo } = await import("./useDeleteWithUndo");
    const { result } = renderHook(() => useDeleteWithUndo(deleteTask, createTask));

    await result.current({ id: "subtask-1", title: "Child task" }, { isSubtask: true });
    await showDeleteToast.mock.calls[0][0].onUndo();

    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Child task",
        parent_id: "task-1",
      })
    );
    expect(permanentlyDelete).not.toHaveBeenCalled();
  });
});
