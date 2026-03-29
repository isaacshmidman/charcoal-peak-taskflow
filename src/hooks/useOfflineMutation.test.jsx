import React from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const updateTaskApi = vi.fn();
const recordDeletion = vi.fn();

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      Task: {
        create: vi.fn(),
        update: updateTaskApi,
        delete: vi.fn(),
      },
    },
  },
}));

vi.mock("@/lib/offlineCache", () => ({
  isOnline: vi.fn(() => true),
  queueMutation: vi.fn(),
  dequeueOfflineCreate: vi.fn(),
  updateQueuedCreate: vi.fn(),
}));

vi.mock("@/hooks/useDeletedTasks", () => ({
  useDeletedTasks: () => ({
    recordDeletion,
  }),
}));

describe("useOfflineMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records the completed recurring instance and advances the due date", async () => {
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
        status: "todo",
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

    expect(recordDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "task-1",
        status: "done",
      }),
      [
        expect.objectContaining({
          id: "subtask-1",
        }),
      ]
    );
    expect(updateTaskApi).toHaveBeenCalledWith("task-1", {
      due_date: "2026-03-29",
      status: "todo",
      completed_at: "",
    });

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
