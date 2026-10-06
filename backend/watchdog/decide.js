// @ts-check
/**
 * @file The watchdog's judgement, kept pure: no network, no clock, no
 * Docker. Everything it decides is decided here, so every rule is tested.
 *
 * The one situation it acts on: Cloudflare itself says the tunnel isn't
 * connected (HTTP 530) while the app is healthy on the box. Getting that
 * answer at all proves the box is online, so "home internet is out" can
 * never look like this. Everything else — offline, the app itself down,
 * a deploy in progress, anything unclear — is watched and logged, never
 * acted on.
 *
 * Then, only while that stays true without a break:
 *   1. after `restartAfterMs`, restart the tunnel container;
 *   2. if still down `rebootAfterRestartMs` later, restart the box —
 *      at most once per `rebootGapMs`, never soon after boot, and never
 *      again if the last restart didn't bring the site back.
 */

/**
 * What one check found.
 *
 * @typedef {"ok" | "tunnel_down" | "app_down" | "offline" | "unclear"} Verdict
 *
 * @typedef {(
 *   { kind: "ok" } |
 *   { kind: "tunnel_error", detail?: string } |
 *   { kind: "http", status: number, detail?: string } |
 *   { kind: "unreachable", detail?: string }
 * )} SiteResult
 *
 * @typedef {{
 *   restartAfterMs: number,
 *   rebootAfterRestartMs: number,
 *   tunnelRetryMs: number,
 *   rebootGapMs: number,
 *   minUptimeMs: number,
 *   allowReboot: boolean,
 * }} Rules
 *
 * Times in an Incident are from a steady clock (never jumps), so a
 * changed wall clock can't shorten or lengthen a wait. `downSinceWall` is
 * the same moment as a date, for comparing with things Docker dates.
 * `noReboot` is a reason, found while this outage was going on, why the
 * box must not be restarted for it.
 *
 * @typedef {{
 *   downSince: number | null,
 *   downSinceWall: number | null,
 *   tunnelRestartedAt: number | null,
 *   rebootRequestedAt: number | null,
 *   noReboot: string | null,
 * }} Incident
 *
 * Kept on disk, because it has to survive the restart it describes.
 *
 * @typedef {{ lastRebootAt: string | null, recoveredSinceReboot: boolean }} Saved
 *
 * @typedef {{ action: "none" | "restart_tunnel" | "reboot", why: string }} Decision
 */

/** @type {Incident} */
export const NO_INCIDENT = Object.freeze({ downSince: null, downSinceWall: null, tunnelRestartedAt: null, rebootRequestedAt: null, noReboot: null });

/** @type {Saved} */
export const NEVER_REBOOTED = Object.freeze({ lastRebootAt: null, recoveredSinceReboot: true });

/**
 * @param {{ site: SiteResult, localApp: boolean | null, internet: boolean | null }} probes
 * @returns {Verdict}
 */
export function classify({ site, localApp, internet }) {
  if (site.kind === "ok") return "ok";
  if (site.kind === "tunnel_error") return localApp === true ? "tunnel_down" : "app_down";
  if (site.kind === "unreachable") return internet === false ? "offline" : "unclear";
  return "unclear";
}

/**
 * The incident after this check. Anything other than an unbroken run of
 * `tunnel_down` ends it, so one odd reading restarts the count.
 *
 * @param {Incident} incident
 * @param {Verdict} verdict
 * @param {number} nowMono
 * @param {number} nowWall
 * @returns {Incident}
 */
export function nextIncident(incident, verdict, nowMono, nowWall) {
  if (verdict !== "tunnel_down") return NO_INCIDENT;
  return incident.downSince == null ? { ...NO_INCIDENT, downSince: nowMono, downSinceWall: nowWall } : incident;
}

/** @param {number} ms */
function span(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 120) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hours`;
}

/**
 * Why the box may not be restarted right now, or null if it may.
 *
 * @param {{ saved: Saved, rules: Rules, nowWall: number, uptimeMs: number }} args
 * @returns {string | null}
 */
export function rebootBlock({ saved, rules, nowWall, uptimeMs }) {
  if (!rules.allowReboot) return "restarting the box is switched off";
  if (!(uptimeMs >= rules.minUptimeMs)) return `the box started less than ${span(rules.minUptimeMs)} ago`;
  if (saved.lastRebootAt == null) return null;

  const last = Date.parse(saved.lastRebootAt);
  if (Number.isNaN(last)) return "the record of the last restart can't be read";
  if (!saved.recoveredSinceReboot) return "the last restart didn't bring the site back, so another won't either";
  const gap = nowWall - last;
  if (gap < 0) return "the clock is earlier than the last restart";
  if (gap < rules.rebootGapMs) return `the box was already restarted ${span(gap)} ago`;
  return null;
}

/**
 * @param {{
 *   verdict: Verdict,
 *   incident: Incident,
 *   saved: Saved,
 *   rules: Rules,
 *   nowMono: number,
 *   nowWall: number,
 *   uptimeMs: number,
 * }} args
 * @returns {Decision}
 */
export function decide({ verdict, incident, saved, rules, nowMono, nowWall, uptimeMs }) {
  if (verdict !== "tunnel_down" || incident.downSince == null) return { action: "none", why: "" };
  if (incident.rebootRequestedAt != null) return { action: "none", why: "a restart of the box has already been requested" };

  const downFor = nowMono - incident.downSince;
  if (incident.tunnelRestartedAt == null) {
    if (downFor < rules.restartAfterMs) return { action: "none", why: "" };
    return {
      action: "restart_tunnel",
      why: `The site has been unreachable through the tunnel for ${span(downFor)} while the box is online and the app is healthy.`,
    };
  }

  const sinceRestart = nowMono - incident.tunnelRestartedAt;
  if (sinceRestart < rules.rebootAfterRestartMs) return { action: "none", why: "" };

  const blocked = incident.noReboot ?? rebootBlock({ saved, rules, nowWall, uptimeMs });
  if (!blocked) {
    return {
      action: "reboot",
      why: `Restarting the tunnel ${span(sinceRestart)} ago didn't help; the site has been down for ${span(downFor)}.`,
    };
  }
  // The box can't be restarted: keep nudging the tunnel, slowly.
  if (sinceRestart >= rules.tunnelRetryMs) {
    return { action: "restart_tunnel", why: `Still down after ${span(downFor)}, and the box won't be restarted because ${blocked}.` };
  }
  return { action: "none", why: `Not restarting the box: ${blocked}.` };
}
