// @ts-nocheck
/* @vitest-environment node */
/**
 * End-to-end attachment integration test.
 *
 * Spins up a real http.createServer with the full request handler,
 * POSTs a real multipart/form-data body containing a real PNG, then:
 *   - asserts the response is 201 + the right shape
 *   - asserts the bytes on disk are EXACTLY the bytes uploaded (this
 *     is the test that would have caught the parser corruption bug)
 *   - asserts the thumbnail was generated and is smaller than the
 *     original
 *   - asserts GET /attachments/:id returns the original bytes
 *   - asserts GET /attachments/:id?thumb=1 returns a WebP buffer
 *     (smaller, image/webp content-type)
 *
 * These exercises catch parser AND route-wiring AND sharp-integration
 * regressions in one shot.
 */
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createRequestHandler } from "../server.js";
import { createDatabase, closeDatabase } from "../db.js";

let tempDir = "";
let server;
let port;
let db;
let config;
let cookie;

const APP_ID = "test-app";
const EMAIL = "user@example.com";

function makeConfig(dbFile) {
  return {
    host: "127.0.0.1",
    port: 0,
    appId: APP_ID,
    appName: "Zephyrly Test",
    publicAppUrl: "http://127.0.0.1:4173",
    dbFile,
    sessionCookieName: "taskflow_test_session",
    sessionTtlDays: 30,
    deletedTaskRetentionDays: 7,
    allowAnyPassword: true,
    googleClientId: "",
    googleClientSecret: "",
    hasGoogleCredentials: false,
    googleMode: "disabled",
    googleCalendarClientId: "",
    googleCalendarClientSecret: "",
    hasGoogleCalendarCredentials: false,
    integrationsEnabled: false,
    syncIntervalMs: 60000,
    notificationPollMs: 60000,
    vapidPublicKey: "",
    vapidPrivateKey: "",
    vapidSubject: "mailto:test@example.com",
  };
}

/** Hit the dev login route and return the Set-Cookie value. */
async function login() {
  const url = `http://127.0.0.1:${port}/api/apps/${APP_ID}/auth/login`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: "anything" }),
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie.split(";")[0];  // just "name=value"
}

/** Generate a real PNG that sharp can decode. */
async function realPng({ width = 50, height = 40 } = {}) {
  return sharp({
    create: { width, height, channels: 3, background: "#0066ff" },
  }).png().toBuffer();
}

