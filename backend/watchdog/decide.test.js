/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { classify, decide, nextIncident, NEVER_REBOOTED, NO_INCIDENT, rebootBlock } from "./decide.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.parse("2026-10-06T00:30:00Z");

const rules = {
  restartAfterMs: 5 * MIN,
  rebootAfterRestartMs: 10 * MIN,
  tunnelRetryMs: 30 * MIN,
  rebootGapMs: 6 * HOUR,
  minUptimeMs: 30 * MIN,
  allowReboot: true,
};

/** decide() for a tunnel that has been down `downMin`, restarted `restartedMinAgo` ago (or not). */
const at = (downMin, restartedMinAgo = null, extra = {}) =>
  decide({
    verdict: "tunnel_down",
    incident: {
      ...NO_INCIDENT,
      downSince: 0,
      downSinceWall: NOW - downMin * MIN,
      tunnelRestartedAt: restartedMinAgo == null ? null : (downMin - restartedMinAgo) * MIN,
    },
    saved: NEVER_REBOOTED,
    rules,
    nowMono: downMin * MIN,
    nowWall: NOW,
    uptimeMs: 2 * 24 * HOUR,
    ...extra,
  });

describe("classify", () => {
  it("only calls it a tunnel problem when Cloudflare says so and the app is healthy on the box", () => {
    expect(classify({ site: { kind: "ok" }, localApp: null, internet: null })).toBe("ok");
    expect(classify({ site: { kind: "tunnel_error" }, localApp: true, internet: null })).toBe("tunnel_down");
    // Startup, or the app itself is broken: not the tunnel's fault.
    expect(classify({ site: { kind: "tunnel_error" }, localApp: false, internet: null })).toBe("app_down");
    expect(classify({ site: { kind: "tunnel_error" }, localApp: null, internet: null })).toBe("app_down");
    // A deploy swapping the app (502), an app error, a bot check.
    expect(classify({ site: { kind: "http", status: 502 }, localApp: false, internet: null })).toBe("unclear");
    expect(classify({ site: { kind: "http", status: 403 }, localApp: true, internet: null })).toBe("unclear");
    // Home internet out.
    expect(classify({ site: { kind: "unreachable" }, localApp: true, internet: false })).toBe("offline");
    // Can't reach the site but the internet works (DNS trouble, say).
    expect(classify({ site: { kind: "unreachable" }, localApp: true, internet: true })).toBe("unclear");
  });
});

describe("nextIncident", () => {
  it("starts on the first tunnel_down and ends on anything else", () => {
    const started = nextIncident(NO_INCIDENT, "tunnel_down", 1000, NOW);
    expect(started).toEqual({ downSince: 1000, downSinceWall: NOW, tunnelRestartedAt: null, rebootRequestedAt: null, noReboot: null });
    // It keeps its start, however long it goes on.
    expect(nextIncident(started, "tunnel_down", 99_000, NOW + 98_000)).toBe(started);
    for (const verdict of /** @type {const} */ (["ok", "offline", "app_down", "unclear"])) {
      expect(nextIncident({ ...started, tunnelRestartedAt: 5000, noReboot: "x" }, verdict, 99_000, NOW)).toBe(NO_INCIDENT);
    }
  });
});

