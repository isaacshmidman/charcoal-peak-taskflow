// @ts-check
/**
 * @file The tunnel watchdog: a small process that runs beside the app on
 * the home server and brings the site back when the Cloudflare tunnel
 * stays disconnected.
 *
 * Why it exists: on 2026-10-06 the box came back onto the network after a
 * drop, but the tunnel stayed disconnected for 45 minutes until someone
 * restarted the box by hand. This does those two steps itself — restart
 * the tunnel, then (only if that didn't help) restart the box — and
 * writes down what it saw so the cause can be read afterwards.
 *
 * The rules are in decide.js. This file is the plumbing: read settings,
 * check once a minute, remember what must survive a restart, act.
 *
 * Cost while the site is up: one small request a minute.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";
import { classify, decide, nextIncident, NEVER_REBOOTED, NO_INCIDENT } from "./decide.js";
import { CHECK_COMMAND, createDockerClient, REBOOT_COMMAND } from "./docker.js";
import { networkEvidence, probeInternet, probeLocal, probeSite } from "./probes.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const MAX_LOG_BYTES = 512 * 1024;

/**
 * @param {string | undefined} raw
 * @param {number} fallback
 * @param {number} min   never go below this, whatever is configured
 */
function atLeast(raw, fallback, min) {
  const value = Number(raw);
  return Math.max(min, Number.isFinite(value) && raw !== undefined && raw !== "" ? value : fallback);
}

