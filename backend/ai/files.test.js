// @ts-nocheck
/* @vitest-environment node */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../db.js";
import { createAttachment, getAttachment } from "../attachments.js";
import { createEntityRecord, ensureDefaultPrioritiesForUser } from "../store.js";
import { createGrant } from "./grants.js";
import { toolContext } from "./context.js";
import { runTool, toolsForGrant } from "./tools.js";
import { listActivity, undoActivity } from "./activity.js";
import { resetRateLimits } from "./rate-limit.js";

const APP_ID = "test-app";
const ME = { id: "user-me", email: "me@example.com" };
const THEM = { id: "user-them", email: "them@example.com" };
let tempDir;
let db;
let config;
let ctx;

function seedUser(user) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, app_id, full_name, email, role, auth_provider, preferences_json, created_date, updated_date)
     VALUES (?, ?, '', ?, 'user', 'local', '{}', ?, ?)`
  ).run(user.id, APP_ID, user.email, now, now);
  ensureDefaultPrioritiesForUser(db, { appId: APP_ID, user, config });
}
const task = (input, user = ME) => createEntityRecord(db, { entityName: "Task", appId: APP_ID, user, input, config });
const attach = (taskId, filename, mimeType, text, user = ME) =>
  createAttachment(db, config, { appId: APP_ID, user, taskId, file: { filename, mimeType, data: Buffer.from(text) } });
const run = (name, args, context = ctx) => runTool(context, name, args);

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ai-files-test-"));
  config = { appId: APP_ID, appName: "Test", dbFile: join(tempDir, "t.sqlite"), deletedTaskRetentionDays: 7 };
  db = createDatabase(config);
  seedUser(ME);
  seedUser(THEM);
  const grant = createGrant(db, { appId: APP_ID, userId: ME.id, kind: "token", label: "Claude", canWrite: true });
  ctx = toolContext(db, config, { grant, user: ME });
  resetRateLimits();
});

afterEach(() => {
  db?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("files", () => {
  it("lists a task's files and finds files by name, saying which can be read", async () => {
    const trip = task({ title: "Trip", due_date: "2026-10-05" });
    await attach(trip.id, "packing.md", "text/markdown", "- passport");
    await attach(trip.id, "ticket.pdf", "application/pdf", "%PDF");
    const theirs = task({ title: "Theirs", due_date: "2026-10-05" }, THEM);
    await attach(theirs.id, "packing-secret.txt", "text/plain", "no", THEM);

    const onTask = await run("list_files", { task_id: trip.id });
    expect(onTask.data.files.map((f) => [f.name, f.readable])).toEqual([["packing.md", true], ["ticket.pdf", false]]);
    const found = await run("list_files", { text: "packing" });
    expect(found.data.files.map((f) => f.name)).toEqual(["packing.md"]);
    expect(found.text).toContain('on "Trip"');
  });

  it("reads text files, and refuses PDFs, pages, someone else's file and files of deleted tasks", async () => {
    const trip = task({ title: "Trip", due_date: "2026-10-05" });
    const md = await attach(trip.id, "packing.md", "text/markdown", "# Packing\n- passport");
    const pdf = await attach(trip.id, "ticket.pdf", "application/pdf", "%PDF");
    const page = await attach(trip.id, "evil.html", "text/html", "<script>x</script>");
    const theirs = task({ title: "Theirs", due_date: "2026-10-05" }, THEM);
    const secret = await attach(theirs.id, "secret.txt", "text/plain", "private", THEM);

    expect((await run("read_file", { file_id: md.id })).data.text).toBe("# Packing\n- passport");
    await expect(run("read_file", { file_id: pdf.id })).rejects.toThrow(/only text files can be read/);
    await expect(run("read_file", { file_id: page.id })).rejects.toThrow(/only text files can be read/);
    await expect(run("read_file", { file_id: secret.id })).rejects.toThrow(`No file with id "${secret.id}".`);

    await run("delete_task", { task_id: trip.id });
    await expect(run("read_file", { file_id: md.id })).rejects.toThrow(/in Recently Deleted/);
  });

  it("cuts a long file off and says so", async () => {
    const t = task({ title: "Log", due_date: "2026-10-05" });
    const big = await attach(t.id, "log.txt", "text/plain", "x".repeat(30_000));
    const { data, text } = await run("read_file", { file_id: big.id });
    expect(data.truncated).toBe(true);
    expect(data.text).toHaveLength(20_000);
    expect(text).toContain("(cut off at 20,000 characters)");
  });

  it("attaches a text file, and undo takes it off again", async () => {
    const t = task({ title: "Essay", due_date: "2026-10-05" });
    const { data } = await run("attach_text_file", { task_id: t.id, filename: "outline", text: "1. Intro" });
    expect(data.name).toBe("outline.txt");
    const stored = getAttachment(db, config, { appId: APP_ID, user: ME, id: data.id });
    expect(stored.row).toMatchObject({ filename: "outline.txt", mime_type: "text/plain" });
    expect(readFileSync(stored.absolutePath, "utf8")).toBe("1. Intro");
    expect(db.prepare("SELECT attachment_count FROM tasks WHERE id = ?").get(t.id).attachment_count).toBe(1);

    const md = await run("attach_text_file", { task_id: t.id, filename: "notes.md", text: "# Notes" });
    expect(getAttachment(db, config, { appId: APP_ID, user: ME, id: md.data.id }).row.mime_type).toBe("text/markdown");
    // An .html name doesn't make it a page: it stays text, named .txt.
    const sneaky = await run("attach_text_file", { task_id: t.id, filename: "x.html", text: "<script>" });
    expect(sneaky.data.name).toBe("x.html.txt");

    const entry = listActivity(db, { appId: APP_ID, userId: ME.id }).find((a) => a.summary.includes("outline.txt"));
    undoActivity(db, config, { appId: APP_ID, user: ME, activityId: entry.id });
    expect(existsSync(stored.absolutePath)).toBe(false);
    expect(() => getAttachment(db, config, { appId: APP_ID, user: ME, id: data.id })).toThrow(/not found/);
    expect(db.prepare("SELECT attachment_count FROM tasks WHERE id = ?").get(t.id).attachment_count).toBe(2);
  });

  it("won't attach to a calendar item, and keeps the task's file limit", async () => {
    const event = task({ title: "Dentist", due_date: "2026-10-05", source_provider: "google", source_kind: "event" });
    await expect(run("attach_text_file", { task_id: event.id, filename: "a.txt", text: "x" })).rejects.toThrow(/calendar items/);
    const full = task({ title: "Full", due_date: "2026-10-05" });
    for (let i = 0; i < 10; i += 1) await attach(full.id, `f${i}.txt`, "text/plain", "x");
    await expect(run("attach_text_file", { task_id: full.id, filename: "one-more.txt", text: "x" })).rejects.toThrow(/Too many attachments/);
  });

  it("read-only connections get the reading tools but not attach", () => {
    const readOnly = createGrant(db, { appId: APP_ID, userId: ME.id, kind: "token", label: "ro", canWrite: false });
    const names = toolsForGrant(readOnly).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_files", "read_file"]));
    expect(names).not.toContain("attach_text_file");
  });
});
