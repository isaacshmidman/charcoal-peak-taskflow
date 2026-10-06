/* @vitest-environment node */
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CHECK_COMMAND, createDockerClient, demuxLogs, HELPER_LABEL, REBOOT_COMMAND, WATCHDOG_LABEL } from "./docker.js";

/**
 * A stand-in Docker daemon on a unix socket, speaking just enough of the
 * Engine API to check what the watchdog sends it.
 */
const dir = mkdtempSync(join(tmpdir(), "wd-"));
const socketPath = join(dir, "d.sock");
/** @type {any} */
let daemon;
/** @type {Array<{ method: string, path: string, body: any }>} */
let calls = [];
/** @type {any[]} */
let containers = [];
let waitExitCode = 0;

const frame = (stream, text) => {
  const payload = Buffer.from(text, "utf8");
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
};

beforeAll(async () => {
  daemon = http.createServer((/** @type {any} */ req, /** @type {any} */ res) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const url = new URL(req.url, "http://docker");
      calls.push({ method: req.method, path: url.pathname, body: text ? JSON.parse(text) : null });
      const send = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(payload === undefined ? "" : Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
      };
      const id = /^\/containers\/([^/]+)/.exec(url.pathname)?.[1];

      if (req.method === "GET" && url.pathname === "/containers/json") {
        const wanted = JSON.parse(url.searchParams.get("filters") || "{}").label || [];
        return send(200, containers.filter((c) => wanted.every((label) => {
          const [key, value] = label.split("=");
          return c.Labels[key] === value;
        })));
      }
      if (req.method === "GET" && url.pathname.endsWith("/json")) {
        const found = containers.find((c) => c.Id === id);
        if (!found) return send(404, { message: `No such container: ${id}` });
        return send(200, {
          Image: found.ImageID,
          Config: { Labels: found.Labels },
          State: { Running: found.State === "running", ...(found.Health ? { Health: { Status: found.Health } } : {}) },
        });
      }
      if (req.method === "GET" && url.pathname.endsWith("/logs")) {
        return send(200, Buffer.concat([frame(2, "2026-10-06T00:01:00Z ERR Connection terminated error=\"timeout\"\n"), frame(2, "2026-10-06T00:01:05Z INF Retrying connection in up to 1m4s\n")]));
      }
      if (req.method === "POST" && url.pathname.endsWith("/restart")) return id === "broken" ? send(500, { message: "cannot restart container" }) : send(204);
      if (req.method === "POST" && url.pathname === "/containers/create") return send(201, { Id: "helper1" });
      if (req.method === "POST" && url.pathname.endsWith("/start")) return send(204);
      if (req.method === "POST" && url.pathname.endsWith("/wait")) return send(200, { StatusCode: waitExitCode });
      if (req.method === "DELETE") return send(204);
      return send(404, { message: "page not found" });
    });
  });
  await new Promise((resolve) => daemon.listen(socketPath, resolve));
});

afterAll(() => {
  daemon.close();
  rmSync(dir, { recursive: true, force: true });
});

const SELF_ID = "a".repeat(64);
beforeEach(() => {
  calls = [];
  waitExitCode = 0;
  containers = [
    { Id: SELF_ID, ImageID: "sha256:watchdogimage", State: "running", Names: ["/taskflow-watchdog-1"], Labels: { [WATCHDOG_LABEL]: "true", "com.docker.compose.project": "taskflow", "com.docker.compose.service": "watchdog" } },
    { Id: "tunnel1", State: "running", Names: ["/taskflow-cloudflared-1"], Labels: { "com.docker.compose.project": "taskflow", "com.docker.compose.service": "cloudflared" } },
    // Someone else's tunnel on the same box: must never be touched.
    { Id: "other-tunnel", State: "running", Names: ["/blog-cloudflared-1"], Labels: { "com.docker.compose.project": "blog", "com.docker.compose.service": "cloudflared" } },
    { Id: "app1", State: "running", Names: ["/taskflow-taskflow-1"], Labels: { "com.docker.compose.project": "taskflow", "com.docker.compose.service": "taskflow" } },
  ];
});

const docker = () => createDockerClient({ socketPath, timeoutMs: 3000 });

