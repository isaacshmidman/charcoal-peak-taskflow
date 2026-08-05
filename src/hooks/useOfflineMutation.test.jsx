import React from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const taskCreateApi = vi.fn();
const updateTaskApi = vi.fn();
const deleteTaskApi = vi.fn();
const recordDeletion = vi.fn();
const queueMutation = vi.fn();

// Default: createTask succeeds and returns a task with an ID
taskCreateApi.mockImplementation(async (data) => ({ ...data, id: `task_${Date.now()}` }));

vi.mock("@/api/apiClient", () => ({
  apiClient: {
    entities: {
      Task: {
        create: taskCreateApi,
        update: updateTaskApi,
        delete: deleteTaskApi,
      },
    },
  },
}));

vi.mock("@/lib/offlineCache", () => ({
  isOnline: vi.fn(() => true),
}));

// Tasks queue through the registry handle now — identical entry shapes,
// so every assertion below is unchanged; only the spy's home moved.
vi.mock("@/lib/offlineEntityRegistry", () => ({
  TaskOffline: {
    queueMutation,
    dequeueCreate: vi.fn(),
    updateQueuedCreate: vi.fn(),
    getPending: vi.fn(() => []),
    setPending: vi.fn(),
  },
}));

vi.mock("@/hooks/useDeletedTasks", () => ({
  useDeletedTasks: () => ({
    recordDeletion,
  }),
}));

describe("useOfflineMutation", () => {
  const createRecoverableError = () => Object.assign(new Error("Network down"), { status: undefined });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues creates when a recoverable connection error happens while online", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    taskCreateApi.mockRejectedValueOnce(createRecoverableError());

    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { useOfflineMutation } = await import("./useOfflineMutation");
    const { result } = renderHook(() => useOfflineMutation(), { wrapper });

    const created = await result.current.createTask({ title: "Offline-safe task", status: "todo" });

    expect(created.id).toMatch(/^offline_/);
    expect(queueMutation).toHaveBeenCalledWith({
      type: "create",
      data: expect.objectContaining({
        title: "Offline-safe task",
        status: "todo",
        _offlineId: created.id,
      }),
    });
    expect(queryClient.getQueryData(["tasks"])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.id,
          title: "Offline-safe task",
        }),
      ])
    );
  });

  it("queues updates when a recoverable connection error happens while online", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    queryClient.setQueryData(["tasks"], [{ id: "task-1", title: "Before", status: "todo" }]);
    updateTaskApi.mockRejectedValueOnce(createRecoverableError());

    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { useOfflineMutation } = await import("./useOfflineMutation");
    const { result } = renderHook(() => useOfflineMutation(), { wrapper });

    await result.current.updateTask("task-1", { title: "After" });

    expect(queueMutation).toHaveBeenCalledWith({
      type: "update",
      id: "task-1",
      data: { title: "After" },
    });
    expect(queryClient.getQueryData(["tasks"])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "task-1",
          title: "After",
        }),
      ])
    );
  });

  it("queues deletes when a recoverable connection error happens while online", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    queryClient.setQueryData(["tasks"], [{ id: "task-1", title: "Delete me", status: "todo" }]);
    deleteTaskApi.mockRejectedValueOnce(createRecoverableError());

    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { useOfflineMutation } = await import("./useOfflineMutation");
    const { result } = renderHook(() => useOfflineMutation(), { wrapper });

    await result.current.deleteTask("task-1", { skipDeletedRecord: true });

    expect(queueMutation).toHaveBeenCalledWith({
      type: "delete",
      id: "task-1",
    });
    expect(queryClient.getQueryData(["tasks"])).toEqual([]);
  });

  it("creates a one-time snapshot and advances the recurring task due date", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    queryClient.setQueryData(["tasks"], [
      {
        id: "task-1",
        title: "Recurring",
        status: "todo",
        recurrence: "daily",
        recurrence_end_date: "",
        due_date: "2026-03-28",
        completed_at: "",
      },
      {
        id: "subtask-1",
        title: "Child",
        parent_id: "task-1",
        status: "done",
        completed_at: "2026-03-28T10:00:00.000Z",
      },
    ]);

    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { useOfflineMutation } = await import("./useOfflineMutation");
    const { result } = renderHook(() => useOfflineMutation(), { wrapper });

    await result.current.completeRecurringTask({
      id: "task-1",
      title: "Recurring",
      status: "todo",
      recurrence: "daily",
      recurrence_end_date: "",
      due_date: "2026-03-28",
      completed_at: "",
    });

    // Should NOT call recordDeletion — uses createTask for snapshot instead
    expect(recordDeletion).not.toHaveBeenCalled();

    // Should create a one-time snapshot task
    expect(taskCreateApi).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Recurring",
        status: "done",
        task_type: "one_time",
        due_date: "2026-03-28",
      })
    );

    // Should advance the recurring task
    expect(updateTaskApi).toHaveBeenCalledWith("task-1", {
      due_date: "2026-03-29",
      status: "todo",
      completed_at: "",
    });

    // Recurring task should be in cache with new due date
    expect(queryClient.getQueryData(["tasks"])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "task-1",
          due_date: "2026-03-29",
          status: "todo",
          completed_at: "",
        }),
      ])
    );
  });

  it("can complete the same recurring task again after moving it back to the original day", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    queryClient.setQueryData(["tasks"], [
      {
        id: "task-1",
        title: "Recurring",
        status: "todo",
        recurrence: "daily",
        recurrence_end_date: "",
        due_date: "2026-03-28",
        completed_at: "",
      },
    ]);

    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { useOfflineMutation } = await import("./useOfflineMutation");
    const { result } = renderHook(() => useOfflineMutation(), { wrapper });

    await result.current.completeRecurringTask({
      id: "task-1",
      title: "Recurring",
      status: "todo",
      recurrence: "daily",
      recurrence_end_date: "",
      due_date: "2026-03-28",
      completed_at: "",
    });

    await result.current.updateTask("task-1", { due_date: "2026-03-28" });

    await result.current.completeRecurringTask({
      id: "task-1",
      title: "Recurring",
      status: "todo",
      recurrence: "daily",
      recurrence_end_date: "",
      due_date: "2026-03-28",
      completed_at: "",
    });

    // Should create snapshot tasks, not recordDeletion calls
    expect(recordDeletion).not.toHaveBeenCalled();
    // createTask called twice for snapshots (once per completion)
    expect(taskCreateApi.mock.calls.filter(([d]) => d.task_type === "one_time" && d.status === "done")).toHaveLength(2);

    expect(queryClient.getQueryData(["tasks"])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "task-1",
          due_date: "2026-03-29",
          status: "todo",
          completed_at: "",
        }),
      ])
    );
  });
});
