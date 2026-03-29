import React from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const deletedTaskCreateApi = vi.fn();
const queueDeletedTaskMutation = vi.fn();

vi.mock("@/api/apiClient", () => ({
  apiClient: {
    entities: {
      DeletedTask: {
        create: deletedTaskCreateApi,
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
  },
}));

vi.mock("@/lib/offlineCache", () => ({
  isOnline: vi.fn(() => true),
  queueDeletedTaskMutation,
  updateDeletedTasksCache: vi.fn(),
}));

describe("useDeletedTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues deleted records when the connection fails during deletion capture", async () => {
    deletedTaskCreateApi.mockRejectedValueOnce(Object.assign(new Error("Network down"), { status: undefined }));

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { useDeletedTasks } = await import("./useDeletedTasks");
    const { result } = renderHook(() => useDeletedTasks(), { wrapper });

    const deletedRecordId = await result.current.recordDeletion({
      id: "task-1",
      title: "Queued delete",
      status: "todo",
      task_type: "one_time",
      recurrence: "none",
      recurrence_days: [],
      recurrence_end_date: "",
      due_date: "2026-03-29",
      task_time: "",
      tags: [],
      completed_at: "",
    });

    expect(deletedRecordId).toMatch(/^offline_/);
    expect(queueDeletedTaskMutation).toHaveBeenCalledWith({
      type: "create",
      data: expect.objectContaining({
        task_id: "task-1",
        title: "Queued delete",
        _offlineId: deletedRecordId,
      }),
    });
    expect(queryClient.getQueryData(["deletedTasks"])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: deletedRecordId,
          title: "Queued delete",
        }),
      ])
    );
  });
});
