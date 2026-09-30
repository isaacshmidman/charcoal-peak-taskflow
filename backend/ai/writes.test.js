// @ts-nocheck
/* @vitest-environment node */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import { createAttachment, getAttachment, listAttachmentsForTask } from "../attachments.js";
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
/** A real file on a task, and where its bytes are. */
const attach = async (taskId, filename, text) => {
  const file = await createAttachment(db, config, { appId: APP_ID, user: ME, taskId, file: { filename, mimeType: "application/pdf", data: Buffer.from(text) } });
  return { ...file, path: getAttachment(db, config, { appId: APP_ID, user: ME, id: file.id }).absolutePath };
};
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

  it("refuses what would be permanent — a subtask — and a task's files go to Recently Deleted with it, to come back on restore", async () => {
    const t = task({ title: "With files", due_date: "2026-10-01" });
    const sub = task({ title: "Sub", parent_id: t.id });
    await expect(run("delete_task", { task_id: sub.id })).rejects.toThrow(/Deleting a subtask is permanent/);
    const plan = await attach(t.id, "plan.pdf", "%PDF plan");
    const steps = await attach(sub.id, "steps.pdf", "%PDF steps");

    const { text, data } = await run("delete_task", { task_id: t.id });
    expect(text).toBe("Moved “With files” and its 1 subtask to Recently Deleted. The person can restore it, with its 2 files, from there for 7 days.");
    expect(exists(t.id) || exists(sub.id)).toBe(false);
    // Kept, byte for byte, until Recently Deleted lets go of the task.
    expect(readFileSync(plan.path, "utf8")).toBe("%PDF plan");
    expect(readFileSync(steps.path, "utf8")).toBe("%PDF steps");

    // Restored as the app restores it, each file is back on its task.
    const record = get(data.recently_deleted_id, "DeletedTask");
    const back = createEntityRecord(db, { entityName: "Task", appId: APP_ID, user: ME, input: { title: record.title, due_date: record.due_date }, config, restoresTaskId: record.task_id });
    const backSub = createEntityRecord(db, { entityName: "Task", appId: APP_ID, user: ME, input: { title: "Sub", parent_id: back.id }, config, restoresTaskId: sub.id });
    expect(listAttachmentsForTask(db, { appId: APP_ID, user: ME, taskId: back.id }).map((a) => a.filename)).toEqual(["plan.pdf"]);
    expect(listAttachmentsForTask(db, { appId: APP_ID, user: ME, taskId: backSub.id }).map((a) => a.filename)).toEqual(["steps.pdf"]);
  });
});

