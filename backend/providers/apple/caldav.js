// @ts-check
/**
 * @file CalDAV HTTP plumbing for the Apple iCloud provider.
 *
 *   - caldavRequest: authenticated request with manual redirect handling
 *     (fetch's auto-redirect strips headers like Depth that CalDAV needs).
 *   - ICLOUD_CALDAV_ROOT, NS: constants shared with the rest of apple/*.
 *   - redactPath, truncate: log-safe error message helpers.
 *   - stripEtag: ETag header normalization (used by event writers and any
 *     code that compares against the etag stored locally).
 *
 * Everything here is stateless — no module-level mutable state.
 */
import { HttpStatusError } from "../../lib/http-status-error.js";

export const ICLOUD_CALDAV_ROOT = "https://caldav.icloud.com";

// XML namespaces we participate in.
export const NS = {
  D: "DAV:",
  C: "urn:ietf:params:xml:ns:caldav",
  A: "http://apple.com/ns/ical/",
  CS: "http://calendarserver.org/ns/",
};

/**
 * Perform an authenticated CalDAV request. Follows up to 5 redirects manually
 * (fetch's automatic redirect drops headers like Depth which CalDAV needs).
 * Throws HttpStatusError so callers can branch on auth failures.
 *
 * @param {{ origin: string, email: string, password: string }} ctx
 * @param {string} method
 * @param {string} pathOrUrl — absolute URL or path under origin
 * @param {{ headers?: Record<string, string>, body?: string, allowStatuses?: number[] }} [opts]
 * @returns {Promise<{ status: number, headers: Headers, text: string, finalUrl: string }>}
 */
export async function caldavRequest(ctx, method, pathOrUrl, opts = {}) {
  let target = pathOrUrl.startsWith("http") ? pathOrUrl : `${ctx.origin}${pathOrUrl}`;
  let lastResp;
  for (let hop = 0; hop < 5; hop++) {
    const headers = {
      Authorization: `Basic ${Buffer.from(`${ctx.email}:${ctx.password}`).toString("base64")}`,
      "User-Agent": "Zephyrly-CalDAV/1.0",
      ...(opts.headers || {}),
    };
    if (opts.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/xml; charset=utf-8";
    }
    const resp = await fetch(target, {
      method,
      headers,
      body: opts.body,
      redirect: "manual",
    });
    lastResp = resp;
    // 301/302/307/308 → keep going
    if (resp.status === 301 || resp.status === 302 || resp.status === 307 || resp.status === 308) {
      const loc = resp.headers.get("location");
      if (!loc) break;
      target = loc.startsWith("http") ? loc : new URL(loc, target).toString();
      continue;
    }
    const text = await resp.text().catch(() => "");
    if (resp.status === 401) {
      throw new HttpStatusError("Apple Calendar rejected the credentials. Check the Apple ID and app-specific password.", 401);
    }
    if (opts.allowStatuses?.includes(resp.status)) {
      return { status: resp.status, headers: resp.headers, text, finalUrl: target };
    }
    if (!resp.ok && resp.status !== 207 /* multistatus */ && resp.status !== 204) {
      throw new HttpStatusError(`Apple CalDAV ${method} ${redactPath(target)} failed (${resp.status}): ${truncate(text)}`, resp.status);
    }
    return { status: resp.status, headers: resp.headers, text, finalUrl: target };
  }
  throw new HttpStatusError(`Apple CalDAV ${method} too many redirects: ${redactPath(target)}`, lastResp?.status || 0);
}

export function redactPath(url) {
  // Strip query & path past depth 4 so we don't dump per-event UIDs into logs.
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.split("/").slice(0, 5).join("/")}…`;
  } catch {
    return "[url]";
  }
}

export function truncate(s) {
  return String(s || "").replace(/\s+/g, " ").slice(0, 300);
}

export function stripEtag(h) {
  if (!h) return "";
  return h.replace(/^W\//, "").replace(/^"|"$/g, "");
}
