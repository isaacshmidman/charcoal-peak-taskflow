import { describe, expect, it } from "vitest";
import {
  decorationsFor,
  taskLinkSpans,
  TASK_LINK_DONE_CLASS,
  TASK_LINK_OPEN_CLASS,
} from "./taskLink";

/**
 * The rule this file exists to pin: highlight iff a task exists, struck
 * iff that task is done. Everything else in the feature hangs off it.
 *
 * These drive a hand-built stand-in for a ProseMirror doc rather than a
 * real editor — descendants() + isText + marks is the entire surface
 * taskLinkSpans touches, so a fake keeps the rules testable without a DOM.
 */
const text = (str, taskId) => ({
  isText: true,
  nodeSize: str.length,
  marks: taskId ? [{ type: { name: "taskLink" }, attrs: { taskId } }] : [],
});

const docOf = (nodes) => ({
  descendants(fn) {
    let pos = 1;
    for (const node of nodes) {
      fn(node, pos);
      pos += node.nodeSize;
    }
  },
});

describe("taskLinkSpans", () => {
  it("reports a span's state from the live task map", () => {
    const doc = docOf([text("call ", null), text("Bob", "t1"), text(" today", null)]);
    expect(taskLinkSpans(doc, new Map([["t1", "todo"]]))).toEqual([
      { from: 6, to: 9, taskId: "t1", state: "open" },
    ]);
    expect(taskLinkSpans(doc, new Map([["t1", "done"]]))[0].state).toBe("done");
  });

  it("calls a task that isn't in the map missing, not open", () => {
    // A deleted task and a never-loaded task look the same here, and both
    // must render as plain text rather than as a live highlight.
    const doc = docOf([text("gone", "deleted-task")]);
    expect(taskLinkSpans(doc, new Map())[0].state).toBe("missing");
  });

  it("merges adjacent text nodes carrying the same task", () => {
    // Bolding a word mid-span splits the text node. The paint must not
    // fragment into two highlights with a seam.
    const doc = docOf([text("buy ", "t1"), text("milk", "t1"), text(" later", null)]);
    const spans = taskLinkSpans(doc, new Map([["t1", "todo"]]));
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ from: 1, to: 9, taskId: "t1" });
  });

  it("keeps different tasks as separate spans even when adjacent", () => {
    const doc = docOf([text("one", "t1"), text("two", "t2")]);
    const spans = taskLinkSpans(doc, new Map([["t1", "todo"], ["t2", "todo"]]));
    expect(spans.map((s) => s.taskId)).toEqual(["t1", "t2"]);
  });

  it("ignores unmarked text and marks with no taskId", () => {
    const doc = docOf([
      text("plain", null),
      { isText: true, nodeSize: 3, marks: [{ type: { name: "taskLink" }, attrs: {} }] },
      { isText: false, nodeSize: 1, marks: [] },
    ]);
    expect(taskLinkSpans(doc, new Map())).toEqual([]);
  });
});

describe("decorationsFor", () => {
  it("draws nothing at all when the task is missing", () => {
    // "Task deleted → highlight goes away, text stays as plain text."
    const doc = docOf([text("orphaned", "deleted-task")]);
    expect(decorationsFor(doc, new Map())).toEqual([]);
  });

  it("draws the reserved highlight plus a dot for an open task", () => {
    const doc = docOf([text("ship it", "t1")]);
    const decos = decorationsFor(doc, new Map([["t1", "todo"]]));
    expect(decos).toHaveLength(2);
    expect(decos[0]).toMatchObject({ type: "inline", from: 1, to: 8, class: TASK_LINK_OPEN_CLASS });
    expect(decos[1]).toMatchObject({ type: "widget", pos: 8, taskId: "t1", state: "open" });
  });

  it("keeps the highlight and adds strikethrough when done", () => {
    const doc = docOf([text("ship it", "t1")]);
    const [inline] = decorationsFor(doc, new Map([["t1", "done"]]));
    // Yellow is KEPT and strike is ADDED — not swapped.
    expect(inline.class).toContain(TASK_LINK_OPEN_CLASS);
    expect(inline.class).toContain(TASK_LINK_DONE_CLASS);
  });

  it("drops the strikethrough again when the task is reopened", () => {
    const doc = docOf([text("ship it", "t1")]);
    const [inline] = decorationsFor(doc, new Map([["t1", "todo"]]));
    expect(inline.class).not.toContain(TASK_LINK_DONE_CLASS);
  });
});
