// @ts-nocheck
/**
 * @file CHARACTERIZATION tests for offline replay. These pin the CURRENT
 * behavior of the four legacy entities (Task, Priority, SavedTag,
 * DeletedTask) so the migration onto offlineEntityRegistry can prove it
 * changed nothing. They must pass IDENTICALLY before and after every
 * migration commit — if one needs editing to go green, that edit IS the
 * regression, so stop and re-read the diff.
 *
 * Deliberately different from useOfflineData.test.jsx: that one mocks
 * @/lib/offlineCache, these drive the REAL module against happy-dom's
 * localStorage. That's what makes the storage-key invariant meaningful —
 * users have queued-but-unsynced mutations sitting under those exact keys
 * from before the deploy, and replay must keep consuming them.
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const taskCreate = vi.fn();
const taskUpdate = vi.fn();
const taskDelete = vi.fn();
const priorityCreate = vi.fn();
const priorityUpdate = vi.fn();
const priorityDelete = vi.fn();
const tagCreate = vi.fn();
const tagDelete = vi.fn();
const deletedCreate = vi.fn();
const deletedUpdate = vi.fn();
const deletedDelete = vi.fn();

vi.mock("@/api/apiClient", () => ({
  apiClient: {
    entities: {
      Task: { create: (...a) => taskCreate(...a), update: (...a) => taskUpdate(...a), delete: (...a) => taskDelete(...a) },
      Priority: { create: (...a) => priorityCreate(...a), update: (...a) => priorityUpdate(...a), delete: (...a) => priorityDelete(...a) },
      SavedTag: { create: (...a) => tagCreate(...a), delete: (...a) => tagDelete(...a) },
      DeletedTask: { create: (...a) => deletedCreate(...a), update: (...a) => deletedUpdate(...a), delete: (...a) => deletedDelete(...a) },
      Note: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      DeletedNote: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    },
  },
}));

import { useOfflineData } from "./useOfflineData";
import {
  getPendingMutations,
  getPendingPriorityMutations,
  getPendingTagMutations,
  getPendingDeletedTaskMutations,
  queueMutation,
  queuePriorityMutation,
  queueTagMutation,
  queueDeletedTaskMutation,
  loadFromCache,
} from "@/lib/offlineCache";

/** The exact legacy storage keys users already have data under. */
const LEGACY_KEYS = {
  tasks: "taskflow_pending_mutations",
  priorities: "taskflow_pending_priority_mutations",
  tags: "taskflow_pending_tag_mutations",
  deletedTasks: "taskflow_pending_deleted_task_mutations",
};

/** Write a queue straight to localStorage under the scoped legacy key,
 * exactly as a pre-deploy build would have left it. */
function seedRawQueue(baseKey, entries) {
  const scoped = Object.keys(localStorage).find((k) => k.startsWith(baseKey));
  localStorage.setItem(scoped || baseKey, JSON.stringify(entries));
}

function Harness() {
  useOfflineData();
  return null;
}

async function replay(queryClient) {
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>
  );
  // useOfflineData replays on mount when navigator.onLine is true.
  await waitFor(() => {}, { timeout: 50 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 30));
}

