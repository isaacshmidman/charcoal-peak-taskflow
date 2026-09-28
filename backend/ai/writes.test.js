// @ts-nocheck
/* @vitest-environment node */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../push.js", () => ({ enqueueTaskPush: vi.fn() }));

import { createDatabase } from "../db.js";
import { enqueueTaskPush } from "../push.js";
import { createEntityRecord, ensureDefaultPrioritiesForUser, getEntityRecord, listEntityRecords, updateEntityRecord } from "../store.js";
import { createGrant, revokeGrant } from "./grants.js";
import { toolContext } from "./context.js";
import { runTool, toolsForGrant } from "./tools.js";
import { listActivity, undoActivity } from "./activity.js";
import { WRITES_PER_HOUR, resetRateLimits, takeSlot } from "./rate-limit.js";

const APP_ID = "test-app";
const ME = { id: "user-me", email: "me@example.com" };
let tempDir = "";
let db;
let config;
let grant;
let ctx;

function seedUser(user) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, app_id, full_name, email, role, auth_provider, preferences_json, created_date, updated_date)
     VALUES (?, ?, '', ?, 'user', 'local', '{}', ?, ?)`
  ).run(user.id, APP_ID, user.email, now, now);
  ensureDefaultPrioritiesForUser(db, { appId: APP_ID, user, config });
}

const priorities = () => listEntityRecords(db, { entityName: "Priority", appId: APP_ID, user: ME, sort: "order" });
const priority = (name) => priorities().find((p) => p.name === name);
const task = (input) => createEntityRecord(db, { entityName: "Task", appId: APP_ID, user: ME, input, config });
const get = (id, entityName = "Task") => getEntityRecord(db, { entityName, appId: APP_ID, user: ME, id });
const tasks = () => listEntityRecords(db, { entityName: "Task", appId: APP_ID, user: ME });
const exists = (id) => tasks().some((t) => t.id === id);
const run = (name, args, context = ctx) => runTool(context, name, args);
const undoLatest = () => undoActivity(db, config, { appId: APP_ID, user: ME, activityId: listActivity(db, { appId: APP_ID, userId: ME.id })[0].id });
/** A little later than now, so an edit gets its own updated_date. */
const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ai-writes-test-"));
  config = { appId: APP_ID, appName: "Test", dbFile: join(tempDir, "t.sqlite"), deletedTaskRetentionDays: 7, integrationsEnabled: true };
  db = createDatabase(config);
  seedUser(ME);
  grant = createGrant(db, { appId: APP_ID, userId: ME.id, kind: "token", label: "Claude Code", canWrite: true, timeZone: "America/New_York" });
  ctx = toolContext(db, config, { grant, user: ME });
  resetRateLimits();
  enqueueTaskPush.mockClear();
});

afterEach(() => {
  db?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("who may write", () => {
  it("a read-only connection isn't offered write tools and is refused them, changing nothing", async () => {
    const readOnly = createGrant(db, { appId: APP_ID, userId: ME.id, kind: "token", label: "ro", canWrite: false });
    const roCtx = toolContext(db, config, { grant: readOnly, user: ME });
    expect(toolsForGrant(readOnly).map((t) => t.name)).not.toContain("create_task");
    expect(toolsForGrant(grant).map((t) => t.name)).toEqual(
      expect.arrayContaining(["create_task", "update_task", "complete_task", "delete_task", "create_note"])
    );
    await expect(run("create_task", { title: "x", due_date: "2026-10-01" }, roCtx)).rejects.toThrow(/can only read/);
    expect(tasks()).toEqual([]);
  });
});

describe("calendar items are never changed", () => {
  let event;
  let underEvent;
  beforeEach(() => {
    event = task({ title: "Dentist", due_date: "2026-10-01", task_time: "9:00AM", source_provider: "google", source_kind: "event", source_calendar_name: "Work", source_writable: true });
    underEvent = task({ title: "Bring forms", parent_id: event.id });
  });

  it("not by edit, completion, deletion or a new subtask, and nothing is pushed to the calendar", async () => {
    const before = get(event.id);
    for (const [tool, args] of [
      ["update_task", { task_id: event.id, due_date: "2026-10-02" }],
      ["complete_task", { task_id: event.id }],
      ["delete_task", { task_id: event.id }],
      ["create_task", { title: "Sub", parent_task_id: event.id }],
      ["update_task", { task_id: underEvent.id, title: "Renamed" }],
    ]) {
      await expect(run(tool, args)).rejects.toThrow(/is from Google calendar · Work\. AI apps can't change calendar items/);
    }
    expect(get(event.id)).toEqual(before);
    expect(get(underEvent.id).title).toBe("Bring forms");
    expect(tasks()).toHaveLength(2);
    expect(enqueueTaskPush).not.toHaveBeenCalled();
    expect(listActivity(db, { appId: APP_ID, userId: ME.id })).toEqual([]);
  });
});

describe("create_task", () => {
  it("fills in what the task form would: middle priority, an hour's length, plain text kept as text", async () => {
    const { data } = await run("create_task", {
      title: "Essay draft",
      due_date: "2026-10-01",
      time: "9am",
      tags: ["#school", "School", "writing"],
      description: "Line one\n<b>not bold</b>",
      reminder: "30 minutes before",
    });
    const saved = get(data.id);
    expect(saved).toMatchObject({
      title: "Essay draft",
      status: "todo",
      task_type: "one_time",
      recurrence: "none",
      due_date: "2026-10-01",
      task_time: "9:00AM",
      task_end_time: "10:00AM",
      priority_id: priority("Normal").id,
      tags: ["school", "writing"],
      description: "Line one\n<b>not bold</b>",
      reminder: "before:30",
    });
    expect(JSON.parse(saved.description_json).content[1]).toEqual({ type: "paragraph", content: [{ type: "text", text: "<b>not bold</b>" }] });
    expect(enqueueTaskPush).toHaveBeenCalledWith(db, config, { op: "upsert", appId: APP_ID, taskSnapshot: expect.objectContaining({ id: data.id }) });
  });

  it("says what it added in a sentence for Siri", async () => {
    const { todayIn, addDaysYmd } = await import("./view.js");
    const tomorrow = addDaysYmd(todayIn("America/New_York"), 1);
    const { data } = await run("create_task", { title: "Buy milk", due_date: tomorrow, time: "5:30pm" });
    expect(data.spoken).toBe("Added Buy milk for tomorrow at 5:30 PM.");
    const later = await run("create_task", { title: "Renew passport", due_date: "2031-03-04" });
    expect(later.data.spoken).toBe("Added Renew passport for Tuesday 4 March.");
  });

  it("ends a late task at 11:59PM, not after midnight", async () => {
    const { data } = await run("create_task", { title: "Late", due_date: "2026-10-01", time: "23:30" });
    expect(get(data.id).task_end_time).toBe("11:59PM");
  });

  it("needs a due date for a task, and a reminder that fits whether it has a time", async () => {
    await expect(run("create_task", { title: "No date" })).rejects.toThrow('"due_date" is required');
    await expect(run("create_task", { title: "x", due_date: "2026-10-01", reminder: "30 minutes before" })).rejects.toThrow(/needs the task to have a time/);
    await expect(run("create_task", { title: "x", due_date: "2026-10-01", time: "9:00AM", reminder: "at 8am" })).rejects.toThrow(/for all-day tasks/);
    const { data } = await run("create_task", { title: "All day", due_date: "2026-10-01", reminder: "at 8am" });
    expect(get(data.id).reminder).toBe("at:8:00AM");
    await expect(run("create_task", { title: "x", due_date: "2026-10-01", time: "10am", end_time: "9am" })).rejects.toThrow('"end_time" must be after "time"');
    await expect(run("create_task", { title: "x", due_date: "2026-10-01", priority: "Critical" })).rejects.toThrow(/Urgent, High, Normal, Low/);
  });

  it("adds subtasks the way the task form does: in order, with only the fields a subtask has", async () => {
    const parent = task({ title: "Trip", due_date: "2026-10-01" });
    const first = await run("create_task", { title: "Book flights", parent_task_id: parent.id });
    const second = await run("create_task", { title: "Pack", parent_task_id: parent.id, due_date: "2026-09-30", time: "8pm" });
    expect(get(first.data.id)).toMatchObject({ parent_id: parent.id, order: 0, due_date: "", priority_id: "" });
    expect(get(second.data.id)).toMatchObject({ order: 1, due_date: "2026-09-30", task_time: "8:00PM", task_end_time: "" });
    await expect(run("create_task", { title: "x", parent_task_id: parent.id, priority: "High" })).rejects.toThrow(/Subtasks only have/);
    await expect(run("create_task", { title: "x", parent_task_id: first.data.id })).rejects.toThrow("Subtasks can't have subtasks");
  });
});

describe("update_task", () => {
  it("moves a task keeping its length, and says what changed", async () => {
    const t = task({ title: "Meeting", due_date: "2026-10-01", task_time: "9:00AM", task_end_time: "10:30AM", priority_id: priority("Low").id, tags: ["work"] });
    const { text } = await run("update_task", { task_id: t.id, due_date: "2026-10-02", time: "2pm", priority: "high", add_tags: ["urgent"], remove_tags: ["WORK"] });
    expect(get(t.id)).toMatchObject({ due_date: "2026-10-02", task_time: "2:00PM", task_end_time: "3:30PM", priority_id: priority("High").id, tags: ["urgent"] });
    expect(text).toBe(`Changed “Meeting”: date Thu 1 Oct → Fri 2 Oct; time 2:00PM–3:30PM; priority Low → High; tags #urgent. (id ${t.id})`);
  });

  it("making a task all-day drops a 'before' reminder that no longer means anything", async () => {
    const t = task({ title: "Call", due_date: "2026-10-01", task_time: "9:00AM", task_end_time: "9:30AM", reminder: "before:30" });
    const { text } = await run("update_task", { task_id: t.id, clear_time: true });
    expect(get(t.id)).toMatchObject({ task_time: "", task_end_time: "", reminder: "" });
    expect(text).toContain("now all-day; reminder back to the default");
  });

  it("changing nothing changes nothing and isn't logged", async () => {
    const t = task({ title: "Same", due_date: "2026-10-01" });
    const { text } = await run("update_task", { task_id: t.id, title: "Same", due_date: "2026-10-01" });
    expect(text).toMatch(/^Nothing to change/);
    expect(listActivity(db, { appId: APP_ID, userId: ME.id })).toEqual([]);
    await expect(run("update_task", { task_id: t.id })).rejects.toThrow(/Say what to change/);
  });
});

