// @ts-nocheck
/**
 * The big lists kept in IndexedDB (lib/offlineListStore.js) with a copy in
 * memory: read before the app draws, moved over from localStorage once,
 * and never the reason a queued change has no room.
 */
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signIn = (email) => localStorage.setItem("taskflow_local_session", JSON.stringify({ id: `id-${email}`, email }));

/** A page being opened: fresh modules, the same device. */
async function openPage() {
  vi.resetModules();
  const cache = await import("./offlineCache");
  const store = await import("./offlineListStore");
  return { cache, store };
}

async function until(check, what = "the condition") {
  for (let tries = 0; tries < 200; tries += 1) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 5));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** What IndexedDB holds for a list, parsed. */
async function onDisk(store, prefix) {
  const all = await store.readAllLists();
  const key = [...all.keys()].find((k) => k.startsWith(prefix));
  return key ? JSON.parse(all.get(key)) : undefined;
}

const localKeys = () => Object.keys(localStorage);
let pages = [];
async function page() {
  const opened = await openPage();
  pages.push(opened);
  return opened;
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.clear();
  signIn("isaac@example.com");
  pages = [];
});
afterEach(async () => {
  for (const { cache, store } of pages) {
    cache.forgetOfflineCopyInMemory();
    await store.closeListStore();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the lists kept on the device", () => {
  it("can be read the moment they are saved, and are on the disk a moment later, not in localStorage", async () => {
    const { cache, store } = await page();
    expect(await cache.hydrateOfflineCopy()).toBe(true);
    const tasks = [{ id: "t1", title: "One" }];

    cache.saveSnapshot("tasks", tasks);
    expect(cache.loadFromCache("tasks")).toBe(tasks);
    cache.flushSnapshots();
    await until(async () => (await onDisk(store, "taskflow_offline_tasks")) !== undefined, "the list to reach IndexedDB");

    expect(await onDisk(store, "taskflow_offline_tasks")).toEqual(tasks);
    expect(localKeys().some((key) => key.startsWith("taskflow_offline_tasks"))).toBe(false);
  });

  it("are there when the app is opened again, before anything is drawn", async () => {
    const first = await page();
    await first.cache.hydrateOfflineCopy();
    first.cache.saveSnapshot("tasks", [{ id: "t1", title: "Kept" }]);
    first.cache.flushSnapshots();
    await until(async () => (await onDisk(first.store, "taskflow_offline_tasks")) !== undefined);
    await first.store.closeListStore();

    const second = await page();
    // Not yet read: nothing to show.
    expect(second.cache.loadFromCache("tasks")).toBeNull();
    await second.cache.hydrateOfflineCopy();
    expect(second.cache.loadFromCache("tasks")).toEqual([{ id: "t1", title: "Kept" }]);
  });

  it("are moved over from localStorage once, and the queues of changes stay where they were", async () => {
    const { cache, store } = await page();
    // The name this person's things go under on this machine (the app's id is part of it).
    cache.saveToCache("pendingMutations", [{ type: "update", id: "t1" }]);
    const queueKey = localKeys().find((key) => key.startsWith("taskflow_pending_mutations::"));
    const scope = queueKey.slice("taskflow_pending_mutations".length);
    // As an earlier version left things: lists in localStorage, one of them under the old unscoped name.
    localStorage.setItem(`taskflow_offline_tasks${scope}`, JSON.stringify([{ id: "t1", title: "From before" }]));
    localStorage.setItem("taskflow_offline_priorities", JSON.stringify([{ id: "p1" }]));
    localStorage.setItem("defaultNav", "/Today");

    await cache.hydrateOfflineCopy();

    // Readable at once, under this person's name or the old unscoped one.
    expect(cache.loadFromCache("tasks")).toEqual([{ id: "t1", title: "From before" }]);
    expect(cache.loadFromCache("priorities")).toEqual([{ id: "p1" }]);

    await until(() => !localKeys().some((key) => key.startsWith("taskflow_offline_")), "the lists to leave localStorage");
    expect(await onDisk(store, "taskflow_offline_priorities")).toEqual([{ id: "p1" }]);
    expect(await onDisk(store, "taskflow_offline_tasks::")).toEqual([{ id: "t1", title: "From before" }]);
    // Not lists: untouched.
    expect(localStorage.getItem(queueKey)).toBe(JSON.stringify([{ type: "update", id: "t1" }]));
    expect(localStorage.getItem("defaultNav")).toBe("/Today");
  });

  it("a list left in localStorage by a visit without IndexedDB is the newer one, and wins", async () => {
    const first = await page();
    await first.cache.hydrateOfflineCopy();
    first.cache.saveSnapshot("priorities", [{ id: "old" }]);
    first.cache.flushSnapshots();
    await until(async () => (await onDisk(first.store, "taskflow_offline_priorities")) !== undefined);
    const key = [...(await first.store.readAllLists()).keys()][0];
    await first.store.closeListStore();

    localStorage.setItem(key, JSON.stringify([{ id: "newer" }]));
    const second = await page();
    await second.cache.hydrateOfflineCopy();
    expect(second.cache.loadFromCache("priorities")).toEqual([{ id: "newer" }]);
    await until(async () => (await onDisk(second.store, "taskflow_offline_priorities"))?.[0]?.id === "newer");
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("belong to whoever was signed in: another person gets none of them", async () => {
    const { cache } = await page();
    await cache.hydrateOfflineCopy();
    cache.saveSnapshot("tasks", [{ id: "t1", title: "Isaac's" }]);
    signIn("someone-else@example.com");
    expect(cache.loadFromCache("tasks")).toBeNull();
    signIn("isaac@example.com");
    expect(cache.loadFromCache("tasks")).toEqual([{ id: "t1", title: "Isaac's" }]);
  });

  it("a list an entity registers lives there too; its queue does not", async () => {
    const { cache, store } = await page();
    cache.defineCacheKeys({ notes: "taskflow_offline_notes", pendingNotes: "taskflow_pending_notes_mutations" }, { lists: ["notes"] });
    await cache.hydrateOfflineCopy();

    cache.saveSnapshot("notes", [{ id: "n1" }]);
    expect(cache.saveToCache("pendingNotes", [{ type: "create", id: "n1" }])).toBe(true);
    cache.flushSnapshots();
    await until(async () => (await onDisk(store, "taskflow_offline_notes")) !== undefined);

    expect(localKeys().some((key) => key.startsWith("taskflow_offline_notes"))).toBe(false);
    expect(localKeys().some((key) => key.startsWith("taskflow_pending_notes_mutations"))).toBe(true);
    expect(cache.loadFromCache("pendingNotes")).toEqual([{ type: "create", id: "n1" }]);
  });

  it("leave localStorage's few megabytes to the queues: a list too big for it is kept all the same", async () => {
    const { cache, store } = await page();
    await cache.hydrateOfflineCopy();
    const events = [];
    const heard = (event) => events.push(event.detail);
    window.addEventListener(cache.STORAGE_FULL_EVENT, heard);
    // localStorage with room for almost nothing.
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function setItem(key, value) {
      if (String(value).length > 2000) throw new DOMException("full", "QuotaExceededError");
      return realSet.call(this, key, value);
    });
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `t${i}`, title: `Task number ${i}`, description: "x".repeat(200) }));

    cache.saveSnapshot("tasks", many);
    cache.flushSnapshots();
    await until(async () => (await onDisk(store, "taskflow_offline_tasks"))?.length === 5000, "5,000 tasks to reach IndexedDB");
    expect(cache.saveToCache("pendingMutations", [{ type: "update", id: "t1" }])).toBe(true);

    window.removeEventListener(cache.STORAGE_FULL_EVENT, heard);
    expect(events).toEqual([]);
    expect(cache.offlineCopyIsBehind()).toBe(false);
  });

  it("a list that goes back to what it was is written again, even while the newer one is on its way", async () => {
    const { cache, store } = await page();
    await cache.hydrateOfflineCopy();
    const before = [{ id: "t1", title: "Before" }];
    const after = [{ id: "t1", title: "After" }];
    cache.saveSnapshot("tasks", before);
    cache.flushSnapshots();
    await until(async () => (await onDisk(store, "taskflow_offline_tasks")) !== undefined);

    // An edit shown at once, then taken back when the server refuses it.
    cache.saveSnapshot("tasks", after);
    cache.flushSnapshots();
    cache.saveSnapshot("tasks", before);
    cache.flushSnapshots();

    await until(async () => (await onDisk(store, "taskflow_offline_tasks"))?.[0]?.title === "Before", "the list as it was to be on disk again");
    expect(cache.loadFromCache("tasks")).toBe(before);
  });

  it("another tab's newer list reaches this tab's memory", async () => {
    expect(typeof BroadcastChannel).toBe("function");
    const tabA = await page();
    const tabB = await page();
    await tabA.cache.hydrateOfflineCopy();
    await tabB.cache.hydrateOfflineCopy();

    tabA.cache.saveSnapshot("tasks", [{ id: "t1", title: "Made in the other tab" }]);
    tabA.cache.flushSnapshots();

    await until(() => tabB.cache.loadFromCache("tasks")?.[0]?.title === "Made in the other tab", "the other tab's list to arrive");
  });
});