describe("create_note", () => {
  it("stores the text as the note editor would, one paragraph per line", async () => {
    const { data } = await run("create_note", { text: "Packing list\n\nPassport", title: "Trip", tags: ["travel"], format: "plain" });
    const note = get(data.id, "Note");
    // The plain-text mirror is what the editor would save for these blocks.
    expect(note).toMatchObject({ title: "Trip", content_text: "Packing list\n\n\n\nPassport", tags: ["travel"], pinned: false });
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

  it("won't undo an added task the person has since attached a file to: that would delete the file for good", async () => {
    const { data } = await run("create_task", { title: "Receipts", due_date: "2026-10-01" });
    const receipt = await attach(data.id, "receipt.pdf", "%PDF receipt");
    expect(() => undoLatest()).toThrow(/has had files attached since/);
    expect(exists(data.id)).toBe(true);
    expect(readFileSync(receipt.path, "utf8")).toBe("%PDF receipt");
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

describe("repeating tasks", () => {
  it("makes a new task repeat the way the task form stores it", async () => {
    const weekly = await run("create_task", { title: "Gym", due_date: "2026-10-05", repeats: "weekly", repeat_until: "2026-12-21" });
    expect(get(weekly.data.id)).toMatchObject({ task_type: "recurring", recurrence: "weekly", recurrence_days: [], recurrence_end_date: "2026-12-21" });
    expect(weekly.text).toContain("repeating every week until 2026-12-21");

    const custom = await run("create_task", { title: "Piano", due_date: "2026-10-05", repeats: "custom_days", repeat_days: ["thursday", "monday", "monday"] });
    expect(get(custom.data.id)).toMatchObject({ task_type: "recurring", recurrence: "custom_days", recurrence_days: [1, 4], recurrence_end_date: "" });
    expect(custom.data.spoken).toContain("repeating every Monday and Thursday");
  });

  it("changes how a task repeats, and stops it, clearing what the form clears", async () => {
    const t = task({ title: "Water plants", due_date: "2026-10-05" });
    const made = await run("update_task", { task_id: t.id, repeats: "custom_days", repeat_days: ["saturday"] });
    expect(made.text).toContain("repeats every Saturday");
    // Only the days: it stays custom_days.
    await run("update_task", { task_id: t.id, repeat_days: ["tuesday", "saturday"] });
    expect(get(t.id)).toMatchObject({ recurrence: "custom_days", recurrence_days: [2, 6] });
    // Only the end: the rest stays.
    await run("update_task", { task_id: t.id, repeat_until: "2026-11-30" });
    expect(get(t.id)).toMatchObject({ recurrence: "custom_days", recurrence_days: [2, 6], recurrence_end_date: "2026-11-30" });
    await run("update_task", { task_id: t.id, repeat_until: "never" });
    expect(get(t.id).recurrence_end_date).toBe("");

    const stopped = await run("update_task", { task_id: t.id, repeats: "none" });
    expect(stopped.text).toContain("no longer repeats");
    expect(get(t.id)).toMatchObject({ task_type: "one_time", recurrence: "none", recurrence_days: [], recurrence_end_date: "" });
  });

  it("refuses what the form wouldn't allow", async () => {
    const parent = task({ title: "Trip", due_date: "2026-10-05" });
    const sub = task({ title: "Pack", parent_id: parent.id });
    await expect(run("update_task", { task_id: sub.id, repeats: "daily" })).rejects.toThrow(/Subtasks only have/);
    await expect(run("create_task", { title: "x", due_date: "2026-10-05", repeats: "custom_days" })).rejects.toThrow(/needs "repeat_days"/);
    await expect(run("create_task", { title: "x", due_date: "2026-10-05", repeats: "weekly", repeat_days: ["monday"] })).rejects.toThrow(/only applies with repeats "custom_days"/);
    await expect(run("create_task", { title: "x", due_date: "2026-10-05", repeats: "weekly", repeat_until: "2026-10-01" })).rejects.toThrow(/can't be before the due date/);
    await expect(run("create_task", { title: "x", due_date: "2026-10-05", repeats: "weekly", repeat_until: "soon" })).rejects.toThrow(/or "never"/);
    await expect(run("update_task", { task_id: parent.id, repeat_until: "2026-12-01" })).rejects.toThrow(/only apply to a task that repeats/);
    await expect(run("create_task", { title: "x", due_date: "2026-10-05", repeats: "fortnightly" })).rejects.toThrow(/must be one of/);
  });

  it("undo puts the old repeat back", async () => {
    const t = task({ title: "Standup", due_date: "2026-10-05", task_type: "recurring", recurrence: "weekdays" });
    await run("update_task", { task_id: t.id, repeats: "none" });
    undoLatest();
    expect(get(t.id)).toMatchObject({ task_type: "recurring", recurrence: "weekdays" });
  });
});

describe("editing notes", () => {
  const LINKED = (taskId) =>
    JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Trip plan" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "First " },
            { type: "text", text: "call the plumber", marks: [{ type: "taskLink", attrs: { taskId } }] },
            { type: "text", text: " then pack the bag", marks: [{ type: "bold" }] },
          ],
        },
      ],
    });
  const note = (input) => createEntityRecord(db, { entityName: "Note", appId: APP_ID, user: ME, input, config });

  it("swaps words inside the note, keeping headings, bold and the link to a task", async () => {
    const n = note({ title: "Trip", content_json: LINKED("task_x"), content_text: "Trip plan\n\nFirst call the plumber then pack the bag" });
    const { text } = await run("update_note", { note_id: n.id, find: "plumber", replace_with: "electrician" });
    expect(text).toContain('replaced "plumber"');
    const saved = get(n.id, "Note");
    const doc = JSON.parse(saved.content_json);
    expect(doc.content[0].type).toBe("heading");
    expect(doc.content[1].content[1]).toEqual({ type: "text", text: "call the electrician", marks: [{ type: "taskLink", attrs: { taskId: "task_x" } }] });
    expect(doc.content[1].content[2].marks).toEqual([{ type: "bold" }]);
    expect(saved.content_text).toBe("Trip plan\n\nFirst call the electrician then pack the bag");
  });

  it("can delete words with an empty replacement, and says when the words aren't there", async () => {
    const n = note({ content_text: "Buy milk and eggs" });
    await run("update_note", { note_id: n.id, find: " and eggs", replace_with: "" });
    expect(get(n.id, "Note").content_text).toBe("Buy milk");
    await expect(run("update_note", { note_id: n.id, find: "bread", replace_with: "x" })).rejects.toThrow(/Couldn't find "bread"/);
    await expect(run("update_note", { note_id: n.id, find: "milk" })).rejects.toThrow(/go together/);
  });

  it("adds text at the end without touching what's there", async () => {
    const n = note({ title: "Trip", content_json: LINKED("task_y"), content_text: "Trip plan\n\nFirst call the plumber then pack the bag" });
    await run("update_note", { note_id: n.id, append_text: "Book the train\nCharge the camera", format: "plain" });
    const doc = JSON.parse(get(n.id, "Note").content_json);
    expect(doc.content).toHaveLength(4);
    expect(doc.content[1].content[1].marks[0].type).toBe("taskLink");
    expect(get(n.id, "Note").content_text).toBe("Trip plan\n\nFirst call the plumber then pack the bag\n\nBook the train\n\nCharge the camera");
  });

  it("replacing all the text says how many task links go with it", async () => {
    const n = note({ title: "Trip", content_json: LINKED("task_z"), content_text: "x" });
    const { text } = await run("update_note", { note_id: n.id, replace_all_text: "Cancelled." });
    expect(text).toContain("replaced all its text, removing 1 link to tasks");
    expect(get(n.id, "Note")).toMatchObject({ content_text: "Cancelled." });
    await expect(run("update_note", { note_id: n.id, replace_all_text: "a", append_text: "b" })).rejects.toThrow(/use it on its own/);
  });

  it("changes the title, tags and pinning, and undo gives the whole note back", async () => {
    const n = note({ title: "Ideas", content_text: "One", tags: ["work"] });
    await run("update_note", { note_id: n.id, title: "", add_tags: ["later"], remove_tags: ["work"], pinned: true, append_text: "Two" });
    expect(get(n.id, "Note")).toMatchObject({ title: "", tags: ["later"], pinned: true, content_text: "One\n\nTwo" });
    undoLatest();
    expect(get(n.id, "Note")).toMatchObject({ title: "Ideas", tags: ["work"], pinned: false, content_text: "One", content_json: "" });
  });

  it("delete_note moves it to Recently Deleted with the app's snapshot", async () => {
    const n = note({ title: "Old", content_text: "gone soon", tags: ["x"], pinned: true });
    const { data } = await run("delete_note", { note_id: n.id });
    expect(() => get(n.id, "Note")).toThrow(/not found/);
    expect(get(data.recently_deleted_id, "DeletedNote")).toMatchObject({ note_id: n.id, title: "Old", content_text: "gone soon", tags: ["x"], pinned: true });
    expect(listActivity(db, { appId: APP_ID, userId: ME.id })[0].undo).toBe("recently_deleted");
  });

  it("won't touch someone else's note", async () => {
    const theirs = createEntityRecord(db, { entityName: "Note", appId: APP_ID, user: { id: "other", email: "o@example.com" }, input: { content_text: "private" }, config });
    await expect(run("update_note", { note_id: theirs.id, append_text: "hi" })).rejects.toThrow(`No note with id "${theirs.id}".`);
    await expect(run("delete_note", { note_id: theirs.id })).rejects.toThrow(/No note with id/);
  });
});

describe("skip_occurrence", () => {
  it("moves a repeating task on without marking it done, and undo brings it back", async () => {
    const t = task({ title: "Gym", due_date: "2026-10-05", task_type: "recurring", recurrence: "weekdays" });
    const { text, data } = await run("skip_occurrence", { task_id: t.id });
    // Monday 5 Oct → Tuesday 6 Oct; nothing kept as done, unlike complete_task.
    expect(data.next_date).toBe("2026-10-06");
    expect(get(t.id)).toMatchObject({ due_date: "2026-10-06", status: "todo" });
    expect(tasks()).toHaveLength(1);
    expect(text).toContain("comes round again on Tue 6 Oct");
    undoLatest();
    expect(get(t.id).due_date).toBe("2026-10-05");
  });

  it("skipping the last time sends the task to Recently Deleted, as the app does", async () => {
    const t = task({ title: "Course", due_date: "2026-10-05", task_type: "recurring", recurrence: "weekly", recurrence_end_date: "2026-10-10" });
    const { data } = await run("skip_occurrence", { task_id: t.id });
    expect(exists(t.id)).toBe(false);
    expect(get(data.recently_deleted_id, "DeletedTask").task_id).toBe(t.id);
    expect(listActivity(db, { appId: APP_ID, userId: ME.id })[0].undo).toBe("recently_deleted");
  });

  it("refuses tasks that don't repeat", async () => {
    const t = task({ title: "Once", due_date: "2026-10-05" });
    await expect(run("skip_occurrence", { task_id: t.id })).rejects.toThrow(/doesn't repeat/);
  });
});

describe("edit_priorities", () => {
  const names = () => priorities().map((p) => p.name);

  it("adds one at the bottom, renames, recolours and moves, each undoable", async () => {
    await run("edit_priorities", { action: "add", name: "Someday", color: "violet" });
    expect(names()).toEqual(["Urgent", "High", "Normal", "Low", "Someday"]);
    expect(priority("Someday").color).toBe("violet");

    await run("edit_priorities", { action: "rename", priority: "someday", name: "Maybe later" });
    await run("edit_priorities", { action: "recolor", priority: "Maybe later", color: "teal" });
    expect(priority("Maybe later").color).toBe("teal");

    const moved = await run("edit_priorities", { action: "move", priority: "Maybe later", position: 2 });
    expect(names()).toEqual(["Urgent", "Maybe later", "High", "Normal", "Low"]);
    expect(moved.text).toContain("most urgent first: Urgent, Maybe later, High, Normal, Low");
    undoLatest();
    expect(names()).toEqual(["Urgent", "High", "Normal", "Low", "Maybe later"]);
  });

  it("deleting leaves tasks without a priority, and undo puts it back under the same id", async () => {
    const high = priority("High");
    const t = task({ title: "Report", due_date: "2026-10-05", priority_id: high.id });
    await run("edit_priorities", { action: "delete", priority: "High" });
    expect(names()).toEqual(["Urgent", "Normal", "Low"]);
    const before = await run("get_task", { task_id: t.id });
    expect(before.data.priority).toBeNull();
    undoLatest();
    expect(priority("High")).toMatchObject({ id: high.id, color: high.color, order: high.order });
    expect((await run("get_task", { task_id: t.id })).data.priority).toBe("High");
  });

  it("refuses duplicates, missing names and unknown priorities", async () => {
    await expect(run("edit_priorities", { action: "add", name: "urgent" })).rejects.toThrow(/already a priority called/);
    await expect(run("edit_priorities", { action: "add" })).rejects.toThrow(/"name" is needed/);
    await expect(run("edit_priorities", { action: "delete", priority: "Critical" })).rejects.toThrow(/Urgent, High, Normal, Low/);
    await expect(run("edit_priorities", { action: "recolor", priority: "Low", color: "gold" })).rejects.toThrow(/must be one of/);
  });
});

describe("edit_tags", () => {
  const savedNames = () => listEntityRecords(db, { entityName: "SavedTag", appId: APP_ID, user: ME }).map((t) => t.name).sort();
  const note = (input) => createEntityRecord(db, { entityName: "Note", appId: APP_ID, user: ME, input, config });

  it("adds and removes saved tags; removing leaves the tag on tasks", async () => {
    const t = task({ title: "Revise", due_date: "2026-10-05", tags: ["school"] });
    await run("edit_tags", { action: "add", tag: "#School" });
    expect(savedNames()).toEqual(["School"]);
    expect((await run("edit_tags", { action: "add", tag: "school" })).text).toContain("already a saved tag");
    await run("edit_tags", { action: "remove", tag: "school" });
    expect(savedNames()).toEqual([]);
    expect(get(t.id).tags).toEqual(["school"]);
    undoLatest();
    expect(savedNames()).toEqual(["School"]);
  });

  it("renames a tag on every task and note and in the saved list — not on calendar items — and one Undo reverts it all", async () => {
    await run("edit_tags", { action: "add", tag: "Calc" });
    const a = task({ title: "HW 1", due_date: "2026-10-05", tags: ["Calc", "math"] });
    const b = task({ title: "HW 2", due_date: "2026-10-06", tags: ["calc"] });
    const cal = task({ title: "Calc class", due_date: "2026-10-05", tags: ["Calc"], source_provider: "google", source_kind: "event" });
    const n = note({ title: "Formulas", content_text: "x", tags: ["Calc"] });
    enqueueTaskPush.mockClear();

    const { text } = await run("edit_tags", { action: "rename", tag: "calc", new_name: "Calculus" });
    expect(text).toBe("Renamed #calc to #Calculus on 2 tasks and 1 note and in the saved tags.");
    expect(get(a.id).tags).toEqual(["Calculus", "math"]);
    expect(get(b.id).tags).toEqual(["Calculus"]);
    expect(get(cal.id).tags).toEqual(["Calc"]);
    expect(get(n.id, "Note").tags).toEqual(["Calculus"]);
    expect(savedNames()).toEqual(["Calculus"]);
    expect(enqueueTaskPush).toHaveBeenCalledTimes(2);
    expect(listActivity(db, { appId: APP_ID, userId: ME.id })).toHaveLength(2);

    undoLatest();
    expect(get(a.id).tags).toEqual(["Calc", "math"]);
    expect(get(b.id).tags).toEqual(["calc"]);
    expect(get(n.id, "Note").tags).toEqual(["Calc"]);
    expect(savedNames()).toEqual(["Calc"]);
  });

  it("merges into a tag that already exists instead of doubling it", async () => {
    const t = task({ title: "Both", due_date: "2026-10-05", tags: ["hw", "homework"] });
    await run("edit_tags", { action: "rename", tag: "hw", new_name: "homework" });
    expect(get(t.id).tags).toEqual(["homework"]);
  });

  it("an undo is refused if anything it would revert was edited since", async () => {
    const t = task({ title: "HW", due_date: "2026-10-05", tags: ["calc"] });
    await run("edit_tags", { action: "rename", tag: "calc", new_name: "Calculus" });
    await tick();
    updateEntityRecord(db, { entityName: "Task", appId: APP_ID, user: ME, id: t.id, input: { title: "HW (edited)" } });
    expect(() => undoLatest()).toThrow(/has been changed since/);
    expect(get(t.id).tags).toEqual(["Calculus"]);
  });
});

describe("notes in Markdown", () => {
  const note = (input) => createEntityRecord(db, { entityName: "Note", appId: APP_ID, user: ME, input, config });

  it("writes a note from Markdown, with lists, checklists, formatting and a link to one of the person's own tasks", async () => {
    const t = task({ title: "Call plumber", due_date: "2026-10-05" });
    const md = [
      "## Weekend",
      "",
      `Remember to [call the plumber](zephyrly-task:${t.id}) and **pay rent**.`,
      "",
      "- [ ] Laundry",
      "- [x] Groceries",
      "",
      "1. First",
      "2. Second",
      "",
      "[not mine](zephyrly-task:task_elsewhere) [bad](javascript:alert(1)) <b>raw</b>",
    ].join("\n");
    const { data } = await run("create_note", { title: "Plans", text: md, priority: "High" });
    const saved = get(data.id, "Note");
    const doc = JSON.parse(saved.content_json);
    expect(doc.content.map((n) => n.type)).toEqual(["heading", "paragraph", "taskList", "orderedList", "paragraph"]);
    expect(doc.content[0].attrs.level).toBe(2);
    const linked = doc.content[1].content.find((n) => n.text === "call the plumber");
    expect(linked.marks).toEqual([{ type: "taskLink", attrs: { taskId: t.id } }]);
    expect(doc.content[1].content.find((n) => n.text === "pay rent").marks).toEqual([{ type: "bold" }]);
    expect(doc.content[2].content.map((i) => i.attrs.checked)).toEqual([false, true]);
    // Another person's task id, a script link and raw HTML all stay plain text.
    const last = doc.content[4].content;
    expect(last.every((n) => !n.marks)).toBe(true);
    expect(last.map((n) => n.text).join("")).toBe("not mine bad <b>raw</b>");
    expect(saved.priority_id).toBe(priority("High").id);
    expect(saved.content_text).toContain("Laundry");
  });

  it("get_note shows a note as Markdown, links to tasks included", async () => {
    const n = note({
      title: "Trip",
      content_json: JSON.stringify({
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Plan" }] },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "call the plumber", marks: [{ type: "taskLink", attrs: { taskId: "task_x" } }] },
              { type: "text", text: " and " },
              { type: "text", text: "pack", marks: [{ type: "bold" }] },
            ],
          },
          { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "tickets" }] }] }] },
        ],
      }),
      content_text: "Plan\n\ncall the plumber and pack\n\ntickets",
    });
    const { data } = await run("get_note", { note_id: n.id });
    expect(data.markdown).toBe("# Plan\n\n[call the plumber](zephyrly-task:task_x) and **pack**\n\n- [x] tickets");
  });

  it("appending Markdown keeps what was there and adds structure after it", async () => {
    const n = note({ title: "List", content_text: "Intro" });
    await run("update_note", { note_id: n.id, append_text: "- one\n- two", priority: "Low" });
    const saved = get(n.id, "Note");
    expect(JSON.parse(saved.content_json).content.map((b) => b.type)).toEqual(["paragraph", "bulletList"]);
    expect(saved.priority_id).toBe(priority("Low").id);
    await run("update_note", { note_id: n.id, priority: "none" });
    expect(get(n.id, "Note").priority_id).toBe("");
  });
});