describe("complete_task", () => {
  it("a repeating task: keeps this occurrence as a done copy, subtasks too, and moves the series on — as the app does", async () => {
    const series = task({
      title: "Water plants", description: "Both balconies", priority_id: priority("High").id, due_date: "2026-10-01",
      task_time: "8:00AM", task_end_time: "8:15AM", tags: ["home"], recurrence: "weekly", task_type: "recurring", reminder: "before:10",
    });
    const fern = task({ title: "Fern", parent_id: series.id, status: "done", completed_at: "2026-09-30T10:00:00.000Z", order: 0 });
    const cactus = task({ title: "Cactus", parent_id: series.id, order: 1 });

    const { data } = await run("complete_task", { task_id: series.id });

    const snapshot = get(data.completed_occurrence_id);
    // Exactly completeRecurringTask's snapshot: no end time, reminder or rich description carried over.
    expect(snapshot).toMatchObject({
      title: "Water plants", description: "Both balconies", priority_id: priority("High").id, status: "done", task_type: "one_time",
      recurrence: "none", recurrence_days: [], recurrence_end_date: "", due_date: "2026-10-01", task_time: "8:00AM", task_end_time: "", tags: ["home"], reminder: "",
    });
    expect(snapshot.completed_at).toBeTruthy();
    const copies = tasks().filter((t) => t.parent_id === snapshot.id).sort((a, b) => a.order - b.order);
    expect(copies.map((c) => [c.title, c.status, c.order, c.task_type])).toEqual([["Fern", "done", 0, "one_time"], ["Cactus", "todo", 1, "one_time"]]);
    expect(get(series.id)).toMatchObject({ due_date: "2026-10-08", status: "todo", completed_at: "", recurrence: "weekly", task_end_time: "8:15AM" });
    expect(get(fern.id)).toMatchObject({ status: "todo", completed_at: "" });
    expect(get(cactus.id).status).toBe("todo");
    expect(data.next_date).toBe("2026-10-08");
  });

  it("the last time round marks the series done too", async () => {
    const series = task({ title: "Course", due_date: "2026-10-01", recurrence: "weekly", recurrence_end_date: "2026-10-05" });
    const { text } = await run("complete_task", { task_id: series.id });
    expect(get(series.id).status).toBe("done");
    expect(text).toContain("that was its last time");
  });

  it("a one-time task is marked done and can be reopened; doing it twice is a no-op", async () => {
    const t = task({ title: "Once", due_date: "2026-10-01" });
    await run("complete_task", { task_id: t.id });
    expect(get(t.id).status).toBe("done");
    expect((await run("complete_task", { task_id: t.id })).text).toMatch(/already done/);
    await run("complete_task", { task_id: t.id, done: false });
    expect(get(t.id)).toMatchObject({ status: "todo", completed_at: "" });
  });
});

