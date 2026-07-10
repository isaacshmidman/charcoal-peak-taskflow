// @ts-nocheck — vi.mock'd apiClient methods carry mock APIs TS can't see.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

vi.mock("@/api/apiClient", () => ({
  apiClient: {
    entities: {
      Note: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      SavedView: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      Linked: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    },
  },
}));

import { apiClient } from "@/api/apiClient";
import {
  NoteOffline,
  registerOfflineEntity,
  registeredCacheKeys,
  replayRegisteredEntities,
} from "./offlineEntityRegistry";

// Extra registration exercising remapFields (cross-entity task-id remap).
const LinkedOffline = registerOfflineEntity({
  name: "Linked",
  cacheKey: "linked",
  queueKey: "pendingLinkedMutations",
  remapFields: ["task_id"],
});

describe("offlineEntityRegistry", () => {
  let queryClient;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    queryClient = new QueryClient();
  });

  it("registers cache keys for persistence subscription", () => {
    const keys = registeredCacheKeys();
    expect(keys).toContain("notes");
    expect(keys).toContain("savedViews");
    expect(keys).toContain("linked");
  });

  it("scopes queue storage keys per user", () => {
    NoteOffline.queueMutation({ type: "create", data: { title: "x", _offlineId: "offline_1" } });
    const rawKeys = Object.keys(localStorage);
    const queueKey = rawKeys.find((k) => k.startsWith("taskflow_pending_notes_mutations"));
    expect(queueKey).toBeTruthy();
    expect(queueKey).toContain("::"); // app/user scope suffix applied
  });

  it("queues, replays a create, and id-swaps the query cache", async () => {
    queryClient.setQueryData(["notes"], [{ id: "offline_1", title: "draft" }]);
    NoteOffline.queueMutation({ type: "create", data: { title: "draft", _offlineId: "offline_1" } });
    apiClient.entities.Note.create.mockResolvedValue({ id: "note_real_1", title: "draft" });

    await replayRegisteredEntities(queryClient, {});

    expect(apiClient.entities.Note.create).toHaveBeenCalledWith({ title: "draft" }); // _offlineId stripped
    expect(queryClient.getQueryData(["notes"])).toEqual([{ id: "note_real_1", title: "draft" }]);
    expect(NoteOffline.getPending()).toEqual([]);
  });

  it("resolves update/delete ids created earlier in the same replay", async () => {
    NoteOffline.queueMutation({ type: "create", data: { title: "a", _offlineId: "offline_a" } });
    NoteOffline.queueMutation({ type: "update", id: "offline_a", data: { title: "a2" } });
    NoteOffline.queueMutation({ type: "delete", id: "offline_never_created" });
    apiClient.entities.Note.create.mockResolvedValue({ id: "note_a" });
    apiClient.entities.Note.update.mockResolvedValue({});

    await replayRegisteredEntities(queryClient, {});

    expect(apiClient.entities.Note.update).toHaveBeenCalledWith("note_a", { title: "a2" });
    expect(apiClient.entities.Note.delete).not.toHaveBeenCalled(); // still-offline id skipped
    expect(NoteOffline.getPending()).toEqual([]);
  });

  it("remaps configured fields through the shared task id map", async () => {
    LinkedOffline.queueMutation({
      type: "create",
      data: { task_id: "offline_task_9", label: "ref", _offlineId: "offline_l1" },
    });
    apiClient.entities.Linked.create.mockResolvedValue({ id: "linked_1" });

    await replayRegisteredEntities(queryClient, { offline_task_9: "task_real_9" });

    expect(apiClient.entities.Linked.create).toHaveBeenCalledWith({ task_id: "task_real_9", label: "ref" });
  });

  it("retains failed mutations for the next pass", async () => {
    NoteOffline.queueMutation({ type: "create", data: { title: "flaky", _offlineId: "offline_f" } });
    NoteOffline.queueMutation({ type: "update", id: "note_ok", data: { title: "fine" } });
    apiClient.entities.Note.create.mockRejectedValue(new Error("boom"));
    apiClient.entities.Note.update.mockResolvedValue({});

    await replayRegisteredEntities(queryClient, {});

    const pending = NoteOffline.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].data._offlineId).toBe("offline_f");
    expect(apiClient.entities.Note.update).toHaveBeenCalled(); // failure didn't block the rest
  });

  it("folds edits and deletes into a queued create", () => {
    NoteOffline.queueMutation({ type: "create", data: { title: "v1", _offlineId: "offline_e" } });
    NoteOffline.updateQueuedCreate("offline_e", { title: "v2" });
    expect(NoteOffline.getPending()[0].data.title).toBe("v2");
    NoteOffline.dequeueCreate("offline_e");
    expect(NoteOffline.getPending()).toEqual([]);
  });
});
