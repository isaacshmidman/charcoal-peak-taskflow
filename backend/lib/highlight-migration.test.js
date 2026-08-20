/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  migrateHighlightJson,
  REPLACEMENT_HIGHLIGHT,
  RETIRED_HIGHLIGHT,
} from "./highlight-migration.js";

const doc = (content) => JSON.stringify({ type: "doc", content });
const para = (marks, text = "hello") => ({
  type: "paragraph",
  content: [{ type: "text", text, marks }],
});

describe("migrateHighlightJson", () => {
  it("rewrites the retired yellow and leaves the text untouched", () => {
    const before = doc([para([{ type: "highlight", attrs: { color: RETIRED_HIGHLIGHT } }], "buy milk")]);
    const after = JSON.parse(migrateHighlightJson(before));
    const mark = after.content[0].content[0].marks[0];
    expect(mark.attrs.color).toBe(REPLACEMENT_HIGHLIGHT);
    expect(after.content[0].content[0].text).toBe("buy milk");
  });

  it("is idempotent — a second pass changes nothing", () => {
    const before = doc([para([{ type: "highlight", attrs: { color: RETIRED_HIGHLIGHT } }])]);
    const once = migrateHighlightJson(before);
    expect(once).not.toBeNull();
    expect(migrateHighlightJson(once)).toBeNull();
  });

  it("leaves other highlight colours alone", () => {
    const before = doc([para([{ type: "highlight", attrs: { color: "#bbf7d0" } }])]);
    expect(migrateHighlightJson(before)).toBeNull();
  });

  it("never touches a taskLink mark", () => {
    // The note↔task anchor must survive the migration byte-identical —
    // rewriting one would silently unlink a note from its task.
    const before = doc([
      para([
        { type: "taskLink", attrs: { taskId: "task_abc" } },
        { type: "highlight", attrs: { color: RETIRED_HIGHLIGHT } },
      ]),
    ]);
    const after = JSON.parse(migrateHighlightJson(before));
    const marks = after.content[0].content[0].marks;
    expect(marks[0]).toEqual({ type: "taskLink", attrs: { taskId: "task_abc" } });
    expect(marks[1].attrs.color).toBe(REPLACEMENT_HIGHLIGHT);
  });

  it("rewrites deeply nested content", () => {
    const before = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [para([{ type: "highlight", attrs: { color: RETIRED_HIGHLIGHT } }])] }],
        },
      ],
    });
    expect(migrateHighlightJson(before)).toContain(REPLACEMENT_HIGHLIGHT);
    expect(migrateHighlightJson(before)).not.toContain(RETIRED_HIGHLIGHT);
  });

  it("leaves malformed or empty content alone rather than guessing", () => {
    // A row we can't parse is a row we must not rewrite.
    expect(migrateHighlightJson(`{"broken": ${RETIRED_HIGHLIGHT}`)).toBeNull();
    expect(migrateHighlightJson("")).toBeNull();
    expect(migrateHighlightJson(null)).toBeNull();
    expect(migrateHighlightJson(undefined)).toBeNull();
    expect(migrateHighlightJson("plain text mirror")).toBeNull();
  });

  it("matches the colour case-insensitively", () => {
    const before = doc([para([{ type: "highlight", attrs: { color: "#FEF08A" } }])]);
    expect(migrateHighlightJson(before)).toContain(REPLACEMENT_HIGHLIGHT);
  });
});