describe("delete_task", () => {
  it("moves a task and its subtasks to Recently Deleted with the app's snapshot, and tells the calendar", async () => {
    const t = task({ title: "Old plan", due_date: "2026-10-01", task_time: "9:00AM", task_end_time: "10:00AM", priority_id: priority("Urgent").id, tags: ["x"], reminder: "none", description_json: '{"type":"doc"}' });
    const sub = task({ title: "Step", parent_id: t.id, due_date: "2026-10-01", status: "done", completed_at: "2026-09-29T00:00:00.000Z" });
    const { data } = await run("delete_task", { task_id: t.id });
    expect(exists(t.id)).toBe(false);
    expect(exists(sub.id)).toBe(false);
    const record = get(data.recently_deleted_id, "DeletedTask");
    expect(record).toMatchObject({
      task_id: t.id, title: "Old plan", priority_id: priority("Urgent").id, priority_color: priority("Urgent").color, status: "todo",
      due_date: "2026-10-01", task_time: "9:00AM", task_end_time: "10:00AM", reminder: "none", tags: ["x"], description_json: '{"type":"doc"}', was_completed: false,
      subtasks: [{ id: sub.id, title: "Step", status: "done", due_date: "2026-10-01", task_time: "", completed_at: "2026-09-29T00:00:00.000Z" }],
    });
    expect(Date.parse(record.expires_at) - Date.parse(record.deleted_at)).toBe(7 * 24 * 60 * 60 * 1000);
    const deletes = enqueueTaskPush.mock.calls.filter(([, , p]) => p.op === "delete").map(([, , p]) => p.taskSnapshot.id);
    expect(deletes.sort()).toEqual([t.id, sub.id].sort());
  });

  it("refuses what would be permanent: subtasks, and tasks whose files would go with them", async () => {
    const t = task({ title: "With files", due_date: "2026-10-01" });
    const sub = task({ title: "Sub", parent_id: t.id });
    await expect(run("delete_task", { task_id: sub.id })).rejects.toThrow(/Deleting a subtask is permanent/);
    db.prepare(
      `INSERT INTO task_attachments (id, app_id, user_id, task_id, filename, mime_type, size_bytes, storage_path, is_image, created_date)
       VALUES ('att_1', ?, ?, ?, 'plan.pdf', 'application/pdf', 1, 'x', 0, ?)`
    ).run(APP_ID, ME.id, sub.id, new Date().toISOString());
    await expect(run("delete_task", { task_id: t.id })).rejects.toThrow(/has attached files/);
    expect(exists(t.id) && exists(sub.id)).toBe(true);
  });
});