/** Build a multipart/form-data body for a single file field. */
function buildMultipart(filename, mimeType, body) {
  const boundary = `----TestBoundary${Math.random().toString(36).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, body, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "att-route-test-"));
  config = makeConfig(join(tempDir, "taskflow.sqlite"));
  db = createDatabase(config);
  const handler = createRequestHandler(config, db);
  server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  cookie = await login();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDatabase();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("attachment route end-to-end", () => {
  it("POSTs a real PNG, gets it back byte-for-byte, thumbnail works", async () => {
    // 1) Create a task via the entities API.
    const taskRes = await fetch(`http://127.0.0.1:${port}/api/apps/${APP_ID}/entities/Task`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: "Test task", status: "todo" }),
    });
    expect(taskRes.status).toBe(201);
    const task = await taskRes.json();
    expect(task.id).toMatch(/^task_/);

    // 2) POST a real PNG via multipart.
    const pngBytes = await realPng({ width: 600, height: 400 });
    const { body, contentType } = buildMultipart("photo.png", "image/png", pngBytes);

    const uploadRes = await fetch(
      `http://127.0.0.1:${port}/api/apps/${APP_ID}/tasks/${task.id}/attachments`,
      {
        method: "POST",
        headers: { "Content-Type": contentType, Cookie: cookie },
        body,
      }
    );
    expect(uploadRes.status).toBe(201);
    const attachment = await uploadRes.json();
    expect(attachment.id).toMatch(/^att_/);
    expect(attachment.filename).toBe("photo.png");
    expect(attachment.mime_type).toBe("image/png");
    expect(attachment.size_bytes).toBe(pngBytes.length);
    expect(attachment.is_image).toBe(true);
    expect(attachment.has_thumb).toBe(true);

    // 3) GET the original — bytes must match exactly.
    const getRes = await fetch(
      `http://127.0.0.1:${port}/api/apps/${APP_ID}/attachments/${attachment.id}`,
      { headers: { Cookie: cookie } }
    );
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("content-type")).toBe("image/png");
    const got = Buffer.from(await getRes.arrayBuffer());
    expect(got.length).toBe(pngBytes.length);
    expect(got.equals(pngBytes)).toBe(true);

    // 4) GET ?thumb=1 — must be a smaller WebP.
    const thumbRes = await fetch(
      `http://127.0.0.1:${port}/api/apps/${APP_ID}/attachments/${attachment.id}?thumb=1`,
      { headers: { Cookie: cookie } }
    );
    expect(thumbRes.status).toBe(200);
    expect(thumbRes.headers.get("content-type")).toBe("image/webp");
    const thumbBytes = Buffer.from(await thumbRes.arrayBuffer());
    expect(thumbBytes.length).toBeLessThan(pngBytes.length);
    // WebP magic: "RIFF....WEBP"
    expect(thumbBytes.slice(0, 4).toString("ascii")).toBe("RIFF");
    expect(thumbBytes.slice(8, 12).toString("ascii")).toBe("WEBP");

    // 5) List shows it.
    const listRes = await fetch(
      `http://127.0.0.1:${port}/api/apps/${APP_ID}/tasks/${task.id}/attachments`,
      { headers: { Cookie: cookie } }
    );
    expect(listRes.status).toBe(200);
    const listed = await listRes.json();
    expect(listed.attachments).toHaveLength(1);
    expect(listed.attachments[0].id).toBe(attachment.id);

    // 6) DELETE works.
    const delRes = await fetch(
      `http://127.0.0.1:${port}/api/apps/${APP_ID}/attachments/${attachment.id}`,
      { method: "DELETE", headers: { Cookie: cookie } }
    );
    expect(delRes.status).toBe(200);

    const after = await fetch(
      `http://127.0.0.1:${port}/api/apps/${APP_ID}/attachments/${attachment.id}`,
      { headers: { Cookie: cookie } }
    );
    expect(after.status).toBe(404);
  });

  it("preserves binary bytes that contain CRLF sequences (parser regression check)", async () => {
    // A buffer whose contents include \r\n\r\n — the previous custom
    // parser would have mis-split here. busboy handles it correctly.
    const tricky = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x0D, 0x0A, 0x0D, 0x0A,  // \r\n\r\n early
      0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x00,
      0x0D, 0x0A,  // another \r\n
      0xDE, 0xAD, 0xBE, 0xEF,
    ]);

    const taskRes = await fetch(`http://127.0.0.1:${port}/api/apps/${APP_ID}/entities/Task`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: "Tricky bytes", status: "todo" }),
    });
    const task = await taskRes.json();

    const { body, contentType } = buildMultipart("tricky.bin", "application/octet-stream", tricky);
    const uploadRes = await fetch(
      `http://127.0.0.1:${port}/api/apps/${APP_ID}/tasks/${task.id}/attachments`,
      {
        method: "POST",
        headers: { "Content-Type": contentType, Cookie: cookie },
        body,
      }
    );
    expect(uploadRes.status).toBe(201);
    const attachment = await uploadRes.json();
    expect(attachment.size_bytes).toBe(tricky.length);

    const getRes = await fetch(
      `http://127.0.0.1:${port}/api/apps/${APP_ID}/attachments/${attachment.id}`,
      { headers: { Cookie: cookie } }
    );
    const got = Buffer.from(await getRes.arrayBuffer());
    expect(got.length).toBe(tricky.length);
    expect(got.equals(tricky)).toBe(true);
  });

  it("returns 400 when the multipart body has no file field", async () => {
    const taskRes = await fetch(`http://127.0.0.1:${port}/api/apps/${APP_ID}/entities/Task`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: "No file", status: "todo" }),
    });
    const task = await taskRes.json();

    const boundary = `----NoFileBoundary`;
    const body = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="other"\r\n\r\n` +
      `not a file\r\n` +
      `--${boundary}--\r\n`
    );
    const res = await fetch(
      `http://127.0.0.1:${port}/api/apps/${APP_ID}/tasks/${task.id}/attachments`,
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          Cookie: cookie,
        },
        body,
      }
    );
    expect(res.status).toBe(400);
  });
});
