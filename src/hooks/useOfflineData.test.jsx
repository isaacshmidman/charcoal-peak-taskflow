import React from "react";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let pendingMutations = [];
const setPendingMutations = vi.fn((next) => {
  pendingMutations = next;
});

const taskCreate = vi.fn();

vi.mock("@/api/apiClient", () => ({
  apiClient: {
    entities: {
      Task: {
        create: taskCreate,
        update: vi.fn(),
        delete: vi.fn(),
      },
      Priority: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      SavedTag: {
        create: vi.fn(),
        delete: vi.fn(),
      },
      DeletedTask: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
  },
}));

vi.mock("@/lib/offlineCache", () => ({
  saveToCache: vi.fn(),
  getPendingMutations: () => pendingMutations,
  setPendingMutations,
  getPendingPriorityMutations: () => [],
  setPendingPriorityMutations: vi.fn(),
  getPendingTagMutations: () => [],
  setPendingTagMutations: vi.fn(),
  getPendingDeletedTaskMutations: () => [],
  setPendingDeletedTaskMutations: vi.fn(),
  updateDeletedTasksCache: vi.fn(),
}));

describe("useOfflineData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pendingMutations = [];
  });

  it("keeps failed task replays queued instead of dropping them", async () => {
    pendingMutations = [
      {
        type: "create",
        data: { title: "Offline task", _offlineId: "offline_1" },
      },
    ];

    taskCreate.mockRejectedValueOnce(new Error("Still offline"));

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    const { useOfflineData } = await import("./useOfflineData");

    const TestHarness = () => {
      useOfflineData();
      return null;
    };

    render(
      <QueryClientProvider client={queryClient}>
        <TestHarness />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(setPendingMutations).toHaveBeenCalledWith([
        {
          type: "create",
          data: { title: "Offline task", _offlineId: "offline_1" },
        },
      ]);
    });
  });
});