describe("create_note", () => {
  it("stores the text as the note editor would, one paragraph per line", async () => {
    const { data } = await run("create_note", { text: "Packing list\n\nPassport", title: "Trip", tags: ["travel"] });
    const note = get(data.id, "Note");
    expect(note).toMatchObject({ title: "Trip", content_text: "Packing list\n\nPassport", tags: ["travel"], pinned: false });
    expect(JSON.parse(note.content_json).content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Packing list" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "Passport" }] },
    ]);
  });
});

describe("limits", () => {
  it(`stops a connection after ${WRITES_PER_HOUR} changes in an hour, without making the change`, async () => {
    const t = task({ title: "Busy", due_date: "2026-10-01" });
    for (let i = 0; i < WRITES_PER_HOUR; i += 1) takeSlot(`write:${grant.id}`, WRITES_PER_HOUR, 60 * 60 * 1000);
    await expect(run("update_task", { task_id: t.id, title: "Renamed" })).rejects.toThrow(/Try again in \d+ minutes/);
    expect(get(t.id).title).toBe("Busy");
    // Another connection has its own allowance.
    const other = createGrant(db, { appId: APP_ID, userId: ME.id, kind: "token", label: "other", canWrite: true });
    await run("update_task", { task_id: t.id, title: "Renamed" }, toolContext(db, config, { grant: other, user: ME }));
    expect(get(t.id).title).toBe("Renamed");
  });

  it("a refused change doesn't use up the allowance", async () => {
    for (let i = 0; i < WRITES_PER_HOUR - 1; i += 1) takeSlot(`write:${grant.id}`, WRITES_PER_HOUR, 60 * 60 * 1000);
    await expect(run("create_task", { title: "No date" })).rejects.toThrow(/due_date/);
    await run("create_task", { title: "Fits", due_date: "2026-10-01" });
  });
});

