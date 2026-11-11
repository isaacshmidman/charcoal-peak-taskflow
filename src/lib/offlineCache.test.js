// @ts-nocheck
/**
 * The offline copy of each list, and the queues of changes waiting to be
 * sent: when they are written, and what happens when the device is full.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A device's storage, with a set amount of room. (The test browser's own
 * can't be spied on or filled.)
 */
function device() {
  const items = new Map();
  const storage = {
    limit: Infinity,
    writes: 0,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem(key, value) {
      let used = 0;
      for (const [k, v] of items) if (k !== key) used += v.length;
      if (used + String(value).length > storage.limit) throw new DOMException("full", "QuotaExceededError");
      storage.writes += 1;
      items.set(key, String(value));
    },
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
    keys: () => [...items.keys()],
    used: () => [...items.values()].reduce((n, v) => n + v.length, 0),
  };
  return storage;
}

let storage;
const stored = (prefix) => {
  const key = storage.keys().find((k) => k.startsWith(prefix));
  return key ? JSON.parse(storage.getItem(key)) : undefined;
};

let cache;
let events;
const onStorage = (event) => events.push(event.detail);

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  storage = device();
  vi.stubGlobal("localStorage", storage);
  storage.setItem("taskflow_local_session", JSON.stringify({ id: "user-1", email: "isaac@example.com" }));
  cache = await import("./offlineCache");
  storage.writes = 0;
  events = [];
  window.addEventListener(cache.STORAGE_FULL_EVENT, onStorage);
});
afterEach(() => {
  window.removeEventListener(cache.STORAGE_FULL_EVENT, onStorage);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the offline copy of a list", () => {
  it("is written once, a moment later, however many times the list changed", () => {
    cache.saveSnapshot("tasks", [{ id: 1 }]);
    cache.saveSnapshot("tasks", [{ id: 1 }, { id: 2 }]);
    cache.saveSnapshot("tasks", [{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(storage.writes).toBe(0);

    vi.advanceTimersByTime(500);
    expect(storage.writes).toBe(1);
    expect(stored("taskflow_offline_tasks")).toHaveLength(3);
  });

  it("is not written again for the very same list", () => {
    const list = [{ id: 1 }];
    cache.saveSnapshot("tasks", list);
    vi.advanceTimersByTime(500);
    expect(storage.writes).toBe(1);

    cache.saveSnapshot("tasks", list);
    cache.saveSnapshot("tasks", list);
    vi.advanceTimersByTime(500);
    expect(storage.writes).toBe(1);

    // An equal list that is a different object is a change as far as this
    // can tell, and is written.
    cache.saveSnapshot("tasks", [{ id: 1 }]);
    vi.advanceTimersByTime(500);
    expect(storage.writes).toBe(2);
  });

  it("is written straight away with no connection", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    cache.saveSnapshot("tasks", [{ id: "offline_1", title: "Made offline" }]);
    expect(stored("taskflow_offline_tasks")).toEqual([{ id: "offline_1", title: "Made offline" }]);
  });

  it("is written before anything reads it, and when the page is hidden", () => {
    cache.saveSnapshot("tasks", [{ id: 1 }]);
    expect(cache.loadFromCache("tasks")).toEqual([{ id: 1 }]);

    cache.saveSnapshot("priorities", [{ id: "p" }]);
    window.dispatchEvent(new Event("pagehide"));
    expect(stored("taskflow_offline_priorities")).toEqual([{ id: "p" }]);
  });

  it("goes under the name of whoever was signed in when it changed", () => {
    cache.saveSnapshot("tasks", [{ id: 1, title: "Isaac's" }]);
    // Signed out, and someone else in, before the write happened.
    storage.setItem("taskflow_local_session", JSON.stringify({ id: "user-2", email: "other@example.com" }));
    vi.advanceTimersByTime(500);

    const names = storage.keys().filter((k) => k.startsWith("taskflow_offline_tasks"));
    expect(names).toHaveLength(1);
    expect(names[0].endsWith("::isaac@example.com")).toBe(true);
    expect(JSON.parse(storage.getItem(names[0]))).toEqual([{ id: 1, title: "Isaac's" }]);
    expect(cache.loadFromCache("tasks")).toBeNull();
  });

  it("says so, once, when the device is too full to hold it — and again when it fits", () => {
    cache.saveToCache("tasks", [{ id: 1 }]);
    storage.limit = storage.used() + 200;
    const big = Array.from({ length: 40 }, (_, id) => ({ id, title: "A task with a title" }));

    cache.saveSnapshot("tasks", big);
    vi.advanceTimersByTime(500);
    expect(events).toEqual([{ key: "tasks", kept: false }]);
    expect(cache.offlineCopyIsBehind()).toBe(true);
    // The older copy is still there to read.
    expect(stored("taskflow_offline_tasks")).toEqual([{ id: 1 }]);

    cache.saveSnapshot("tasks", [...big, { id: 99 }]);
    vi.advanceTimersByTime(500);
    expect(events).toHaveLength(1);

    storage.limit = Infinity;
    cache.saveSnapshot("tasks", [{ id: 1 }, { id: 2 }]);
    vi.advanceTimersByTime(500);
    expect(events[1]).toEqual({ key: "tasks", kept: true });
    expect(cache.offlineCopyIsBehind()).toBe(false);
  });
});

describe("a queue of changes on a full device", () => {
  it("makes room by giving up the Recently Deleted copies, and keeps the change", () => {
    cache.defineCacheKeys({ deletedNotes: "taskflow_offline_deletedNotes" });
    cache.saveToCache("deletedTasks", Array.from({ length: 20 }, (_, id) => ({ id, title: "Deleted a while ago" })));
    cache.saveToCache("tasks", [{ id: 1, title: "Kept" }]);
    storage.limit = storage.used() + 20;

    const kept = cache.saveToCache("pendingMutations", [{ type: "update", id: "1", data: { title: "Changed offline" } }]);
    expect(kept).toBe(true);
    expect(stored("taskflow_pending_mutations")).toHaveLength(1);
    expect(stored("taskflow_offline_deletedTasks")).toBeUndefined();
    expect(stored("taskflow_offline_tasks")).toEqual([{ id: 1, title: "Kept" }]);
    expect(events).toEqual([{ key: "pendingMutations", kept: true, madeRoom: true }]);
  });

  it("says the change was not kept when there is no room to make", () => {
    cache.saveToCache("tasks", [{ id: 1, title: "Kept" }]);
    storage.limit = storage.used() + 5;

    const kept = cache.saveToCache("pendingMutations", [{ type: "update", id: "1", data: { title: "Changed offline" } }]);
    expect(kept).toBe(false);
    expect(events).toEqual([{ key: "pendingMutations", kept: false }]);
  });
});