describe("decide", () => {
  it("waits five minutes, restarts the tunnel, waits ten more, then restarts the box", () => {
    expect(at(0).action).toBe("none");
    expect(at(4.9).action).toBe("none");
    expect(at(5).action).toBe("restart_tunnel");
    // Tunnel restarted at minute 5.
    expect(at(6, 1).action).toBe("none");
    expect(at(14.9, 9.9).action).toBe("none");
    const reboot = at(15, 10);
    expect(reboot.action).toBe("reboot");
    expect(reboot.why).toBe("Restarting the tunnel 10 minutes ago didn't help; the site has been down for 15 minutes.");
  });

  it("does nothing for any state that isn't an unbroken tunnel outage, however long it lasts", () => {
    for (const verdict of /** @type {const} */ (["ok", "offline", "app_down", "unclear"])) {
      expect(decide({ verdict, incident: NO_INCIDENT, saved: NEVER_REBOOTED, rules, nowMono: 9 * HOUR, nowWall: NOW, uptimeMs: 9 * HOUR }))
        .toEqual({ action: "none", why: "" });
    }
  });

  it("never restarts the box when that's switched off; it nudges the tunnel every half hour instead", () => {
    const off = { rules: { ...rules, allowReboot: false } };
    expect(at(15, 10, off)).toEqual({ action: "none", why: "Not restarting the box: restarting the box is switched off." });
    expect(at(34, 29, off).action).toBe("none");
    const retry = at(35, 30, off);
    expect(retry.action).toBe("restart_tunnel");
    expect(retry.why).toContain("won't be restarted because restarting the box is switched off");
  });

  it("a reason found during the outage rules the box restart out for the rest of it", () => {
    const withReason = (downMin, restartedMinAgo) => {
      const base = at(downMin, restartedMinAgo);
      expect(base.action, "allowed without the reason").toBe(downMin - restartedMinAgo >= 5 && restartedMinAgo >= 10 ? "reboot" : base.action);
      return decide({
        verdict: "tunnel_down",
        incident: { ...NO_INCIDENT, downSince: 0, downSinceWall: NOW - downMin * MIN, tunnelRestartedAt: (downMin - restartedMinAgo) * MIN, noReboot: "someone is working on the tunnel" },
        saved: NEVER_REBOOTED,
        rules,
        nowMono: downMin * MIN,
        nowWall: NOW,
        uptimeMs: 2 * 24 * HOUR,
      });
    };
    expect(withReason(15, 10)).toEqual({ action: "none", why: "Not restarting the box: someone is working on the tunnel." });
    expect(withReason(200, 29).action).toBe("none");
    // The tunnel is still nudged every half hour.
    expect(withReason(200, 30).action).toBe("restart_tunnel");
  });

  it("asks for a restart of the box once, not every minute", () => {
    const decision = decide({
      verdict: "tunnel_down",
      incident: { ...NO_INCIDENT, downSince: 0, downSinceWall: NOW - 16 * MIN, tunnelRestartedAt: 5 * MIN, rebootRequestedAt: 15 * MIN },
      saved: NEVER_REBOOTED,
      rules,
      nowMono: 16 * MIN,
      nowWall: NOW,
      uptimeMs: 2 * 24 * HOUR,
    });
    expect(decision.action).toBe("none");
  });
});

describe("rebootBlock", () => {
  const base = { saved: NEVER_REBOOTED, rules, nowWall: NOW, uptimeMs: 2 * 24 * HOUR };
  const rebooted = (hoursAgo, recovered = true) => ({
    lastRebootAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
    recoveredSinceReboot: recovered,
  });

  it("allows a first restart on a box that has been up a while", () => {
    expect(rebootBlock(base)).toBeNull();
  });

  it("won't restart a box that only just started (no restart loops, whatever the clock says)", () => {
    expect(rebootBlock({ ...base, uptimeMs: 29 * MIN })).toBe("the box started less than 30 minutes ago");
    expect(rebootBlock({ ...base, uptimeMs: Number.NaN })).toBe("the box started less than 30 minutes ago");
  });

  it("keeps restarts at least six hours apart", () => {
    expect(rebootBlock({ ...base, saved: rebooted(2) })).toBe("the box was already restarted 2 hours ago");
    expect(rebootBlock({ ...base, saved: rebooted(5.9) })).toContain("already restarted");
    expect(rebootBlock({ ...base, saved: rebooted(6.1) })).toBeNull();
  });

  it("never restarts again if the last restart didn't bring the site back", () => {
    expect(rebootBlock({ ...base, saved: rebooted(72, false) })).toBe(
      "the last restart didn't bring the site back, so another won't either"
    );
  });

  it("holds off when the clock or the record can't be trusted", () => {
    expect(rebootBlock({ ...base, saved: rebooted(-3) })).toBe("the clock is earlier than the last restart");
    expect(rebootBlock({ ...base, saved: { lastRebootAt: "garbage", recoveredSinceReboot: true } })).toBe(
      "the record of the last restart can't be read"
    );
  });
});
