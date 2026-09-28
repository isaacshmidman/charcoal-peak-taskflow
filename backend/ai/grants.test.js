// @ts-nocheck
/* @vitest-environment node */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../db.js";
import { sha256 } from "../auth.js";
import {
  MAX_ACTIVE_TOKENS_PER_USER,
  createGrant,
  createPersonalToken,
  findGrantForToken,
  issueToken,
  listGrants,
  purgeExpiredAiRecords,
  requireAiGrant,
  revokeGrant,
  setGrantCanWrite,
} from "./grants.js";

const APP_ID = "test-app";
const ME = { id: "user-me", email: "me@example.com" };
const THEM = { id: "user-them", email: "them@example.com" };
let tempDir = "";
let db;

function seedUser(user) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, app_id, full_name, email, role, auth_provider, preferences_json, created_date, updated_date)
     VALUES (?, ?, '', ?, 'user', 'local', '{}', ?, ?)`
  ).run(user.id, APP_ID, user.email, now, now);
}

const bearer = (token) => ({ headers: { authorization: `Bearer ${token}` } });

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ai-grants-test-"));
  db = createDatabase({ appId: APP_ID, appName: "Test", dbFile: join(tempDir, "t.sqlite"), deletedTaskRetentionDays: 7 });
  seedUser(ME);
  seedUser(THEM);
});

afterEach(() => {
  db?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("personal tokens", () => {
  it("are shown once and stored only as a hash, then open the grant they carry", () => {
    const { grant, token } = createPersonalToken(db, { appId: APP_ID, user: ME, label: "Claude Code", canWrite: false, timeZone: "America/New_York" });
    expect(token).toMatch(/^zeph_pat_[A-Za-z0-9_-]{43}$/);
    expect(grant).toMatchObject({ kind: "token", label: "Claude Code", can_write: false, time_zone: "America/New_York" });

    const stored = db.prepare("SELECT * FROM ai_tokens").all();
    expect(stored).toHaveLength(1);
    expect(stored[0].token_hash).toBe(sha256(token));
    expect(JSON.stringify(stored)).not.toContain(token);

    const found = findGrantForToken(db, APP_ID, token);
    expect(found.user.id).toBe(ME.id);
    expect(found.grant.id).toBe(grant.id);
  });

  it("only allow changes when asked to in so many words", () => {
    for (const canWrite of [undefined, "true", 1, "yes"]) {
      const { grant } = createPersonalToken(db, { appId: APP_ID, user: ME, label: `t ${canWrite}`, canWrite });
      expect(grant.can_write).toBe(false);
    }
    expect(createPersonalToken(db, { appId: APP_ID, user: ME, label: "w", canWrite: true }).grant.can_write).toBe(true);
  });

  it("need a name, and keep it plain", () => {
    expect(() => createPersonalToken(db, { appId: APP_ID, user: ME, label: "  ", canWrite: false })).toThrow(/name/);
    const { grant } = createPersonalToken(db, { appId: APP_ID, user: ME, label: `LM\nStudio${"x".repeat(200)}`, canWrite: false });
    expect(grant.label).toMatch(/^LM Studio/);
    expect(grant.label.length).toBe(100);
  });

  it("fall back to UTC for a time zone that isn't one", () => {
    const { grant } = createPersonalToken(db, { appId: APP_ID, user: ME, label: "x", canWrite: false, timeZone: "Mars/Olympus" });
    expect(grant.time_zone).toBe("UTC");
  });

  it(`are capped at ${MAX_ACTIVE_TOKENS_PER_USER} live ones per person`, () => {
    const made = [];
    for (let i = 0; i < MAX_ACTIVE_TOKENS_PER_USER; i += 1) {
      made.push(createPersonalToken(db, { appId: APP_ID, user: ME, label: `t${i}`, canWrite: false }).grant);
    }
    expect(() => createPersonalToken(db, { appId: APP_ID, user: ME, label: "one more", canWrite: false })).toThrow(/Revoke one/);
    // Someone else's count is their own.
    expect(() => createPersonalToken(db, { appId: APP_ID, user: THEM, label: "theirs", canWrite: false })).not.toThrow();
    revokeGrant(db, { appId: APP_ID, userId: ME.id, grantId: made[0].id });
    expect(() => createPersonalToken(db, { appId: APP_ID, user: ME, label: "one more", canWrite: false })).not.toThrow();
  });
});

describe("which tokens open a request", () => {
  it("rejects missing, unknown, session-shaped, expired and refresh tokens", () => {
    const grant = createGrant(db, { appId: APP_ID, userId: ME.id, kind: "oauth", label: "Claude", canWrite: false });
    const refresh = issueToken(db, { grantId: grant.id, kind: "refresh", ttlMs: 60_000 });
    const expired = issueToken(db, { grantId: grant.id, kind: "access", ttlMs: -1 });
    const live = issueToken(db, { grantId: grant.id, kind: "access", ttlMs: 60_000 });

    expect(findGrantForToken(db, APP_ID, "")).toBeNull();
    expect(findGrantForToken(db, APP_ID, "zeph_pat_nope")).toBeNull();
    // A sign-in session's access token looks nothing like ours.
    expect(findGrantForToken(db, APP_ID, "Q2hhbmdlIG1lIHRvIGEgcmVhbCBzZXNzaW9uIHRva2Vu")).toBeNull();
    expect(findGrantForToken(db, APP_ID, expired)).toBeNull();
    expect(findGrantForToken(db, APP_ID, refresh)).toBeNull();
    expect(findGrantForToken(db, APP_ID, live)?.grant.id).toBe(grant.id);
    expect(findGrantForToken(db, "another-app", live)).toBeNull();
  });

  it("requireAiGrant reads the bearer header, 401s without one, and notes when it was used", () => {
    const { grant, token } = createPersonalToken(db, { appId: APP_ID, user: ME, label: "x", canWrite: false });
    const config = { appId: APP_ID };
    expect(() => requireAiGrant(db, config, { headers: {} })).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => requireAiGrant(db, config, { headers: { authorization: token } })).toThrow(expect.objectContaining({ status: 401 }));

    expect(requireAiGrant(db, config, bearer(token)).user.email).toBe(ME.email);
    const usedAt = db.prepare("SELECT last_used_at FROM ai_grants WHERE id = ?").get(grant.id).last_used_at;
    expect(usedAt).toBeTruthy();
    // Within a minute it isn't rewritten on every request.
    requireAiGrant(db, config, bearer(token));
    expect(db.prepare("SELECT last_used_at FROM ai_grants WHERE id = ?").get(grant.id).last_used_at).toBe(usedAt);
  });
});

describe("managing connections", () => {
  it("revoking stops the token at once and hides the connection, keeping the row for the activity log", () => {
    const { grant, token } = createPersonalToken(db, { appId: APP_ID, user: ME, label: "x", canWrite: true });
    revokeGrant(db, { appId: APP_ID, userId: ME.id, grantId: grant.id });
    expect(findGrantForToken(db, APP_ID, token)).toBeNull();
    expect(listGrants(db, { appId: APP_ID, userId: ME.id })).toEqual([]);
    expect(db.prepare("SELECT revoked_at FROM ai_grants WHERE id = ?").get(grant.id).revoked_at).toBeTruthy();
    expect(db.prepare("SELECT COUNT(*) n FROM ai_tokens").get().n).toBe(0);
  });

  it("changing access applies to the very next request", () => {
    const { grant, token } = createPersonalToken(db, { appId: APP_ID, user: ME, label: "x", canWrite: false });
    expect(setGrantCanWrite(db, { appId: APP_ID, userId: ME.id, grantId: grant.id, canWrite: true }).can_write).toBe(true);
    expect(findGrantForToken(db, APP_ID, token).grant.can_write).toBe(1);
    expect(() => setGrantCanWrite(db, { appId: APP_ID, userId: ME.id, grantId: grant.id, canWrite: "false" })).toThrow(/true or false/);
  });

  it("nobody can see, change or revoke someone else's connection", () => {
    const { grant, token } = createPersonalToken(db, { appId: APP_ID, user: ME, label: "mine", canWrite: false });
    expect(listGrants(db, { appId: APP_ID, userId: THEM.id })).toEqual([]);
    expect(() => setGrantCanWrite(db, { appId: APP_ID, userId: THEM.id, grantId: grant.id, canWrite: true })).toThrow(/doesn't exist/);
    expect(() => revokeGrant(db, { appId: APP_ID, userId: THEM.id, grantId: grant.id })).toThrow(/doesn't exist/);
    expect(findGrantForToken(db, APP_ID, token)).not.toBeNull();
  });

  it("the list never carries a secret or its hash", () => {
    const { token } = createPersonalToken(db, { appId: APP_ID, user: ME, label: "x", canWrite: false });
    const listed = JSON.stringify(listGrants(db, { appId: APP_ID, userId: ME.id }));
    expect(listed).not.toContain(token);
    expect(listed).not.toContain(sha256(token));
  });
});

describe("housekeeping", () => {
  it("drops expired access tokens, exchanged refresh tokens after a day, and activity past 30 days", () => {
    const grant = createGrant(db, { appId: APP_ID, userId: ME.id, kind: "oauth", label: "Claude", canWrite: false });
    const expired = issueToken(db, { grantId: grant.id, kind: "access", ttlMs: -1 });
    const live = issueToken(db, { grantId: grant.id, kind: "access", ttlMs: 60_000 });
    const oldRefresh = issueToken(db, { grantId: grant.id, kind: "refresh", ttlMs: 60_000 });
    const freshRefresh = issueToken(db, { grantId: grant.id, kind: "refresh", ttlMs: 60_000 });
    const dayAndABitAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE ai_tokens SET used_at = ? WHERE token_hash = ?").run(dayAndABitAgo, sha256(oldRefresh));
    db.prepare("UPDATE ai_tokens SET used_at = ? WHERE token_hash = ?").run(new Date().toISOString(), sha256(freshRefresh));
    const activity = db.prepare(
      `INSERT INTO ai_activity (id, app_id, user_id, grant_id, tool, summary, created_date) VALUES (?, ?, ?, ?, 'x', 'x', ?)`
    );
    activity.run("old", APP_ID, ME.id, grant.id, new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString());
    activity.run("new", APP_ID, ME.id, grant.id, new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString());

    purgeExpiredAiRecords(db);

    const left = db.prepare("SELECT token_hash FROM ai_tokens").all().map((r) => r.token_hash).sort();
    expect(left).toEqual([sha256(live), sha256(freshRefresh)].sort());
    expect(left).not.toContain(sha256(expired));
    expect(db.prepare("SELECT id FROM ai_activity").all().map((r) => r.id)).toEqual(["new"]);
  });
});
