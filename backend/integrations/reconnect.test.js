// @ts-nocheck
/* @vitest-environment node */
/**
 * Connecting a calendar that is already here (a reconnect) sends what was
 * kept for it while it couldn't take anything (push/outbox.js).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../providers/apple-calendar.js", async (original) => ({
  ...(await original()),
  discoverAppleCalendars: vi.fn(async () => ({
    calendars: [{
      id: "https://caldav.icloud.com/1/calendars/home/", url: "https://caldav.icloud.com/1/calendars/home/",
      summary: "Home", description: null, timeZone: "America/New_York", colorHex: "#3174ad", accessRole: "owner", primary: true,
    }],
  })),
}));

const { createDatabase } = await import("../db.js");
const { connectApple } = await import("./apple-connect.js");
const { heldChanges, holdPush, rememberPush } = await import("../push/outbox.js");

const APP = "test-app";
let tempDir = "";
let db;
let config;
const iso = () => new Date().toISOString();

beforeEach(() => {
  process.env.INTEGRATIONS_ENCRYPTION_KEY = "a".repeat(64);
  tempDir = mkdtempSync(join(tmpdir(), "zephyrly-reconnect-"));
  config = { host: "127.0.0.1", port: 0, appId: APP, appName: "Zephyrly Test", dbFile: join(tempDir, "taskflow.sqlite"), integrationsEnabled: true, publicAppUrl: "http://127.0.0.1:4173", sessionTtlDays: 30, deletedTaskRetentionDays: 7 };
  db = createDatabase(config);
  db.prepare(`INSERT INTO users (id, app_id, email, role, auth_provider, created_date, updated_date) VALUES ('user_1', ?, 'someone@example.com', 'admin', 'local', ?, ?)`).run(APP, iso(), iso());
});

afterEach(() => {
  db?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("connecting a calendar that is already connected", () => {
  it("keeps the same connection and makes what was kept for it due now", async () => {
    const user = { id: "user_1" };
    await connectApple(db, config, { user, appId: APP, email: "someone@example.com", password: "aaaa-bbbb-cccc-dddd" });
    const [first] = db.prepare(`SELECT * FROM calendar_integrations`).all();

    // A change made while iCloud was refusing the old password.
    const token = rememberPush(db, { op: "upsert", appId: APP, taskSnapshot: { id: "task_1", created_by_id: "user_1" } });
    holdPush(db, { taskId: "task_1", token, integrationId: first.id });
    expect(heldChanges(db, first.id)).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM push_outbox WHERE next_attempt_at <= ?`).get(iso()).n).toBe(0);

    await connectApple(db, config, { user, appId: APP, email: "Someone@Example.com", password: "eeee-ffff-gggg-hhhh" });

    const rows = db.prepare(`SELECT * FROM calendar_integrations`).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].status).toBe("active");
    expect(heldChanges(db, first.id)).toBe(0);
    // Still in the outbox, and its turn is now: the next sync round sends it.
    expect(db.prepare(`SELECT COUNT(*) AS n FROM push_outbox WHERE task_id = 'task_1' AND next_attempt_at <= ?`).get(iso()).n).toBe(1);
  });
});