/** @param {string | undefined} raw @param {boolean} fallback */
function flag(raw, fallback) {
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

/**
 * The address is built by joining the public URL and a path; a public URL
 * ending in "/" would otherwise ask for "//api/health", which isn't the
 * health check.
 *
 * @param {string} raw
 */
function tidyUrl(raw) {
  try {
    const url = new URL(raw);
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    return url.toString();
  } catch {
    return "";
  }
}

/**
 * Settings from the environment. Every wait has a floor, so a typo can
 * make the watchdog slower to act but never trigger-happy.
 *
 * @param {Record<string, string | undefined>} env
 */
export function readConfig(env) {
  return {
    siteUrl: tidyUrl(env.WATCHDOG_SITE_URL || ""),
    localUrl: env.WATCHDOG_LOCAL_URL || "http://127.0.0.1:8787/api/health",
    internetUrls: (env.WATCHDOG_INTERNET_URLS || "https://1.1.1.1/cdn-cgi/trace,https://www.google.com/generate_204")
      .split(",").map((url) => url.trim()).filter(Boolean),
    tunnelService: env.WATCHDOG_TUNNEL_SERVICE || "cloudflared",
    appService: env.WATCHDOG_APP_SERVICE || "taskflow",
    stateDir: env.WATCHDOG_STATE_DIR || "/state",
    dockerSocket: env.WATCHDOG_DOCKER_SOCKET || "/var/run/docker.sock",
    intervalMs: atLeast(env.WATCHDOG_INTERVAL_SECONDS, 60, 30) * 1000,
    dryRun: flag(env.WATCHDOG_DRY_RUN, false),
    /** @type {import("./decide.js").Rules} */
    rules: {
      restartAfterMs: atLeast(env.WATCHDOG_RESTART_TUNNEL_AFTER_MINUTES, 5, 3) * MINUTE,
      rebootAfterRestartMs: atLeast(env.WATCHDOG_RESTART_BOX_AFTER_MINUTES, 10, 5) * MINUTE,
      tunnelRetryMs: 30 * MINUTE,
      rebootGapMs: atLeast(env.WATCHDOG_BOX_RESTART_GAP_HOURS, 6, 6) * HOUR,
      minUptimeMs: 30 * MINUTE,
      // Off unless switched on: restarting the box is opt-in.
      allowReboot: flag(env.WATCHDOG_ALLOW_BOX_RESTART, false),
    },
  };
}

/**
 * The record that must outlive a restart of the box. A missing file means
 * a first run. A damaged one is treated as "restarted just now, and not
 * yet recovered": the most cautious reading, which holds off any restart
 * until the site has been seen up and the usual gap has passed.
 *
 * @param {string} dir
 * @param {() => number} now
 */
export function createStore(dir, now) {
  const file = `${dir}/state.json`;
  /** @returns {import("./decide.js").Saved} */
  const assumeJustRestarted = () => ({ lastRebootAt: new Date(now()).toISOString(), recoveredSinceReboot: false });
  return {
    /** @returns {import("./decide.js").Saved} */
    load() {
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch (error) {
        if (/** @type {any} */ (error)?.code === "ENOENT") return NEVER_REBOOTED;
        return assumeJustRestarted();
      }
      try {
        const parsed = JSON.parse(text);
        if (parsed.lastRebootAt == null) return NEVER_REBOOTED;
        if (typeof parsed.lastRebootAt !== "string" || Number.isNaN(Date.parse(parsed.lastRebootAt))) return assumeJustRestarted();
        return { lastRebootAt: parsed.lastRebootAt, recoveredSinceReboot: parsed.recoveredSinceReboot === true };
      } catch {
        return assumeJustRestarted();
      }
    },
    /** @param {import("./decide.js").Saved} saved @returns {boolean} whether it's safely on disk */
    save(saved) {
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(`${file}.tmp`, `${JSON.stringify(saved, null, 2)}\n`);
        renameSync(`${file}.tmp`, file);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Lines go to the container's output and to a file beside the state, so
 * the story of an incident survives the restart that ended it. Only
 * changes and actions are written — not a line a minute.
 *
 * @param {string} dir
 * @param {() => number} now
 */
export function createLog(dir, now) {
  const file = `${dir}/watchdog.log`;
  /** @param {string} message */
  return (message) => {
    const line = `${new Date(now()).toISOString()} ${message}`;
    console.log(line);
    try {
      mkdirSync(dir, { recursive: true });
      try {
        if (statSync(file).size > MAX_LOG_BYTES) renameSync(file, `${file}.1`);
      } catch {
        // No log yet.
      }
      appendFileSync(file, `${line}\n`);
    } catch {
      // The file is a convenience; the container's output still has it.
    }
  };
}

/** Container states that mean "a person stopped this", not "it crashed". */
const STOPPED_ON_PURPOSE = ["exited", "created", "paused"];

const VERDICT_TEXT = {
  ok: "The site is up.",
  tunnel_down: "Cloudflare reports the tunnel is disconnected, while the box is online and the app is healthy here.",
  app_down: "The tunnel is disconnected and the app isn't answering on the box either (normal for a minute at startup). Not acting.",
  offline: "The box can't reach the internet. Not acting — restarting wouldn't help if the home connection is down.",
  unclear: "The site isn't answering normally, but not in the way a disconnected tunnel looks. Not acting.",
};

/**
 * @typedef {{
 *   config: ReturnType<typeof readConfig>,
 *   probes: {
 *     site: () => Promise<import("./decide.js").SiteResult>,
 *     local: () => Promise<boolean>,
 *     internet: () => Promise<boolean>,
 *     evidence: () => Record<string, string>,
 *   },
 *   docker: Pick<ReturnType<typeof createDockerClient>, "findService" | "isHealthy" | "tailLogs" | "restart" | "runOnHost">,
 *   store: ReturnType<typeof createStore>,
 *   log: (message: string) => void,
 *   clock: { mono: () => number, wall: () => number, uptimeMs: () => number },
 *   host: { image: string, project: string } | null,
 * }} Deps
 */

/**
 * @param {Deps} deps
 */
export function createWatchdog({ config, probes, docker, store, log, clock, host }) {
  /** @type {import("./decide.js").Incident} */
  let incident = NO_INCIDENT;
  let saved = store.load();
  /** @type {import("./decide.js").Verdict | null} */
  let lastVerdict = null;
  let lastNote = "";
  let lastHeartbeat = clock.mono();
  // Without knowing our own image there's nothing to run the restart with.
  const rules = { ...config.rules, allowReboot: config.rules.allowReboot && host != null };

  /** @param {Record<string, string>} evidence */
  const summarize = (evidence) => Object.entries(evidence).map(([key, value]) => `${key}: ${value}`).join("; ");

  async function restartTunnel(/** @type {string} */ why) {
    /** @type {{ id: string, name: string, state: string } | null} */
    let tunnel = null;
    let problem = host ? `there's no single "${config.tunnelService}" container to restart` : "this watchdog couldn't identify itself through Docker";
    try {
      tunnel = host ? await docker.findService(host.project, config.tunnelService) : null;
    } catch (error) {
      problem = `Docker couldn't be asked for the tunnel container (${/** @type {Error} */ (error).message})`;
    }
    if (!tunnel) {
      // Nothing to restart, and so no reason to believe a restart of the
      // box would help either: stay at this step. Said once per incident.
      if (lastNote !== "no-tunnel") log(`${why} But ${problem}, so nothing was done.`);
      lastNote = "no-tunnel";
      return;
    }
    if (STOPPED_ON_PURPOSE.includes(tunnel.state)) {
      // Docker restarts a crashed tunnel by itself (restart: always), so a
      // stopped one was stopped by a person. Leave it — and since nothing
      // was tried, the box isn't restarted over it either.
      if (lastNote !== "tunnel-stopped") {
        log(`${why} But the tunnel container (${tunnel.name}) has been stopped, not crashed (state: ${tunnel.state}), so it's being left alone. To bring it back: docker compose start ${config.tunnelService}`);
      }
      lastNote = "tunnel-stopped";
      return;
    }
    log(`${why} Network: ${summarize(probes.evidence())}.`);
    try {
      const lines = await docker.tailLogs(tunnel.id, 15);
      log(`Tunnel (${tunnel.name}, ${tunnel.state}) last said:\n${lines.map((line) => `    ${line.slice(0, 300)}`).join("\n")}`);
    } catch (error) {
      log(`Couldn't read the tunnel's log: ${/** @type {Error} */ (error).message}`);
    }
    if (config.dryRun) {
      log(`DRY RUN: would restart the tunnel (${tunnel.name}) now.`);
    } else {
      try {
        await docker.restart(tunnel.id);
        log(`Restarted the tunnel (${tunnel.name}).`);
      } catch (error) {
        log(`Restarting the tunnel failed: ${/** @type {Error} */ (error).message}`);
      }
    }
    incident = { ...incident, tunnelRestartedAt: clock.mono() };
  }

  async function restartBox(/** @type {string} */ why) {
    incident = { ...incident, rebootRequestedAt: clock.mono() };
    log(`${why} Network: ${summarize(probes.evidence())}.`);
    if (config.dryRun) {
      log("DRY RUN: would restart the box now.");
      return;
    }
    // On disk first. If the restart can't be recorded it can't be
    // rate-limited, so it doesn't happen.
    const record = { lastRebootAt: new Date(clock.wall()).toISOString(), recoveredSinceReboot: false };
    if (!store.save(record)) {
      log("Not restarting the box: the restart couldn't be recorded on disk, so it couldn't be limited.");
      lastNote = "no-reboot";
      return;
    }
    saved = record;
    try {
      log("Restarting the box now (a normal, clean restart).");
      await docker.runOnHost(/** @type {NonNullable<Deps["host"]>} */ (host).image, REBOOT_COMMAND, { wait: false });
    } catch (error) {
      log(`Asking the box to restart failed: ${/** @type {Error} */ (error).message}. Nothing more will be tried for this outage.`);
      lastNote = "no-reboot";
    }
  }

  return {
    /** One check. Never throws. */
    async tick() {
      try {
        const site = await probes.site();
        let localApp = site.kind === "ok" ? null : await probes.local();
        // Not answering from the box isn't the same as down: if Docker's
        // networking is what broke, the app is fine inside its container
        // and simply can't be reached. Docker's own health check knows.
        let onlyInsideContainer = false;
        if (localApp === false && host) {
          try {
            onlyInsideContainer = await docker.isHealthy(host.project, config.appService);
          } catch {
            // Docker can't say; it stays "not answering".
          }
          if (onlyInsideContainer) localApp = true;
        }
        const internet = site.kind === "unreachable" ? await probes.internet() : null;
        const verdict = classify({ site, localApp, internet });
        incident = nextIncident(incident, verdict, clock.mono());

        if (verdict !== lastVerdict) {
          const detail = site.kind === "ok" ? "" : ` (${site.kind === "http" ? `HTTP ${site.status}` : site.kind}${"detail" in site && site.detail ? `, ${site.detail}` : ""})`;
          const network = verdict === "ok" ? "" : ` Network: ${summarize(probes.evidence())}.`;
          const inside = onlyInsideContainer ? " The app is healthy inside its container but doesn't answer from the box itself, which points at Docker's networking." : "";
          log(`${VERDICT_TEXT[verdict]}${detail}${inside}${network}`);
          lastVerdict = verdict;
          lastNote = "";
          lastHeartbeat = clock.mono();
        } else if (clock.mono() - lastHeartbeat >= 24 * HOUR) {
          log(`Still watching. ${VERDICT_TEXT[verdict]}`);
          lastHeartbeat = clock.mono();
        }

        if (verdict === "ok" && !saved.recoveredSinceReboot) {
          saved = { ...saved, recoveredSinceReboot: true };
          store.save(saved);
          log("The site came back after the last restart of the box.");
        }

        const decision = decide({ verdict, incident, saved, rules, nowMono: clock.mono(), nowWall: clock.wall(), uptimeMs: clock.uptimeMs() });
        if (decision.action === "restart_tunnel") await restartTunnel(decision.why);
        else if (decision.action === "reboot") await restartBox(decision.why);
        else if (incident.rebootRequestedAt != null && !config.dryRun) {
          // Normally never reached: the restart stops this process.
          if (clock.mono() - incident.rebootRequestedAt >= 5 * MINUTE && lastNote !== "no-reboot") {
            log("The box was asked to restart 5 minutes ago but is still running. Nothing more will be tried for this outage.");
            lastNote = "no-reboot";
          }
        } else if (decision.why && decision.why !== lastNote) {
          log(decision.why);
          lastNote = decision.why;
        }
      } catch (error) {
        log(`A check failed unexpectedly (ignored): ${/** @type {Error} */ (error)?.message ?? error}`);
      }
    },
    /** For tests. */
    state: () => ({ incident, saved, lastVerdict }),
  };
}

/** This container's id, from the mounts Docker gives every container. */
function ownContainerId() {
  try {
    return /\/containers\/([0-9a-f]{64})\//.exec(readFileSync("/proc/self/mountinfo", "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** @param {string} path */
function readOrNull(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** @param {string} dir @returns {string[]} */
function namesIn(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

async function main() {
  const config = readConfig(process.env);
  const clock = { mono: () => performance.now(), wall: () => Date.now(), uptimeMs: () => uptime() * 1000 };
  const log = createLog(config.stateDir, clock.wall);
  if (!config.siteUrl) {
    log("WATCHDOG_SITE_URL isn't set, so there's nothing to watch. Stopping.");
    process.exit(1);
  }

  const docker = createDockerClient({ socketPath: config.dockerSocket });
  /** @type {Deps["host"]} */
  let host = null;
  try {
    await docker.removeHelpers();
    host = await docker.self(ownContainerId());
  } catch (error) {
    log(`Couldn't reach Docker: ${/** @type {Error} */ (error).message}`);
  }

  const minutes = (/** @type {number} */ ms) => Math.round(ms / MINUTE);
  log(
    `Watchdog started${config.dryRun ? " in DRY RUN (it will only say what it would do)" : ""}. Checking ${config.siteUrl} every ${Math.round(config.intervalMs / 1000)}s. ` +
      `If Cloudflare reports the tunnel disconnected for ${minutes(config.rules.restartAfterMs)} minutes while the box is online: restart the tunnel. ` +
      (config.rules.allowReboot
        ? `If still down ${minutes(config.rules.rebootAfterRestartMs)} minutes later: restart the box, at most once every ${Math.round(config.rules.rebootGapMs / HOUR)} hours.`
        : "Restarting the box is switched off.")
  );

  if (!host) {
    log("Couldn't identify this container through Docker, so nothing can be restarted. It will still watch and log.");
  } else {
    try {
      const tunnel = await docker.findService(host.project, config.tunnelService);
      log(tunnel ? `Tunnel container: ${tunnel.name} (${tunnel.state}).` : `No single "${config.tunnelService}" container found in project "${host.project}".`);
    } catch (error) {
      log(`Couldn't look up the tunnel container: ${/** @type {Error} */ (error).message}`);
    }
    if (config.rules.allowReboot) {
      // Prove the last-resort path works now, harmlessly, rather than
      // finding out during an outage.
      try {
        const code = await docker.runOnHost(host.image, CHECK_COMMAND, { wait: true });
        if (code === 0) log("Self-check passed: the box can be restarted from here if it's ever needed. (Nothing was restarted.)");
        else {
          log(`Self-check failed (exit ${code}): the box can't be restarted from here, so that step is off.`);
          config.rules.allowReboot = false;
        }
      } catch (error) {
        log(`Self-check failed: ${/** @type {Error} */ (error).message}. Restarting the box is off.`);
        config.rules.allowReboot = false;
      }
    }
  }

  const watchdog = createWatchdog({
    config,
    probes: {
      site: () => probeSite(config.siteUrl),
      local: () => probeLocal(config.localUrl),
      internet: () => probeInternet(config.internetUrls),
      evidence: () => networkEvidence(readOrNull, namesIn),
    },
    docker,
    store: createStore(config.stateDir, clock.wall),
    log,
    clock,
    host,
  });

  // One check at a time, the next scheduled only when this one is done.
  const loop = async () => {
    await watchdog.tick();
    setTimeout(loop, config.intervalMs);
  };
  loop();
}

// As PID 1 in a container, Node ignores stop signals unless told
// otherwise — which would hold up every shutdown by ten seconds.
if (process.argv[1]?.endsWith("main.js")) {
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
  main();
}
