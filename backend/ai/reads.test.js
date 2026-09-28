// @ts-nocheck
/* @vitest-environment node */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../db.js";
import { createEntityRecord, ensureDefaultPrioritiesForUser, listEntityRecords } from "../store.js";
import { updateUserNotificationSettings } from "../notifications.js";
import { createGrant } from "./grants.js";
import { toolContext } from "./context.js";
import { runTool, toolsForGrant } from "./tools.js";
import { addDaysYmd, todayIn } from "./view.js";

const APP_ID = "test-app";
const TZ = "America/New_York";
const ME = { id: "user-me", email: "me@example.com" };
const THEM = { id: "user-them", email: "them@example.com" };
let tempDir = "";
let db;
let config;
let today = "";
let ids = {};

function seedUser(user) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, app_id, full_name, email, role, auth_provider, preferences_json, created_date, updated_date)
     VALUES (?, ?, '', ?, 'user', 'local', '{}', ?, ?)`
  ).run(user.id, APP_ID, user.email, now, now);
  ensureDefaultPrioritiesForUser(db, { appId: APP_ID, user, config });
}

const priorityId = (user, name) =>
  listEntityRecords(db, { entityName: "Priority", appId: APP_ID, user }).find((p) => p.name === name).id;

function task(input, user = ME) {
  const created = createEntityRecord(db, { entityName: "Task", appId: APP_ID, user, input, config });
  ids[input.title] = created.id;
  return created;
}

function ctxFor(grantInput = {}) {
  const grant = createGrant(db, { appId: APP_ID, userId: ME.id, kind: "token", label: "test", canWrite: false, timeZone: TZ, ...grantInput });
  return toolContext(db, config, { grant, user: ME });
}

/** The task titles on a text answer's lines, in order. */
const titlesIn = (text) => [...text.matchAll(/^- (?:.*? · )?(.+?)(?: \(done\))?(?: \[| #| —| \(id )/gm)].map((m) => m[1]);

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ai-reads-test-"));
  config = { appId: APP_ID, appName: "Test", dbFile: join(tempDir, "t.sqlite"), deletedTaskRetentionDays: 7 };
  db = createDatabase(config);
  seedUser(ME);
  seedUser(THEM);
  today = todayIn(TZ);
  ids = {};
  const P = (name) => priorityId(ME, name);

  // Alphabetical, by time and by priority all disagree:
  // untimed first (Yam Urgent, then Kiwi Normal), then 9:00AM Zebra, 11:00AM Dentist, 2:00PM Apple.
  task({ title: "Apple pie", due_date: today, task_time: "2:00PM", task_end_time: "3:00PM", priority_id: P("Low"), tags: ["baking"] });
  task({ title: "Kiwi tart", due_date: today, priority_id: P("Normal"), tags: ["baking"] });
  task({ title: "Yam soup", due_date: today, priority_id: P("Urgent") });
  task({ title: "Zebra report", due_date: today, task_time: "9:00AM", task_end_time: "10:00AM", priority_id: P("Urgent"), description: "Quarterly zebra numbers" });
  task({ title: "Buy flour", parent_id: ids["Kiwi tart"], due_date: today });
  task({ title: "Done thing", due_date: today, status: "done", completed_at: new Date().toISOString() });
  task({ title: "Old essay", due_date: addDaysYmd(today, -3), priority_id: P("High"), tags: ["school"] });
  task({ title: "Tomorrow thing", due_date: addDaysYmd(today, 1) });
  task({ title: "Water plants", due_date: addDaysYmd(today, 1), recurrence: "weekly", task_type: "recurring" });
  const event = { source_provider: "google", source_kind: "event", source_calendar_name: "Work", source_writable: true };
  task({ title: "Dentist", due_date: today, task_time: "11:00AM", task_end_time: "12:00PM", ...event });
  task({ title: "Old meeting", due_date: addDaysYmd(today, -2), ...event });
  task({ title: "Not yours", due_date: today }, THEM);
});

afterEach(() => {
  db?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("get_agenda", () => {
  it("lists today in the person's time zone: untimed by priority, then by time, events marked read-only", async () => {
    const { text, data } = await runTool(ctxFor(), "get_agenda", {});
    expect(data.today).toBe(today);
    expect(data.time_zone).toBe(TZ);
    expect(data.days[0].tasks.map((t) => t.title)).toEqual(["Yam soup", "Kiwi tart", "Zebra report", "Dentist", "Apple pie"]);
    expect(text).toContain("Dentist — event from Google calendar · Work, read-only");
    expect(text).toContain("Kiwi tart [Normal] #baking — 0/1 subtasks done");
    expect(text).toContain("(1 already done)");
    expect(text).not.toContain("Not yours");
    expect(text).not.toContain("Buy flour");
  });

  it("puts overdue tasks first, but never past calendar events", async () => {
    const { text, data } = await runTool(ctxFor(), "get_agenda", {});
    expect(data.overdue.map((t) => t.title)).toEqual(["Old essay"]);
    expect(text.indexOf("Old essay")).toBeLessThan(text.indexOf("Yam soup"));
    expect(text).not.toContain("Old meeting");
    const quiet = await runTool(ctxFor(), "get_agenda", { include_overdue: false });
    expect(quiet.data.overdue).toEqual([]);
  });

  it("covers several days, and a range that doesn't start today has no overdue section", async () => {
    const { data } = await runTool(ctxFor(), "get_agenda", { days: 2 });
    expect(data.days.map((d) => d.date)).toEqual([today, addDaysYmd(today, 1)]);
    expect(data.days[1].tasks.map((t) => t.title)).toEqual(["Tomorrow thing", "Water plants"]);
    expect(data.days[1].tasks[1].repeats).toBe("every week");

    const later = await runTool(ctxFor(), "get_agenda", { start_date: addDaysYmd(today, 1) });
    expect(later.data.overdue).toEqual([]);
    expect(later.text).toContain("- Water plants — repeats every week");
  });

  it("says plainly when a day is empty", async () => {
    const { text } = await runTool(ctxFor(), "get_agenda", { start_date: addDaysYmd(today, 30) });
    expect(text).toContain("- Nothing due.");
  });
});

describe("search_tasks", () => {
  it("finds open top-level tasks by date order, leaving out events, subtasks and other people's tasks", async () => {
    const { data } = await runTool(ctxFor(), "search_tasks", {});
    const titles = data.tasks.map((t) => t.title);
    expect(titles[0]).toBe("Old essay");
    expect(titles).toContain("Yam soup");
    for (const absent of ["Dentist", "Old meeting", "Buy flour", "Done thing", "Not yours"]) expect(titles).not.toContain(absent);
  });

  it("matches words anywhere in the title or description, including subtasks", async () => {
    const zebra = await runTool(ctxFor(), "search_tasks", { text: "quarterly NUMBERS" });
    expect(zebra.data.tasks.map((t) => t.title)).toEqual(["Zebra report"]);
    const flour = await runTool(ctxFor(), "search_tasks", { text: "flour" });
    expect(flour.text).toContain('Buy flour');
    expect(flour.text).toContain('subtask of "Kiwi tart"');
  });

  it("filters by priority name in any case, tag, status and dates, and can include events", async () => {
    const urgent = await runTool(ctxFor(), "search_tasks", { priority: "urgent" });
    expect(urgent.data.tasks.map((t) => t.title).sort()).toEqual(["Yam soup", "Zebra report"]);
    const baking = await runTool(ctxFor(), "search_tasks", { tag: "#Baking" });
    expect(baking.data.tasks.map((t) => t.title).sort()).toEqual(["Apple pie", "Kiwi tart"]);
    const done = await runTool(ctxFor(), "search_tasks", { status: "done" });
    expect(done.data.tasks.map((t) => t.title)).toEqual(["Done thing"]);
    const past = await runTool(ctxFor(), "search_tasks", { due_before: addDaysYmd(today, -1) });
    expect(past.data.tasks.map((t) => t.title)).toEqual(["Old essay"]);
    const withEvents = await runTool(ctxFor(), "search_tasks", { include_calendar_events: true, due_after: today, due_before: today });
    expect(withEvents.data.tasks.map((t) => t.title)).toContain("Dentist");
  });

  it("names the real priorities when asked for one that doesn't exist", async () => {
    await expect(runTool(ctxFor(), "search_tasks", { priority: "Critical" })).rejects.toThrow(/Urgent, High, Normal, Low/);
  });

  it("caps the list and says how many there were", async () => {
    const { text, data } = await runTool(ctxFor(), "search_tasks", { limit: 2 });
    expect(data.tasks).toHaveLength(2);
    expect(text).toMatch(/^\d+ matching tasks, showing the first 2:/);
  });
});

describe("get_task", () => {
  it("shows subtasks, files, reminder and repeats", async () => {
    db.prepare(
      `INSERT INTO task_attachments (id, app_id, user_id, task_id, filename, mime_type, size_bytes, storage_path, is_image, created_date)
       VALUES ('att_1', ?, ?, ?, 'Recipe.pdf', 'application/pdf', 3, 'x', 0, ?)`
    ).run(APP_ID, ME.id, ids["Kiwi tart"], new Date().toISOString());
    db.prepare("UPDATE tasks SET reminder = 'before:30' WHERE id = ?").run(ids["Kiwi tart"]);
    const { text, data } = await runTool(ctxFor(), "get_task", { task_id: ids["Kiwi tart"] });
    expect(data.subtask_list.map((s) => s.title)).toEqual(["Buy flour"]);
    expect(data.files).toEqual(["Recipe.pdf"]);
    expect(data.editable).toBe(true);
    expect(text).toContain("Reminder: 30 minutes before.");
    expect(text).toContain(`- [ ] Buy flour (id ${ids["Buy flour"]})`);
  });

  it("says a calendar event can't be changed here", async () => {
    const { text, data } = await runTool(ctxFor(), "get_task", { task_id: ids.Dentist });
    expect(data).toMatchObject({ editable: false, is_event: true, from_calendar: "Google calendar · Work" });
    expect(text).toContain("read-only here; change it in the calendar itself");
  });

  it("won't show someone else's task, and says so the same way as a missing one", async () => {
    await expect(runTool(ctxFor(), "get_task", { task_id: ids["Not yours"] })).rejects.toThrow(`No task with id "${ids["Not yours"]}".`);
    await expect(runTool(ctxFor(), "get_task", { task_id: "task_nope" })).rejects.toThrow('No task with id "task_nope".');
  });
});

describe("notes", () => {
  beforeEach(() => {
    const note = (input) => createEntityRecord(db, { entityName: "Note", appId: APP_ID, user: ME, input, config });
    note({ title: "Recipes", content_text: "Kiwi tart needs flour", tags: ["baking"] });
    note({ title: "Pinned plan", content_text: "Trip plan and flour list", pinned: true });
    note({ title: "Long one", content_text: "x".repeat(25_000) });
    createEntityRecord(db, { entityName: "Note", appId: APP_ID, user: THEM, input: { title: "Their flour", content_text: "flour" }, config });
  });

  it("search puts pinned notes first and never shows another person's", async () => {
    const { data } = await runTool(ctxFor(), "search_notes", { text: "flour" });
    expect(data.notes.map((n) => n.title)).toEqual(["Pinned plan", "Recipes"]);
    const tagged = await runTool(ctxFor(), "search_notes", { tag: "baking" });
    expect(tagged.data.notes.map((n) => n.title)).toEqual(["Recipes"]);
  });

  it("reading a very long note cuts it off and says so", async () => {
    const { data: found } = await runTool(ctxFor(), "search_notes", { text: "" });
    const long = found.notes.find((n) => n.title === "Long one");
    const { data, text } = await runTool(ctxFor(), "get_note", { note_id: long.id });
    expect(data.truncated).toBe(true);
    expect(text).toContain("(cut off at 20,000 characters)");
  });
});

describe("list_priorities_and_tags", () => {
  it("gives priorities most urgent first and every tag in use", async () => {
    const { data } = await runTool(ctxFor(), "list_priorities_and_tags", {});
    expect(data.priorities.map((p) => p.name)).toEqual(["Urgent", "High", "Normal", "Low"]);
    expect(data.tags).toEqual(["baking", "school"]);
  });
});

describe("running tools", () => {
  it("refuses unknown tools, unknown arguments and impossible dates with a message the model can act on", async () => {
    await expect(runTool(ctxFor(), "delete_everything", {})).rejects.toThrow('There\'s no tool called "delete_everything".');
    await expect(runTool(ctxFor(), "get_agenda", { start: today })).rejects.toThrow(/Unknown argument "start"\. Allowed: start_date, days, include_overdue\./);
    await expect(runTool(ctxFor(), "get_agenda", { start_date: "2026-02-30" })).rejects.toThrow("must be a date written like 2026-09-28");
    await expect(runTool(ctxFor(), "get_agenda", { days: 40 })).rejects.toThrow("at most 31");
  });

  it("forgives the shapes small models get wrong", async () => {
    const { data } = await runTool(ctxFor(), "get_agenda", { days: "2", include_overdue: "false" });
    expect(data.days).toHaveLength(2);
    expect(data.overdue).toEqual([]);
  });

  it("a read-only connection is offered only read tools", () => {
    expect(toolsForGrant({ can_write: 0 }).every((t) => !t.write)).toBe(true);
  });

  it("'today' falls back to the notification time zone, then UTC", async () => {
    updateUserNotificationSettings(db, { appId: APP_ID, userId: ME.id, input: { timeZone: "Pacific/Kiritimati" } });
    expect(ctxFor({ timeZone: "UTC" }).timeZone).toBe("Pacific/Kiritimati");
    expect(ctxFor({ timeZone: "Asia/Tokyo" }).timeZone).toBe("Asia/Tokyo");
    const { data } = await runTool(ctxFor({ timeZone: "UTC" }), "get_agenda", {});
    expect(data.today).toBe(todayIn("Pacific/Kiritimati"));
  });
});