describe("when the device's disk can't take a list", () => {
  it("the app is told once, keeps showing its list, and is told again when it fits", async () => {
    vi.resetModules();
    let room = false;
    vi.doMock("./offlineListStore", () => ({
      readAllLists: async () => new Map(),
      readList: async () => null,
      writeLists: async () => room,
    }));
    const cache = await import("./offlineCache");
    await cache.hydrateOfflineCopy();
    const events = [];
    const heard = (event) => events.push(event.detail);
    window.addEventListener(cache.STORAGE_FULL_EVENT, heard);

    cache.saveSnapshot("tasks", [{ id: "t1" }]);
    cache.flushSnapshots();
    await until(() => events.length === 1);
    cache.saveSnapshot("tasks", [{ id: "t1" }, { id: "t2" }]);
    cache.flushSnapshots();
    await new Promise((done) => setTimeout(done, 20));
    expect(events).toEqual([{ key: "tasks", kept: false }]);
    expect(cache.offlineCopyIsBehind()).toBe(true);
    expect(cache.loadFromCache("tasks")).toEqual([{ id: "t1" }, { id: "t2" }]);

    room = true;
    cache.saveSnapshot("tasks", [{ id: "t1" }, { id: "t2" }, { id: "t3" }]);
    cache.flushSnapshots();
    await until(() => events.length === 2);
    expect(events[1]).toEqual({ key: "tasks", kept: true });
    expect(cache.offlineCopyIsBehind()).toBe(false);

    window.removeEventListener(cache.STORAGE_FULL_EVENT, heard);
    cache.forgetOfflineCopyInMemory();
    vi.doUnmock("./offlineListStore");
  });
});

describe("a browser with no IndexedDB", () => {
  it("keeps its lists in localStorage, as before", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const { cache } = await page();
    expect(await cache.hydrateOfflineCopy()).toBe(false);

    cache.saveSnapshot("tasks", [{ id: "t1" }]);
    cache.flushSnapshots();
    expect(localKeys().some((key) => key.startsWith("taskflow_offline_tasks"))).toBe(true);
    expect(cache.loadFromCache("tasks")).toEqual([{ id: "t1" }]);
  });
});
