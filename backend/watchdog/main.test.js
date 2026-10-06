/* @vitest-environment node */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createLog, createStore, createWatchdog, readConfig } from "./main.js";
import { REBOOT_COMMAND } from "./docker.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const START = Date.parse("2026-10-06T00:14:00+01:00");
const scratch = mkdtempSync(join(tmpdir(), "wd-main-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A tunnel container that has been in place for days. */
const TUNNEL = { id: "tunnel1", name: "taskflow-cloudflared-1", state: "running", createdAt: START - 3 * 24 * HOUR };

const UP = { site: { kind: "ok" } };
const TUNNEL_DOWN = { site: { kind: "tunnel_error", detail: "Cloudflare error 1033" }, local: true };
const OFFLINE = { site: { kind: "unreachable", detail: "ENETUNREACH" }, local: true, internet: false };
const APP_DOWN = { site: { kind: "tunnel_error" }, local: false };
const DEPLOYING = { site: { kind: "http", status: 502 }, local: false };

/**
 * A watchdog wired to stand-ins, with a clock the test moves. `world` is
 * what the probes see; change it and call run(minutes).
 *
 * @param {any} [options]
 */
function setup({ env = {}, saved = null, host = { image: "sha256:img", project: "taskflow" }, saveWorks = true, tunnel = TUNNEL, restartFails = false, uptimeMs = 2 * 24 * HOUR, appHealthyInDocker = false } = {}) {
  let minute = 0;
  /** @type {any} */
  let world = UP;
  /** @type {string[]} */
  const log = [];
  /** @type {string[]} */
  const actions = [];
  /** @type {any} */
  let stored = saved;
  /** @type {any} what Docker says about the tunnel container right now */
  let tunnelNow = tunnel;
  const config = readConfig({ WATCHDOG_SITE_URL: "https://example.test/api/health", WATCHDOG_ALLOW_BOX_RESTART: "true", ...env });
  const watchdog = createWatchdog({
    config,
    probes: {
      site: async () => world.site,
      local: async () => world.local ?? false,
      internet: async () => world.internet ?? true,
      evidence: () => ({ route: "via 192.168.1.1 on eth0", forwarding: "ip_forward 1, eth0 1" }),
    },
    docker: {
      findService: async () => {
        if (tunnelNow instanceof Error) throw tunnelNow;
        return tunnelNow;
      },
      // Docker's own health check for the app, asked only when the app
      // doesn't answer from the box.
      isHealthy: async (project, service) => {
        expect([project, service]).toEqual(["taskflow", "taskflow"]);
        if (appHealthyInDocker instanceof Error) throw appHealthyInDocker;
        return appHealthyInDocker;
      },
      tailLogs: async () => ["ERR Connection terminated", "INF Retrying connection in up to 1m4s"],
      restart: async (id) => {
        actions.push(`${minute}: restart ${id}`);
        if (restartFails) throw new Error("Docker is not responding");
      },
      runOnHost: async (image, command) => {
        // The restart must already be on record when it's asked for.
        actions.push(`${minute}: host ${command.slice(-2).join(" ")} (recorded: ${stored?.lastRebootAt ?? "no"})`);
        expect(image).toBe("sha256:img");
        expect(command).toEqual(REBOOT_COMMAND);
        return null;
      },
    },
    store: {
      load: () => stored ?? { lastRebootAt: null, recoveredSinceReboot: true },
      save: (next) => {
        if (saveWorks) stored = next;
        return saveWorks;
      },
    },
    log: (message) => log.push(`${minute}: ${message}`),
    clock: { mono: () => minute * MIN, wall: () => START + minute * MIN, uptimeMs: () => uptimeMs + minute * MIN },
    host,
  });
  return {
    log,
    actions,
    watchdog,
    stored: () => stored,
    set: (next) => { world = next; },
    setTunnel: (next) => { tunnelNow = next; },
    /** Check once a minute for `minutes`, starting with a check right now. */
    async run(minutes) {
      for (let i = 0; i < minutes; i += 1) {
        await watchdog.tick();
        minute += 1;
      }
    },
  };
}

describe("the night of 6 October, replayed", () => {
  it("restarts the tunnel after 5 minutes and the box after 15 — where a person took 45", async () => {
    const t = setup();
    await t.run(3); // up
    t.set(TUNNEL_DOWN);
    await t.run(30);

    expect(t.actions).toEqual([
      "8: restart tunnel1",
      `18: host systemctl reboot (recorded: ${new Date(START + 18 * MIN).toISOString()})`,
    ]);
    expect(t.stored()).toEqual({ lastRebootAt: new Date(START + 18 * MIN).toISOString(), recoveredSinceReboot: false });
    // The story is in the log, including what the tunnel was saying.
    const story = t.log.join("\n");
    expect(story).toContain("3: Cloudflare reports the tunnel is disconnected, while the box is online and the app is healthy here. (tunnel_error, Cloudflare error 1033) Network: route: via 192.168.1.1 on eth0; forwarding: ip_forward 1, eth0 1.");
    expect(story).toContain("8: Tunnel (taskflow-cloudflared-1, running) last said:\n    ERR Connection terminated");
    expect(story).toContain("8: Restarted the tunnel (taskflow-cloudflared-1).");
    expect(story).toContain("18: Restarting the tunnel 10 minutes ago didn't help; the site has been down for 15 minutes.");
    expect(story).toContain("18: Restarting the box now (a normal, clean restart).");
  });

  it("stops at the tunnel restart when that fixes it", async () => {
    const t = setup();
    t.set(TUNNEL_DOWN);
    await t.run(7);
    t.set(UP);
    await t.run(60);
    expect(t.actions).toEqual(["5: restart tunnel1"]);
    expect(t.log.at(-1)).toBe("7: The site is up.");
    expect(t.stored()).toBeNull();
  });

  it("a restart of the box that worked is noted, and allows another one — but not for six hours", async () => {
    const rebootedAt = new Date(START - 20 * MIN).toISOString();
    const t = setup({ saved: { lastRebootAt: rebootedAt, recoveredSinceReboot: false }, uptimeMs: 19 * MIN });
    await t.run(2);
    expect(t.stored()).toEqual({ lastRebootAt: rebootedAt, recoveredSinceReboot: true });
    expect(t.log).toContain("0: The site came back after the last restart of the box.");

    // Down again two hours later: the tunnel is restarted, the box is not.
    t.set(TUNNEL_DOWN);
    await t.run(50);
    expect(t.actions).toEqual(["7: restart tunnel1", "37: restart tunnel1"]);
    expect(t.log.some((line) => /Not restarting the box: the box was already restarted \d+ minutes ago\./.test(line))).toBe(true);
  });

  it("never restarts the box twice for an outage a restart didn't fix", async () => {
    const t = setup({ saved: { lastRebootAt: new Date(START - 3 * 24 * HOUR).toISOString(), recoveredSinceReboot: false } });
    t.set(TUNNEL_DOWN);
    await t.run(120);
    expect(t.actions.filter((a) => a.includes("host"))).toEqual([]);
    expect(t.log.filter((line) => line.includes("the last restart didn't bring the site back")).length).toBeGreaterThan(0);
  });
});

describe("things it must leave alone", () => {
  for (const [name, world] of /** @type {Array<[string, any]>} */ ([
    ["the home internet being out", OFFLINE],
    ["the app itself being down", APP_DOWN],
    ["a deploy swapping the app", DEPLOYING],
  ])) {
    it(`${name}, for hours`, async () => {
      const t = setup();
      t.set(world);
      await t.run(300);
      expect(t.actions).toEqual([]);
      // Said once, not every minute.
      expect(t.log).toHaveLength(1);
    });
  }

  it("an outage that keeps being interrupted never adds up to five minutes", async () => {
    const t = setup();
    for (let i = 0; i < 20; i += 1) {
      t.set(TUNNEL_DOWN);
      await t.run(4);
      t.set(DEPLOYING);
      await t.run(1);
    }
    expect(t.actions).toEqual([]);
  });

  it("a box that has only just started", async () => {
    const t = setup({ uptimeMs: 2 * MIN });
    t.set(TUNNEL_DOWN);
    await t.run(27);
    expect(t.actions).toEqual(["5: restart tunnel1"]);
    await t.run(5); // now up 30+ minutes, still down
    expect(t.actions.at(-1)).toContain("host systemctl reboot");
  });
});

describe("when Docker's networking is what broke", () => {
  it("an app that's healthy inside its container but unreachable from the box still counts as healthy — and the log says what that points at", async () => {
    const t = setup({ appHealthyInDocker: true });
    t.set(APP_DOWN); // tunnel error, and no answer on the box's own port
    await t.run(20);
    expect(t.actions.map((a) => a.replace(/ \(recorded.*/, ""))).toEqual(["5: restart tunnel1", "15: host systemctl reboot"]);
    expect(t.log[0]).toContain("0: Cloudflare reports the tunnel is disconnected, while the box is online and the app is healthy here.");
    expect(t.log[0]).toContain("The app is healthy inside its container but doesn't answer from the box itself, which points at Docker's networking.");
  });

  it("if Docker can't say whether the app is healthy, it's treated as not answering — and nothing is done", async () => {
    const t = setup({ appHealthyInDocker: new Error("Docker didn't answer within 20s") });
    t.set(APP_DOWN);
    await t.run(60);
    expect(t.actions).toEqual([]);
  });
});

describe("a tunnel someone stopped on purpose", () => {
  for (const state of ["exited", "created", "paused"]) {
    it(`is left alone when it's "${state}" — not started again, and the box isn't restarted over it`, async () => {
      const t = setup({ tunnel: { ...TUNNEL, state } });
      t.set(TUNNEL_DOWN);
      await t.run(180);
      expect(t.actions).toEqual([]);
      const said = t.log.filter((line) => line.includes("has been stopped, not crashed"));
      expect(said).toHaveLength(1);
      expect(said[0]).toContain(`(state: ${state}), so it's being left alone. To bring it back: docker compose start cloudflared`);
    });
  }

  it("a tunnel that keeps crashing (Docker is already restarting it) is handled like a running one", async () => {
    const t = setup({ tunnel: { ...TUNNEL, state: "restarting" } });
    t.set(TUNNEL_DOWN);
    await t.run(20);
    expect(t.actions.map((a) => a.replace(/ \(recorded.*/, ""))).toEqual(["5: restart tunnel1", "15: host systemctl reboot"]);
  });
});

describe("a tunnel someone is working on", () => {
  // In these, the site goes down at minute 3.
  const outageWith = async (tunnel, minutes = 60) => {
    const t = setup({ tunnel });
    await t.run(3);
    t.set(TUNNEL_DOWN);
    await t.run(minutes);
    return t;
  };

  it("the box isn't restarted when the tunnel container was created just before the outage — it never worked", async () => {
    const t = await outageWith({ ...TUNNEL, createdAt: START + 2 * MIN });
    // The tunnel is restarted, and nudged again half an hour later; the box is left alone.
    expect(t.actions).toEqual(["8: restart tunnel1", "38: restart tunnel1"]);
    // Said once when decided, and again as the reason each time the tunnel is nudged.
    const said = t.log.filter((line) => line.includes("someone is working on it"));
    expect(said).toHaveLength(2);
    expect(said[0]).toBe("18: Not restarting the box: the tunnel container was created or replaced around the time this outage began, which means someone is working on it.");
    expect(said[1]).toContain("38: Still down after 35 minutes, and the box won't be restarted because the tunnel container was created or replaced around the time this outage began");
    expect(t.stored()).toBeNull();
  });

  it("nor when it was replaced during the outage", async () => {
    const t = setup();
    await t.run(3);
    t.set(TUNNEL_DOWN);
    await t.run(10); // tunnel restarted at minute 8
    t.setTunnel({ ...TUNNEL, id: "tunnel2", createdAt: START + 12 * MIN });
    await t.run(60);
    expect(t.actions.filter((a) => a.includes("host"))).toEqual([]);
    // The new container is the one nudged from then on, every half hour.
    expect(t.actions).toEqual(["8: restart tunnel1", "38: restart tunnel2", "68: restart tunnel2"]);
  });

  it("ten minutes in place before the outage is the line", async () => {
    // Outage begins at minute 3.
    const settled = await outageWith({ ...TUNNEL, createdAt: START + 3 * MIN - 10 * MIN }, 20);
    expect(settled.actions.at(-1)).toContain("18: host systemctl reboot");
    const tooNew = await outageWith({ ...TUNNEL, createdAt: START + 3 * MIN - 9 * MIN }, 20);
    expect(tooNew.actions).toEqual(["8: restart tunnel1"]);
  });

  it("nor when its age can't be read, it has been stopped since, it's gone, or Docker can't say", async () => {
    /** @type {Array<[any, string]>} */
    const cases = [
      [{ ...TUNNEL, createdAt: Number.NaN }, "created or replaced around the time"],
      [{ ...TUNNEL, state: "exited" }, "the tunnel container has since been stopped"],
      [null, 'there\'s no longer a single "cloudflared" container'],
      [new Error("Docker didn't answer within 20s"), "Docker couldn't be asked about the tunnel container (Docker didn't answer within 20s)"],
    ];
    for (const [later, reason] of cases) {
      const t = setup();
      t.set(TUNNEL_DOWN);
      await t.run(10); // tunnel restarted at minute 5, normally
      t.setTunnel(later);
      await t.run(20);
      expect(t.actions, reason).toEqual(["5: restart tunnel1"]);
      expect(t.log.filter((line) => line.startsWith("15: Not restarting the box:") && line.includes(reason)), reason).toHaveLength(1);
      expect(t.stored(), reason).toBeNull();
    }
  });
});

describe("failing safe", () => {
  it("dry run says what it would do and does none of it", async () => {
    const t = setup({ env: { WATCHDOG_DRY_RUN: "true" } });
    t.set(TUNNEL_DOWN);
    await t.run(40);
    expect(t.actions).toEqual([]);
    expect(t.stored()).toBeNull();
    expect(t.log.filter((line) => line.includes("DRY RUN"))).toEqual([
      "5: DRY RUN: would restart the tunnel (taskflow-cloudflared-1) now.",
      "15: DRY RUN: would restart the box now.",
    ]);
  });

  it("restarting the box is off unless switched on", async () => {
    const t = setup({ env: { WATCHDOG_ALLOW_BOX_RESTART: "" } });
    t.set(TUNNEL_DOWN);
    await t.run(60);
    expect(t.actions.every((a) => a.includes("restart tunnel1"))).toBe(true);
    expect(t.actions.length).toBe(2);
  });

  it("won't restart the box if it can't record that it did", async () => {
    const t = setup({ saveWorks: false });
    t.set(TUNNEL_DOWN);
    await t.run(40);
    expect(t.actions).toEqual(["5: restart tunnel1"]);
    expect(t.log).toContain("15: Not restarting the box: the restart couldn't be recorded on disk, so it couldn't be limited.");
    // And it doesn't then claim a restart was asked for.
    expect(t.log.some((line) => line.includes("still running"))).toBe(false);
  });

  it("with no tunnel container to restart, it does nothing at all — and says so once", async () => {
    const t = setup({ tunnel: null });
    t.set(TUNNEL_DOWN);
    await t.run(90);
    expect(t.actions).toEqual([]);
    expect(t.log.filter((line) => line.includes("so nothing was done"))).toHaveLength(1);
  });

  it("when it can't identify itself through Docker, it only watches", async () => {
    const t = setup({ host: null });
    t.set(TUNNEL_DOWN);
    await t.run(90);
    expect(t.actions).toEqual([]);
    expect(t.log.some((line) => line.includes("couldn't identify itself through Docker"))).toBe(true);
  });

  it("if Docker can't restart the tunnel, the box is still restarted after the wait", async () => {
    const t = setup({ restartFails: true });
    t.set(TUNNEL_DOWN);
    await t.run(20);
    expect(t.actions.map((a) => a.replace(/ \(recorded.*/, ""))).toEqual(["5: restart tunnel1", "15: host systemctl reboot"]);
    expect(t.log).toContain("5: Restarting the tunnel failed: Docker is not responding");
  });

  it("says so if the box was asked to restart but didn't", async () => {
    const t = setup();
    t.set(TUNNEL_DOWN);
    await t.run(60);
    expect(t.actions.filter((a) => a.includes("host"))).toHaveLength(1);
    expect(t.log.filter((line) => line.includes("still running"))).toEqual([
      "20: The box was asked to restart 5 minutes ago but is still running. Nothing more will be tried for this outage.",
    ]);
  });

  it("a check that blows up is logged and the next one still runs", async () => {
    const t = setup();
    let calls = 0;
    t.set({ get site() { calls += 1; if (calls === 1) throw new Error("boom"); return { kind: "ok" }; } });
    await t.run(2);
    expect(t.log).toEqual(["0: A check failed unexpectedly (ignored): boom", "1: The site is up."]);
  });
});

describe("readConfig", () => {
  it("has cautious defaults, with restarting the box off", () => {
    const config = readConfig({ WATCHDOG_SITE_URL: "https://x.test/health" });
    expect(config.intervalMs).toBe(60_000);
    expect(config.dryRun).toBe(false);
    expect(config.rules).toEqual({
      restartAfterMs: 5 * MIN,
      rebootAfterRestartMs: 10 * MIN,
      tunnelRetryMs: 30 * MIN,
      rebootGapMs: 6 * HOUR,
      minUptimeMs: 30 * MIN,
      allowReboot: false,
    });
  });

  it("tidies the address, and treats nonsense as nothing to watch", () => {
    expect(readConfig({ WATCHDOG_SITE_URL: "https://zephyrly.app//api/health" }).siteUrl).toBe("https://zephyrly.app/api/health");
    expect(readConfig({ WATCHDOG_SITE_URL: "/api/health" }).siteUrl).toBe("");
    expect(readConfig({}).siteUrl).toBe("");
  });

  it("can be made slower, never trigger-happy", () => {
    const config = readConfig({
      WATCHDOG_INTERVAL_SECONDS: "1",
      WATCHDOG_RESTART_TUNNEL_AFTER_MINUTES: "0",
      WATCHDOG_RESTART_BOX_AFTER_MINUTES: "-5",
      WATCHDOG_BOX_RESTART_GAP_HOURS: "0.1",
    });
    expect(config.intervalMs).toBe(30_000);
    expect(config.rules.restartAfterMs).toBe(3 * MIN);
    expect(config.rules.rebootAfterRestartMs).toBe(5 * MIN);
    expect(config.rules.rebootGapMs).toBe(6 * HOUR);
    const slower = readConfig({ WATCHDOG_RESTART_TUNNEL_AFTER_MINUTES: "20", WATCHDOG_BOX_RESTART_GAP_HOURS: "48", WATCHDOG_INTERVAL_SECONDS: "nonsense" });
    expect(slower.rules.restartAfterMs).toBe(20 * MIN);
    expect(slower.rules.rebootGapMs).toBe(48 * HOUR);
    expect(slower.intervalMs).toBe(60_000);
  });
});

describe("createStore", () => {
  const now = () => START;
  it("starts clean, and keeps what it's given", () => {
    const dir = join(scratch, "fresh");
    const store = createStore(dir, now);
    expect(store.load()).toEqual({ lastRebootAt: null, recoveredSinceReboot: true });
    expect(store.save({ lastRebootAt: "2026-10-06T00:00:00.000Z", recoveredSinceReboot: false })).toBe(true);
    expect(createStore(dir, now).load()).toEqual({ lastRebootAt: "2026-10-06T00:00:00.000Z", recoveredSinceReboot: false });
  });

  it("reads a damaged record as 'restarted just now, not yet recovered' — the reading that blocks a restart", () => {
    const dir = join(scratch, "damaged");
    const store = createStore(dir, now);
    store.save({ lastRebootAt: null, recoveredSinceReboot: true });
    for (const junk of ["{not json", '{"lastRebootAt": 12345}', '{"lastRebootAt": "yesterday-ish"}']) {
      writeFileSync(join(dir, "state.json"), junk);
      expect(store.load(), junk).toEqual({ lastRebootAt: new Date(START).toISOString(), recoveredSinceReboot: false });
    }
  });

  it("reports when it can't write", () => {
    writeFileSync(join(scratch, "a-file"), "x");
    expect(createStore(join(scratch, "a-file", "sub"), now).save({ lastRebootAt: null, recoveredSinceReboot: true })).toBe(false);
  });
});

describe("createLog", () => {
  it("writes timestamped lines to a file, and starts a new file when it gets big", () => {
    const dir = join(scratch, "log");
    const log = createLog(dir, () => START);
    log("first");
    expect(readFileSync(join(dir, "watchdog.log"), "utf8")).toBe("2026-10-05T23:14:00.000Z first\n");
    writeFileSync(join(dir, "watchdog.log"), "x".repeat(600 * 1024));
    log("second");
    expect(readFileSync(join(dir, "watchdog.log"), "utf8")).toBe("2026-10-05T23:14:00.000Z second\n");
    expect(readFileSync(join(dir, "watchdog.log.1"), "utf8")).toHaveLength(600 * 1024);
  });
});