describe("the activity log and Undo", () => {
  it("lists what each app did, newest first, still naming an app after it's revoked", async () => {
    await run("create_task", { title: "First", due_date: "2026-10-01" });
    await tick();
    await run("create_note", { text: "hi", title: "Second" });
    revokeGrant(db, { appId: APP_ID, userId: ME.id, grantId: grant.id });
    const log = listActivity(db, { appId: APP_ID, userId: ME.id });
    expect(log.map((a) => [a.app, a.summary, a.undo])).toEqual([
      ["Claude Code", "Added the note “Second”.", "available"],
      ["Claude Code", "Added “First” on Thu 1 Oct.", "available"],
    ]);
  });

  it("undoes an added task, and gives a changed one back its old values", async () => {
    const { data } = await run("create_task", { title: "Oops", due_date: "2026-10-01" });
    undoLatest();
    expect(exists(data.id)).toBe(false);

    const t = task({ title: "Keep", due_date: "2026-10-01", tags: ["a"], priority_id: priority("Low").id });
    await run("update_task", { task_id: t.id, due_date: "2026-10-09", add_tags: ["b"], priority: "Urgent", description: "new" });
    const undone = undoLatest();
    expect(undone.undo).toBe("undone");
    expect(get(t.id)).toMatchObject({ due_date: "2026-10-01", tags: ["a"], priority_id: priority("Low").id, description: "", description_json: "" });
    expect(() => undoLatest()).toThrow(/already undone/);
  });

  it("won't overwrite an edit made after the AI's change", async () => {
    const t = task({ title: "Draft", due_date: "2026-10-01" });
    await run("update_task", { task_id: t.id, due_date: "2026-10-05" });
    await tick();
    updateEntityRecord(db, { entityName: "Task", appId: APP_ID, user: ME, id: t.id, input: { title: "Draft (edited by hand)" } });
    expect(() => undoLatest()).toThrow(/has been changed since/);
    expect(get(t.id)).toMatchObject({ title: "Draft (edited by hand)", due_date: "2026-10-05" });
  });

  it("undoes a repeating completion: the done copy goes, the series and its subtasks come back", async () => {
    const series = task({ title: "Gym", due_date: "2026-10-01", recurrence: "daily" });
    const sub = task({ title: "Stretch", parent_id: series.id, status: "done", completed_at: "2026-09-30T00:00:00.000Z" });
    await run("complete_task", { task_id: series.id });
    expect(tasks()).toHaveLength(4);
    undoLatest();
    expect(tasks().map((t) => t.id).sort()).toEqual([series.id, sub.id].sort());
    expect(get(series.id)).toMatchObject({ due_date: "2026-10-01", status: "todo" });
    expect(get(sub.id)).toMatchObject({ status: "done", completed_at: "2026-09-30T00:00:00.000Z" });
  });

  it("points a delete at Recently Deleted instead of undoing it here", async () => {
    const t = task({ title: "Gone", due_date: "2026-10-01" });
    await run("delete_task", { task_id: t.id });
    expect(listActivity(db, { appId: APP_ID, userId: ME.id })[0].undo).toBe("recently_deleted");
    expect(() => undoLatest()).toThrow("Restore it from Recently Deleted.");
  });

  it("undoes an added note", async () => {
    const { data } = await run("create_note", { text: "tmp" });
    undoLatest();
    expect(() => get(data.id, "Note")).toThrow(/not found/);
  });
});