describe("format_note and make_task_from_note", () => {
  const note = (input) => createEntityRecord(db, { entityName: "Note", appId: APP_ID, user: ME, input, config });
  const markdownOf = async (id) => (await run("get_note", { note_id: id })).data.markdown;

  it("formats text like the toolbar, and one Undo puts the note back", async () => {
    const n = note({ title: "Trip", content_text: "Plan\n\ncall the plumber\n\nbuy milk" });
    await run("format_note", { note_id: n.id, text: "Plan", block: "heading1" });
    await run("format_note", { note_id: n.id, text: "the plumber", add: ["bold", "highlight:green"] });
    await run("format_note", { note_id: n.id, text: "buy milk", list: "checklist", checked: true });
    expect(await markdownOf(n.id)).toBe("# Plan\n\ncall **the plumber**\n\n- [x] buy milk");
    const line = JSON.parse(get(n.id, "Note").content_json).content.find((b) => (b.content || []).some((c) => c.text === "call "));
    const highlighted = line.content[1];
    expect(highlighted.marks).toEqual(expect.arrayContaining([{ type: "highlight", attrs: { color: "#bbf7d0" } }]));
    expect(listActivity(db, { appId: APP_ID, userId: ME.id })[0].summary).toBe('Formatted "buy milk" in the note “Trip”: checklist list, ticked.');
    undoLatest();
    expect(await markdownOf(n.id)).toBe("# Plan\n\ncall **the plumber**\n\nbuy milk");
  });

  it("says what's wrong instead of guessing", async () => {
    const n = note({ content_text: "hello" });
    await expect(run("format_note", { note_id: n.id, text: "goodbye", add: ["bold"] })).rejects.toThrow(/Couldn't find "goodbye"/);
    await expect(run("format_note", { note_id: n.id, text: "hello" })).rejects.toThrow(/Say what to do/);
    await expect(run("format_note", { note_id: n.id, text: "hello", add: ["highlight:yellow"] })).rejects.toThrow(/reserved/);
    expect(get(n.id, "Note").content_json).toBe("");
  });

  it("makes a task from note text, due today by default, and links the text to it", async () => {
    const { todayIn, dayLabel } = await import("./view.js");
    const n = note({ title: "Chores", content_text: "Remember to call the plumber soon" });
    const { data, text } = await run("make_task_from_note", { note_id: n.id, text: "call the plumber", time: "9am", priority: "High" });
    expect(get(data.id)).toMatchObject({ title: "call the plumber", due_date: todayIn("America/New_York"), task_time: "9:00AM", priority_id: priority("High").id });
    expect(await markdownOf(n.id)).toBe(`Remember to [call the plumber](zephyrly-task:${data.id}) soon`);
    expect(text).toBe(`Added “call the plumber” on ${dayLabel(todayIn("America/New_York"))}, 9:00AM–10:00AM, from the note “Chores”, and linked the text to it (task id ${data.id}).`);
    // Two log entries: the task (Undo deletes it) and the link (Undo unlinks).
    expect(listActivity(db, { appId: APP_ID, userId: ME.id }).map((a) => a.tool)).toEqual(["make_task_from_note", "create_task"]);
    const [linkEntry, taskEntry] = listActivity(db, { appId: APP_ID, userId: ME.id });
    undoActivity(db, config, { appId: APP_ID, user: ME, activityId: linkEntry.id });
    undoActivity(db, config, { appId: APP_ID, user: ME, activityId: taskEntry.id });
    expect(await markdownOf(n.id)).toBe("Remember to call the plumber soon");
    expect(() => get(data.id)).toThrow(/not found/);
  });

  it("makes nothing when the text isn't there or is already linked", async () => {
    const n = note({ content_text: "call the plumber" });
    await expect(run("make_task_from_note", { note_id: n.id, text: "fix the sink" })).rejects.toThrow(/Couldn't find/);
    await run("make_task_from_note", { note_id: n.id, text: "call the plumber", title: "Plumber", due_date: "2026-10-09" });
    const before = tasks().length;
    await expect(run("make_task_from_note", { note_id: n.id, text: "plumber" })).rejects.toThrow(/already linked to a task/);
    expect(tasks()).toHaveLength(before);
  });
});
