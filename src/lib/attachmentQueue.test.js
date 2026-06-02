// @ts-nocheck
/**
 * Unit tests for the offline attachment queue (Pri 6). Uses
 * fake-indexeddb to provide a real IndexedDB implementation in the
 * test environment.
 */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  enqueue,
  listAll,
  listForTask,
  remove,
  count,
  toFile,
  _clearAll,
} from "./attachmentQueue";

function makeFile(name, bytes = "hello", type = "text/plain") {
  return new File([bytes], name, { type });
}

afterEach(async () => {
  await _clearAll();
});

describe("attachmentQueue", () => {
  it("enqueues and lists for a task", async () => {
    await enqueue({ taskId: "task-1", file: makeFile("a.txt") });
    await enqueue({ taskId: "task-1", file: makeFile("b.txt") });
    await enqueue({ taskId: "task-2", file: makeFile("c.txt") });

    const t1 = await listForTask("task-1");
    expect(t1).toHaveLength(2);
    expect(t1.map((i) => i.filename).sort()).toEqual(["a.txt", "b.txt"]);

    const t2 = await listForTask("task-2");
    expect(t2).toHaveLength(1);
    expect(t2[0].filename).toBe("c.txt");
  });

  it("preserves the bytes for re-upload via toFile()", async () => {
    await enqueue({ taskId: "task-1", file: makeFile("data.txt", "the-real-bytes") });
    const [item] = await listForTask("task-1");
    expect(item.bytes).toBeInstanceOf(ArrayBuffer);
    const file = toFile(item);
    const text = await file.text();
    expect(text).toBe("the-real-bytes");
    expect(item.size).toBe("the-real-bytes".length);
    expect(item.type).toBe("text/plain");
    expect(file.name).toBe("data.txt");
  });

  it("removes a single item by id", async () => {
    const a = await enqueue({ taskId: "task-1", file: makeFile("a.txt") });
    await enqueue({ taskId: "task-1", file: makeFile("b.txt") });
    expect(await count()).toBe(2);

    await remove(a.id);
    const remaining = await listForTask("task-1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].filename).toBe("b.txt");
    expect(await count()).toBe(1);
  });

  it("listAll returns every task's items oldest-first", async () => {
    await enqueue({ taskId: "task-1", file: makeFile("a.txt") });
    await enqueue({ taskId: "task-2", file: makeFile("b.txt") });
    const all = await listAll();
    expect(all).toHaveLength(2);
    expect(all[0].queuedAt).toBeLessThanOrEqual(all[1].queuedAt);
  });

  it("enqueue returns metadata without the bytes", async () => {
    const meta = await enqueue({ taskId: "task-1", file: makeFile("a.txt") });
    expect(meta.bytes).toBeUndefined();
    expect(meta.id).toMatch(/^q_/);
    expect(meta.taskId).toBe("task-1");
    expect(meta.filename).toBe("a.txt");
  });
});
