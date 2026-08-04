// @ts-nocheck — vi.mock'd apiClient methods carry mock APIs TS can't see.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

vi.mock("@/api/apiClient", () => ({
  apiClient: {
    entities: {
      Note: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      Linked: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    },
  },
}));

import { apiClient } from "@/api/apiClient";
import {
  NoteOffline,
  getOfflineEntityHandle,
  registerOfflineEntity,
  registeredCacheKeys,
  replayRegisteredEntities,
} from "./offlineEntityRegistry";

// Extra registration exercising remapFields (cross-entity task-id remap).
const LinkedOffline = registerOfflineEntity({
  name: "Linked",
  cacheKey: "linked",
  queueKey: "pendingLinkedMutations",
  remapFields: { task_id: "Task" },
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

/* ── Capabilities the legacy entities need in order to migrate ────── */

describe("registry capabilities for legacy entities", () => {
  let queryClient;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    queryClient = new QueryClient();
  });

  it("storageKeys pins the exact legacy localStorage names", () => {
    const Legacy = registerOfflineEntity({
      name: "LegacyKeyed",
      cacheKey: "legacyKeyed",
      queueKey: "pendingLegacyKeyedMutations",
      storageKeys: { cache: "taskflow_offline_legacy", queue: "taskflow_pending_legacy_mutations" },
    });
    Legacy.queueMutation({ type: "delete", id: "x" });
    const key = Object.keys(localStorage).find((k) => k.startsWith("taskflow_pending_legacy_mutations"));
    expect(key).toBeTruthy(); // NOT the derived taskflow_pending_legacyKeyed_mutations
    expect(Object.keys(localStorage).some((k) => k.includes("legacyKeyed"))).toBe(false);
  });

  it("selfRemapFields resolves offline child → offline parent within one run", async () => {
    const SelfRef = registerOfflineEntity({
      name: "SelfRef",
      cacheKey: "selfRef",
      queueKey: "pendingSelfRefMutations",
      selfRemapFields: ["parent_id"],
    });
    apiClient.entities.SelfRef = { create: vi.fn(), update: vi.fn(), delete: vi.fn() };
    apiClient.entities.SelfRef.create
      .mockResolvedValueOnce({ id: "real_parent" })
      .mockResolvedValueOnce({ id: "real_child" });
    SelfRef.queueMutation({ type: "create", data: { title: "p", _offlineId: "offline_p" } });
    SelfRef.queueMutation({ type: "create", data: { title: "c", parent_id: "offline_p", _offlineId: "offline_c" } });

    await replayRegisteredEntities(queryClient, {});

    expect(apiClient.entities.SelfRef.create).toHaveBeenNthCalledWith(2, { title: "c", parent_id: "real_parent" });
  });

  it("applyIdSwap replaces the default cache swap", async () => {
    const swaps = [];
    const Custom = registerOfflineEntity({
      name: "CustomSwap",
      cacheKey: "customSwap",
      queueKey: "pendingCustomSwapMutations",
      applyIdSwap: ({ offlineId, realId }) => { swaps.push([offlineId, realId]); },
    });
    apiClient.entities.CustomSwap = { create: vi.fn(), update: vi.fn(), delete: vi.fn() };
    apiClient.entities.CustomSwap.create.mockResolvedValue({ id: "real_c" });
    queryClient.setQueryData(["customSwap"], [{ id: "offline_c", title: "x" }]);
    Custom.queueMutation({ type: "create", data: { title: "x", _offlineId: "offline_c" } });

    await replayRegisteredEntities(queryClient, {});

    expect(swaps).toEqual([["offline_c", "real_c"]]);
    // Default swap did NOT also run.
    expect(queryClient.getQueryData(["customSwap"])).toEqual([{ id: "offline_c", title: "x" }]);
  });

  it("normalizeEntry adapts a historical entry shape on read", () => {
    const Named = registerOfflineEntity({
      name: "NameKeyed",
      cacheKey: "nameKeyed",
      queueKey: "pendingNameKeyedMutations",
      // Mirrors SavedTag: old entries are {type:'create', name}.
      normalizeEntry: (m) =>
        m.type === "create" && !m.data && m.name ? { ...m, data: { name: m.name } } : m,
    });
    // Simulate a pre-deploy entry sitting in storage.
    Named.setPending([{ type: "create", name: "work" }]);
    expect(Named.getPending()[0].data).toEqual({ name: "work" });
    // Idempotent on already-normalized entries.
    Named.setPending([{ type: "create", data: { name: "already" } }]);
    expect(Named.getPending()[0].data).toEqual({ name: "already" });
  });

  it("dequeueCreateWhere removes a queued create by an arbitrary predicate", () => {
    const Named = getOfflineEntityHandle("NameKeyed");
    Named.setPending([
      { type: "create", data: { name: "keep" } },
      { type: "create", data: { name: "drop" } },
      { type: "delete", id: "d1" },
    ]);
    Named.dequeueCreateWhere((m) => m.data?.name === "drop");
    expect(Named.getPending().map((m) => m.data?.name ?? m.id)).toEqual(["keep", "d1"]);
  });
});