describe("offline replay characterization", () => {
  let queryClient;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    taskCreate.mockResolvedValue({ id: "real_task" });
    priorityCreate.mockResolvedValue({ id: "real_priority" });
    deletedCreate.mockResolvedValue({ id: "real_deleted" });
    taskUpdate.mockResolvedValue({});
    taskDelete.mockResolvedValue({});
    priorityUpdate.mockResolvedValue({});
    priorityDelete.mockResolvedValue({});
    tagCreate.mockResolvedValue({});
    tagDelete.mockResolvedValue({});
    deletedUpdate.mockResolvedValue({});
    deletedDelete.mockResolvedValue({});
  });

  describe("Task", () => {
    it("remaps an offline subtask's parent_id to the parent's real id, and fixes both id and parent_id in the cache", async () => {
      taskCreate
        .mockResolvedValueOnce({ id: "server_parent" })
        .mockResolvedValueOnce({ id: "server_child" });
      queueMutation({ type: "create", data: { title: "parent", _offlineId: "offline_p" } });
      queueMutation({ type: "create", data: { title: "child", parent_id: "offline_p", _offlineId: "offline_c" } });
      queryClient.setQueryData(["tasks"], [
        { id: "offline_p", title: "parent" },
        { id: "offline_c", title: "child", parent_id: "offline_p" },
      ]);

      await replay(queryClient);

      expect(taskCreate).toHaveBeenNthCalledWith(1, { title: "parent" });
      // The child's parent_id was rewritten to the parent's REAL id.
      expect(taskCreate).toHaveBeenNthCalledWith(2, { title: "child", parent_id: "server_parent" });
      const cached = queryClient.getQueryData(["tasks"]);
      expect(cached).toEqual([
        { id: "server_parent", title: "parent" },
        { id: "server_child", title: "child", parent_id: "server_parent" },
      ]);
      expect(getPendingMutations()).toEqual([]);
    });

    it("skips updates and deletes whose id is still an unsynced offline id", async () => {
      queueMutation({ type: "update", id: "offline_never", data: { title: "x" } });
      queueMutation({ type: "delete", id: "offline_never" });

      await replay(queryClient);

      expect(taskUpdate).not.toHaveBeenCalled();
      expect(taskDelete).not.toHaveBeenCalled();
      expect(getPendingMutations()).toEqual([]);
    });

    it("resolves an update queued against an id created earlier in the same run", async () => {
      taskCreate.mockResolvedValueOnce({ id: "server_x" });
      queueMutation({ type: "create", data: { title: "x", _offlineId: "offline_x" } });
      queueMutation({ type: "update", id: "offline_x", data: { title: "x2" } });

      await replay(queryClient);

      expect(taskUpdate).toHaveBeenCalledWith("server_x", { title: "x2" });
    });

    it("retains a failed mutation and still processes the rest", async () => {
      taskCreate.mockRejectedValueOnce(new Error("boom"));
      queueMutation({ type: "create", data: { title: "flaky", _offlineId: "offline_f" } });
      queueMutation({ type: "delete", id: "server_ok" });

      await replay(queryClient);

      const remaining = getPendingMutations();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].data._offlineId).toBe("offline_f");
      expect(taskDelete).toHaveBeenCalledWith("server_ok");
    });
  });

  describe("Priority", () => {
    it("creates, id-swaps the cache, and resolves later ops through the run's map", async () => {
      priorityCreate.mockResolvedValueOnce({ id: "server_pri" });
      queuePriorityMutation({ type: "create", data: { name: "Urgent", color: "red", order: 0, _offlineId: "offline_pr" } });
      queuePriorityMutation({ type: "update", id: "offline_pr", data: { name: "Urgent!" } });
      queuePriorityMutation({ type: "delete", id: "server_other" });
      queryClient.setQueryData(["priorities"], [{ id: "offline_pr", name: "Urgent" }]);

      await replay(queryClient);

      expect(priorityCreate).toHaveBeenCalledWith({ name: "Urgent", color: "red", order: 0 });
      expect(queryClient.getQueryData(["priorities"])).toEqual([{ id: "server_pri", name: "Urgent" }]);
      expect(priorityUpdate).toHaveBeenCalledWith("server_pri", { name: "Urgent!" });
      expect(priorityDelete).toHaveBeenCalledWith("server_other");
      expect(getPendingPriorityMutations()).toEqual([]);
    });

    it("retains failures", async () => {
      priorityCreate.mockRejectedValueOnce(new Error("nope"));
      queuePriorityMutation({ type: "create", data: { name: "X", _offlineId: "offline_bad" } });

      await replay(queryClient);

      expect(getPendingPriorityMutations()).toHaveLength(1);
    });
  });

  describe("SavedTag (name-keyed legacy shape)", () => {
    it("replays a create from the bare {type,name} entry and a delete by id", async () => {
      // NOTE the shape: no data wrapper, no _offlineId. Pre-deploy builds
      // wrote exactly this, so it must keep replaying forever.
      queueTagMutation({ type: "create", name: "work" });
      queueTagMutation({ type: "delete", id: "tag_123" });

      await replay(queryClient);

      expect(tagCreate).toHaveBeenCalledWith({ name: "work" });
      expect(tagDelete).toHaveBeenCalledWith("tag_123");
      expect(getPendingTagMutations()).toEqual([]);
    });

    it("retains failures", async () => {
      tagCreate.mockRejectedValueOnce(new Error("nope"));
      queueTagMutation({ type: "create", name: "flaky" });

      await replay(queryClient);

      expect(getPendingTagMutations()).toHaveLength(1);
    });
  });

  describe("DeletedTask", () => {
    it("id-swaps the query cache AND write-throughs the offline cache", async () => {
      deletedCreate.mockResolvedValueOnce({ id: "server_del" });
      queueDeletedTaskMutation({ type: "create", data: { task_id: "t1", title: "gone", _offlineId: "offline_d" } });
      queryClient.setQueryData(["deletedTasks"], [{ id: "offline_d", title: "gone" }]);

      await replay(queryClient);

      expect(deletedCreate).toHaveBeenCalledWith({ task_id: "t1", title: "gone" });
      expect(queryClient.getQueryData(["deletedTasks"])).toEqual([{ id: "server_del", title: "gone" }]);
      // The write-through is what keeps the trash correct across reloads.
      expect(loadFromCache("deletedTasks")).toEqual([{ id: "server_del", title: "gone" }]);
      expect(getPendingDeletedTaskMutations()).toEqual([]);
    });

    it("resolves updates/deletes through the run's map and skips unsynced ids", async () => {
      deletedCreate.mockResolvedValueOnce({ id: "server_d2" });
      queueDeletedTaskMutation({ type: "create", data: { title: "a", _offlineId: "offline_d2" } });
      queueDeletedTaskMutation({ type: "update", id: "offline_d2", data: { expires_at: "later" } });
      queueDeletedTaskMutation({ type: "delete", id: "offline_unknown" });

      await replay(queryClient);

      expect(deletedUpdate).toHaveBeenCalledWith("server_d2", { expires_at: "later" });
      expect(deletedDelete).not.toHaveBeenCalled();
    });
  });

  describe("storage-key invariant (survives every migration commit)", () => {
    it("consumes queues written under the exact legacy localStorage keys", async () => {
      // Prime the scoped keys by queueing once, then overwrite raw.
      queueMutation({ type: "delete", id: "seed" });
      queuePriorityMutation({ type: "delete", id: "seed" });
      queueTagMutation({ type: "delete", id: "seed" });
      queueDeletedTaskMutation({ type: "delete", id: "seed" });

      seedRawQueue(LEGACY_KEYS.tasks, [{ type: "delete", id: "legacy_task" }]);
      seedRawQueue(LEGACY_KEYS.priorities, [{ type: "delete", id: "legacy_priority" }]);
      seedRawQueue(LEGACY_KEYS.tags, [{ type: "delete", id: "legacy_tag" }]);
      seedRawQueue(LEGACY_KEYS.deletedTasks, [{ type: "delete", id: "legacy_deleted" }]);

      await replay(queryClient);

      expect(taskDelete).toHaveBeenCalledWith("legacy_task");
      expect(priorityDelete).toHaveBeenCalledWith("legacy_priority");
      expect(tagDelete).toHaveBeenCalledWith("legacy_tag");
      expect(deletedDelete).toHaveBeenCalledWith("legacy_deleted");
      expect(getPendingMutations()).toEqual([]);
      expect(getPendingPriorityMutations()).toEqual([]);
      expect(getPendingTagMutations()).toEqual([]);
      expect(getPendingDeletedTaskMutations()).toEqual([]);
    });
  });
});
