// @ts-nocheck
/* @vitest-environment node */
/**
 * The app reporting that it broke: one line in the server's log, from
 * anyone, trusting nothing that was sent.
 */
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestHandler } from "../server.js";
import { createDatabase, closeDatabase } from "../db.js";
import { createSession, findOrCreateUserByEmail } from "../auth.js";
import { resetRateLimits } from "../ai/rate-limit.js";
import { REPORTS_PER_MINUTE, oneLine } from "./client-errors.js";

const APP_ID = "test-app";
let tempDir = "";
let server;
let port;
let db;
let config;
let warned;

beforeEach(async () => {
  resetRateLimits();
  tempDir = mkdtempSync(join(tmpdir(), "client-errors-test-"));
  config = {
    host: "127.0.0.1", port: 0, appId: APP_ID, appName: "Zephyrly Test", publicAppUrl: "http://127.0.0.1:4173",
    dbFile: join(tempDir, "taskflow.sqlite"), sessionCookieName: "taskflow_test_session", sessionTtlDays: 30,
    deletedTaskRetentionDays: 7, allowAnyPassword: false, googleMode: "disabled", integrationsEnabled: false,
    syncIntervalMs: 60000, notificationPollMs: 60000,
  };
  db = createDatabase(config);
  server = http.createServer(createRequestHandler(config, db));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  warned = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  warned.mockRestore();
  await new Promise((resolve) => server.close(resolve));
  closeDatabase();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

const report = (body, headers = {}) =>
  fetch(`http://127.0.0.1:${port}/api/apps/${APP_ID}/client-errors`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const lines = () => warned.mock.calls.map((call) => call.join(" ")).filter((line) => line.includes("[client-error]"));

describe("POST /client-errors", () => {
  it("writes one log line for a report from someone signed out", async () => {
    const res = await report({ kind: "render", message: "tasks.map is not a function", page: "/Today", build: "2026-11-15T19:42", stack: "TypeError: tasks.map is not a function\n    at Today (Today.jsx:42)\n    at div" });
    expect(res.status).toBe(202);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain("render: tasks.map is not a function");
    expect(lines()[0]).toContain("page /Today");
    expect(lines()[0]).toContain("signed out");
    expect(lines()[0]).toContain("build 2026-11-15T19:42");
    expect(lines()[0]).toContain("at Today (Today.jsx:42)");
  });

  it("names the person from their session, never from what was sent", async () => {
    const user = findOrCreateUserByEmail(db, config, { appId: APP_ID, email: "someone@example.com" });
    const session = createSession(db, config, { headers: {}, socket: {} }, { appId: APP_ID, user });
    const res = await report({ message: "boom", user: "user_someone_else", who: "admin" }, { Cookie: session.sessionCookie.split(";")[0] });
    expect(res.status).toBe(202);
    expect(lines()[0]).toContain(`user ${user.id}`);
    expect(lines()[0]).not.toContain("user_someone_else");
    // The line never carries the person's email.
    expect(lines()[0]).not.toContain("someone@example.com");
  });

  it("keeps a report to one short line, whatever it is sent", async () => {
    const res = await report({ kind: "made-up", message: `first\n[zephyrly] forged line ${"x".repeat(2000)}`, page: "/Active\r\nSet-Cookie: x", stack: "a\n".repeat(50) });
    expect(res.status).toBe(202);
    const line = lines()[0];
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toContain("error: first [zephyrly] forged line");
    expect(line.length).toBeLessThan(1900);
  });

  it("refuses a large body, and stops listening to an address that keeps reporting", async () => {
    const big = await report({ message: "x".repeat(20_000) }).catch(() => ({ status: 413 }));
    expect(big.status).toBe(413);
    resetRateLimits();
    for (let i = 0; i < REPORTS_PER_MINUTE; i += 1) expect((await report({ message: `e${i}` })).status).toBe(202);
    expect((await report({ message: "one too many" })).status).toBe(429);
    expect(lines().join("\n")).not.toContain("one too many");
  });

  it("answers only POST, and only for this app", async () => {
    const get = await fetch(`http://127.0.0.1:${port}/api/apps/${APP_ID}/client-errors`);
    expect(get.status).toBe(405);
    const other = await fetch(`http://127.0.0.1:${port}/api/apps/other-app/client-errors`, { method: "POST", body: "{}" });
    expect(other.status).not.toBe(202);
    expect(lines()).toHaveLength(0);
  });
});

describe("oneLine", () => {
  it("flattens line breaks and control characters and cuts to length", () => {
    expect(oneLine("a\nb\u2028c\u0000d", 100)).toBe("a b c d");
    expect(oneLine("abcdef", 3)).toBe("abc");
    expect(oneLine(42, 10)).toBe("");
  });
});
