/* @vitest-environment node */
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { networkEvidence, probeInternet, probeLocal, probeSite } from "./probes.js";

/** @type {any} */
let server;
let base = "";

beforeAll(async () => {
  server = http.createServer((/** @type {any} */ req, /** @type {any} */ res) => {
    const send = (status, body, type = "text/plain") => {
      res.writeHead(status, { "Content-Type": type });
      res.end(body);
    };
    switch (req.url) {
      case "/health": return send(200, '{"ok":true,"app_id":"x"}', "application/json");
      case "/not-ok": return send(200, '{"ok":false}', "application/json");
      case "/portal": return send(200, "<html>Sign in to Wi-Fi</html>", "text/html");
      case "/tunnel-plain": return send(530, "error code: 1033");
      case "/tunnel-html": return send(530, `<html><style>.a{z-index:1000;width:1200px}</style><title>Cloudflare Tunnel error</title><span class="cf-error-code">1033</span></html>`, "text/html");
      case "/tunnel-json": return send(530, '{"title":"Error 1033: Cloudflare Tunnel error","status":530,"error_code":1033}', "application/json");
      case "/tunnel-bare": return send(530, "");
      case "/origin-dns": return send(530, "error code: 1016");
      case "/origin-dns-html": return send(530, `<html><style>.a{z-index:1000}</style><span class="cf-error-code">1016</span><p>Ray ID: 8f1033abc</p></html>`, "text/html");
      case "/origin-dns-json": return send(530, '{"status":530,"error_code":1016}', "application/json");
      case "/bad-gateway": return send(502, "Bad gateway");
      case "/huge": return send(200, "x".repeat(2_000_000));
      case "/hang": return undefined; // never answers
      default: return send(404, "no");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server.closeAllConnections?.();
  server.close();
});

describe("probeSite", () => {
  it("is ok only for the app's own health reply", async () => {
    expect(await probeSite(`${base}/health`)).toEqual({ kind: "ok" });
    expect((await probeSite(`${base}/not-ok`)).kind).toBe("http");
    // A captive portal or any other page answering 200 isn't the app.
    expect(await probeSite(`${base}/portal`)).toEqual({ kind: "http", status: 200, detail: "not the app's health reply" });
  });

  it("recognises Cloudflare's tunnel error in each form it comes in", async () => {
    for (const path of ["/tunnel-plain", "/tunnel-html", "/tunnel-json"]) {
      expect(await probeSite(`${base}${path}`), path).toEqual({ kind: "tunnel_error", detail: "Cloudflare error 1033" });
    }
    expect(await probeSite(`${base}/tunnel-bare`)).toEqual({ kind: "tunnel_error", detail: "HTTP 530" });
  });

  it("doesn't mistake another Cloudflare error, or a deploy, for the tunnel", async () => {
    expect(await probeSite(`${base}/origin-dns`)).toEqual({ kind: "http", status: 530, detail: "Cloudflare error 1016" });
    // Even when the page happens to contain "1033" somewhere (a ray id).
    expect(await probeSite(`${base}/origin-dns-html`)).toEqual({ kind: "http", status: 530, detail: "Cloudflare error 1016" });
    expect(await probeSite(`${base}/origin-dns-json`)).toEqual({ kind: "http", status: 530, detail: "Cloudflare error 1016" });
    expect(await probeSite(`${base}/bad-gateway`)).toEqual({ kind: "http", status: 502 });
  });

  it("gives up on a site that doesn't answer, and says why", async () => {
    const started = Date.now();
    expect(await probeSite(`${base}/hang`, { timeoutMs: 150 })).toEqual({ kind: "unreachable", detail: "TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(2000);
    // Nothing listening there at all.
    expect(await probeSite("http://127.0.0.1:1/health", { timeoutMs: 2000 })).toEqual({ kind: "unreachable", detail: "ECONNREFUSED" });
  });

  it("never reads more than a little of a huge reply", async () => {
    expect((await probeSite(`${base}/huge`)).kind).toBe("http");
  });
});

describe("probeLocal and probeInternet", () => {
  it("probeLocal is true only for a healthy app", async () => {
    expect(await probeLocal(`${base}/health`)).toBe(true);
    expect(await probeLocal(`${base}/bad-gateway`)).toBe(false);
    expect(await probeLocal(`${base}/portal`)).toBe(false);
    expect(await probeLocal("http://127.0.0.1:1/health", { timeoutMs: 500 })).toBe(false);
  });

  it("probeInternet is true if anything out there answers", async () => {
    expect(await probeInternet(["http://127.0.0.1:1/x", `${base}/bad-gateway`], { timeoutMs: 500 })).toBe(true);
    expect(await probeInternet(["http://127.0.0.1:1/x", `${base}/hang`], { timeoutMs: 150 })).toBe(false);
    expect(await probeInternet([], { timeoutMs: 150 })).toBe(false);
  });
});

describe("networkEvidence", () => {
  const files = {
    "/proc/net/route": [
      "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT",
      "eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0",
      "eth0\t0001A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0",
      "",
    ].join("\n"),
    "/proc/net/arp": [
      "IP address       HW type     Flags       HW address            Mask     Device",
      "192.168.1.1      0x1         0x2         aa:bb:cc:dd:ee:ff     *        eth0",
      "",
    ].join("\n"),
    "/sys/class/net/eth0/operstate": "up\n",
    "/sys/class/net/eth0/carrier": "1\n",
    "/sys/class/net/eth0/carrier_changes": "7\n",
    "/proc/sys/net/ipv4/ip_forward": "1\n",
    "/proc/sys/net/ipv4/conf/eth0/forwarding": "0\n",
  };
  const read = (overrides = {}) => (path) => ({ ...files, ...overrides })[path] ?? null;

  it("describes the route, the link, forwarding and whether the router answers", () => {
    expect(networkEvidence(read())).toEqual({
      route: "via 192.168.1.1 on eth0",
      link: "up, carrier 1, 7 link changes since boot",
      forwarding: "ip_forward 1, eth0 0",
      router: "answering",
    });
  });

  it("says so when there's no route or the router isn't answering", () => {
    expect(networkEvidence(read({ "/proc/net/route": "Iface\tDestination\tGateway\n" }))).toEqual({ route: "no default route" });
    expect(networkEvidence(() => null)).toEqual({ route: "no default route" });
    const silent = files["/proc/net/arp"].replace("0x2", "0x0");
    expect(networkEvidence(read({ "/proc/net/arp": silent })).router).toBe("not answering (flags 0x0)");
    expect(networkEvidence(read({ "/proc/net/arp": "IP address\n" })).router).toBe("not in the neighbour table");
  });
});