describe("docker client", () => {
  it("finds itself — by id, or by its label when the id isn't known", async () => {
    expect(await docker().self(SELF_ID)).toEqual({ image: "sha256:watchdogimage", project: "taskflow" });
    expect(await docker().self(null)).toEqual({ image: "sha256:watchdogimage", project: "taskflow" });
    expect(await docker().self("f".repeat(64))).toEqual({ image: "sha256:watchdogimage", project: "taskflow" });
    // Two watchdogs running: ambiguous, so it identifies as neither.
    containers.push({ ...containers[0], Id: "b".repeat(64) });
    expect(await docker().self(null)).toBeNull();
  });

  it("finds only this project's tunnel, and nothing if that's ambiguous or absent", async () => {
    expect(await docker().findService("taskflow", "cloudflared")).toEqual({ id: "tunnel1", name: "taskflow-cloudflared-1", state: "running" });
    containers.push({ ...containers[1], Id: "tunnel2" });
    expect(await docker().findService("taskflow", "cloudflared")).toBeNull();
    expect(await docker().findService("nope", "cloudflared")).toBeNull();
  });

  it("reports Docker's own health verdict for the app — healthy means running and passing its check", async () => {
    const app = containers.find((c) => c.Id === "app1");
    expect(await docker().isHealthy("taskflow", "taskflow"), "no health check at all").toBe(false);
    app.Health = "healthy";
    expect(await docker().isHealthy("taskflow", "taskflow")).toBe(true);
    for (const status of ["starting", "unhealthy"]) {
      app.Health = status;
      expect(await docker().isHealthy("taskflow", "taskflow"), status).toBe(false);
    }
    app.Health = "healthy";
    app.State = "exited";
    expect(await docker().isHealthy("taskflow", "taskflow"), "stopped, with a stale healthy").toBe(false);
    expect(await docker().isHealthy("taskflow", "nope")).toBe(false);
  });

  it("reads the tunnel's last log lines", async () => {
    expect(await docker().tailLogs("tunnel1", 15)).toEqual([
      '2026-10-06T00:01:00Z ERR Connection terminated error="timeout"',
      "2026-10-06T00:01:05Z INF Retrying connection in up to 1m4s",
    ]);
  });

  it("restarts a container, and reports Docker's own words when it can't", async () => {
    await docker().restart("tunnel1");
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/containers/tunnel1/restart" });
    await expect(docker().restart("broken")).rejects.toThrow("Docker POST /containers/broken/restart failed (500): cannot restart container");
  });

  it("runs the self-check on the host and cleans up after it", async () => {
    waitExitCode = 0;
    expect(await docker().runOnHost("sha256:watchdogimage", CHECK_COMMAND, { wait: true })).toBe(0);
    const create = calls.find((c) => c.path === "/containers/create");
    expect(create?.body).toEqual({
      Image: "sha256:watchdogimage",
      Entrypoint: ["nsenter"],
      Cmd: ["-t", "1", "-m", "-u", "-i", "-n", "--", "systemctl", "show", "--property=SystemState"],
      Labels: { [HELPER_LABEL]: "true" },
      HostConfig: { Privileged: true, PidMode: "host", NetworkMode: "none", AutoRemove: false },
    });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /containers/create",
      "POST /containers/helper1/start",
      "POST /containers/helper1/wait",
      "DELETE /containers/helper1",
    ]);
    waitExitCode = 1;
    expect(await docker().runOnHost("sha256:watchdogimage", CHECK_COMMAND, { wait: true })).toBe(1);
  });

  it("asks the host for a clean restart and doesn't wait for an answer", async () => {
    expect(await docker().runOnHost("sha256:watchdogimage", REBOOT_COMMAND, { wait: false })).toBeNull();
    const create = calls.find((c) => c.path === "/containers/create");
    expect(create?.body.Cmd.slice(-2)).toEqual(["systemctl", "reboot"]);
    expect(create?.body.HostConfig).toEqual({ Privileged: true, PidMode: "host", NetworkMode: "none", AutoRemove: true });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /containers/create", "POST /containers/helper1/start"]);
  });

  it("clears away helpers left from before", async () => {
    containers.push({ Id: "old-helper", State: "exited", Names: ["/x"], Labels: { [HELPER_LABEL]: "true" } });
    expect(await docker().removeHelpers()).toBe(1);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/containers/old-helper" });
  });

  it("fails clearly when Docker isn't there", async () => {
    await expect(createDockerClient({ socketPath: join(dir, "missing.sock"), timeoutMs: 500 }).findService("taskflow", "cloudflared")).rejects.toThrow();
  });
});

describe("demuxLogs", () => {
  it("handles Docker's framed format and plain TTY text", () => {
    expect(demuxLogs(Buffer.concat([frame(1, "out\n"), frame(2, "err\n")]))).toBe("out\nerr\n");
    expect(demuxLogs(Buffer.from("plain text line\n"))).toBe("plain text line\n");
    expect(demuxLogs(Buffer.alloc(0))).toBe("");
  });
});
