// @ts-check
/**
 * @file What the watchdog looks at. Small on purpose: while the site is
 * up, one tiny request a minute is all that happens. The other probes run
 * only when that one fails.
 */
import http from "node:http";
import https from "node:https";

const USER_AGENT = "zephyrly-watchdog/1";

/**
 * A GET with one overall deadline (covering DNS, connect, TLS and the
 * body) that keeps at most `maxBytes` of the reply.
 *
 * @param {string} url
 * @param {{ timeoutMs: number, maxBytes?: number }} options
 * @returns {Promise<{ status: number, body: string }>}
 */
export function httpGet(url, { timeoutMs, maxBytes = 2048 }) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let settled = false;
    /** @type {any} */
    let timer = null;
    /** @param {() => void} fn */
    const settle = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const request = client.get(
      url,
      // agent:false — a fresh connection every time, so a dead keep-alive
      // socket can never be mistaken for the site being down.
      { agent: false, headers: { "User-Agent": USER_AGENT, Accept: "application/json", "Cache-Control": "no-store" } },
      (/** @type {any} */ response) => {
        const finish = () =>
          settle(() => resolve({ status: Number(response.statusCode) || 0, body: Buffer.concat(chunks).toString("utf8") }));
        response.on("data", (/** @type {Buffer} */ chunk) => {
          if (size < maxBytes) chunks.push(chunk.subarray(0, maxBytes - size));
          size += chunk.length;
          if (size >= maxBytes) {
            finish();
            request.destroy();
          }
        });
        response.on("end", finish);
        response.on("error", (/** @type {Error} */ error) => settle(() => reject(error)));
      }
    );
    timer = setTimeout(() => {
      const error = /** @type {Error & { code?: string }} */ (new Error(`no answer within ${Math.round(timeoutMs / 1000)}s`));
      error.code = "TIMEOUT";
      settle(() => reject(error));
      request.destroy();
    }, timeoutMs);
    request.on("error", (/** @type {Error} */ error) => settle(() => reject(error)));
  });
}

/** @param {any} error */
function describeError(error) {
  // Node groups the per-address failures of one connection attempt.
  const inner = Array.isArray(error?.errors) && error.errors.length ? error.errors[0] : error;
  return String(inner?.code || inner?.message || error?.message || "failed");
}

/**
 * The public address, the way a visitor reaches it: through Cloudflare
 * and the tunnel. HTTP 530 is Cloudflare saying it has no connection from
 * the tunnel (error 1033).
 *
 * @param {string} url
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<import("./decide.js").SiteResult>}
 */
export async function probeSite(url, { timeoutMs = 10_000 } = {}) {
  try {
    const { status, body } = await httpGet(url, { timeoutMs, maxBytes: 16_384 });
    if (status === 200) {
      try {
        if (JSON.parse(body)?.ok === true) return { kind: "ok" };
      } catch {
        // Not the app's health reply; reported below.
      }
      return { kind: "http", status, detail: "not the app's health reply" };
    }
    if (status === 530) {
      // 530 carries a Cloudflare 1xxx code; 1033 is the tunnel. If the
      // reply clearly names a different one, it isn't the tunnel's problem.
      const code = /error(?:[\s_-]+code)?[">\s:]*(1\d{3})\b/i.exec(body)?.[1];
      if (code && code !== "1033") return { kind: "http", status, detail: `Cloudflare error ${code}` };
      return { kind: "tunnel_error", detail: code || body.includes("1033") ? "Cloudflare error 1033" : "HTTP 530" };
    }
    return { kind: "http", status };
  } catch (error) {
    return { kind: "unreachable", detail: describeError(error) };
  }
}

/**
 * The app answering on the box itself, no tunnel involved.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number }} [options]
 */
export async function probeLocal(url, { timeoutMs = 5_000 } = {}) {
  try {
    const { status, body } = await httpGet(url, { timeoutMs });
    return status === 200 && JSON.parse(body)?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Whether the box can reach the internet at all: true if any of the
 * addresses answers with anything.
 *
 * @param {string[]} urls
 * @param {{ timeoutMs?: number }} [options]
 */
export async function probeInternet(urls, { timeoutMs = 6_000 } = {}) {
  const results = await Promise.all(
    urls.map((url) =>
      httpGet(url, { timeoutMs, maxBytes: 64 }).then(
        () => true,
        () => false
      )
    )
  );
  return results.includes(true);
}

/**
 * A snapshot of the box's network, for the log — so that after an
 * incident the cause can be read instead of guessed. Plain file reads of
 * what the kernel already publishes; nothing is sent anywhere.
 *
 * @param {(path: string) => string | null} read  file contents, or null if unreadable
 * @param {(dir: string) => string[]} [list]  names in a directory
 * @returns {Record<string, string>}
 */
export function networkEvidence(read, list = () => []) {
  /** @type {Record<string, string>} */
  const evidence = {};
  /** @param {string} path */
  const value = (path) => (read(path) ?? "?").trim() || "?";

  // /proc/net/route: Iface Destination Gateway Flags … (hex, little-endian)
  const routes = (read("/proc/net/route") ?? "").split("\n").slice(1);
  const fallback = routes.map((line) => line.trim().split(/\s+/)).find((cols) => cols[1] === "00000000" && cols.length > 3);
  if (!fallback) {
    evidence.route = "no default route";
  } else {
    const [iface, , gatewayHex] = fallback;
    const gateway = (gatewayHex.match(/../g) ?? []).reverse().map((byte) => parseInt(byte, 16)).join(".");
    evidence.route = `via ${gateway} on ${iface}`;
    evidence.link = `${value(`/sys/class/net/${iface}/operstate`)}, carrier ${value(`/sys/class/net/${iface}/carrier`)}, ${value(`/sys/class/net/${iface}/carrier_changes`)} link changes since boot`;
    evidence.forwarding = `ip_forward ${value("/proc/sys/net/ipv4/ip_forward")}, ${iface} ${value(`/proc/sys/net/ipv4/conf/${iface}/forwarding`)}`;
    // /proc/net/arp: IP address, HW type, Flags (0x2 = answered), …
    const arp = (read("/proc/net/arp") ?? "").split("\n").map((line) => line.trim().split(/\s+/)).find((cols) => cols[0] === gateway);
    evidence.router = arp ? (arp[2] === "0x2" ? "answering" : `not answering (flags ${arp[2]})`) : "not in the neighbour table";
  }
  // The networks Docker gives the containers.
  const bridges = list("/sys/class/net").filter((name) => /^(docker\d+|br-[0-9a-f]+)$/.test(name)).sort();
  if (bridges.length) evidence.docker = bridges.map((name) => `${name} ${value(`/sys/class/net/${name}/operstate`)}`).join(", ");
  return evidence;
}
