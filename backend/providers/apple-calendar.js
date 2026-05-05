// @ts-check
/**
 * Apple iCloud Calendar provider via CalDAV.
 *
 * Why CalDAV?
 *   Apple does not expose OAuth for iCloud calendars. The supported way for a
 *   third-party app to sync is CalDAV (RFC 4791) with HTTP Basic auth using
 *   the user's Apple ID + an app-specific password generated at
 *   https://appleid.apple.com (account → "App-Specific Passwords").
 *   2FA on the Apple ID is required by Apple to even create one, so this is
 *   reasonably safe — the password we store can only access iCloud services
 *   over CalDAV/CardDAV/IMAP and nothing else, and the user can revoke it
 *   in one click without changing their actual Apple ID password.
 *
 * What we store:
 *   - external_account_email = the Apple ID (e.g. me@icloud.com)
 *   - refresh_token_enc      = the app-specific password (encrypted; reused
 *                              column to avoid a schema migration just for
 *                              "the secret we use to authenticate every call")
 *   - access_token_enc       = NULL (CalDAV uses Basic auth on every request)
 *   - primary_calendar_id    = the user's principal calendar HREF (path)
 *   - sync_token             = unused at integration level (per-calendar tokens
 *                              live on integration_calendars.sync_token)
 *
 * Protocol shape (all endpoints are HTTPS):
 *   1. PROPFIND on https://caldav.icloud.com/ with body asking for
 *      <D:current-user-principal/> → returns the principal URL.
 *   2. PROPFIND on the principal URL → returns the <C:calendar-home-set/>.
 *   3. PROPFIND Depth:1 on calendar-home-set → list of calendar collections,
 *      each with displayname, calendar-color, supported-calendar-component-set,
 *      current-user-privilege-set (for read/write detection), getctag.
 *   4. REPORT (sync-collection, RFC 6578) on a calendar → list of changed
 *      hrefs + a fresh sync-token. First call has no token → server returns
 *      every member; subsequent calls get only deltas.
 *   5. REPORT (calendar-multiget) to fetch calendar-data for a batch of
 *      hrefs in one round trip — far cheaper than per-href GETs.
 *   6. PUT/DELETE on individual event hrefs to write back. We send
 *      "If-Match: <etag>" on update and "If-None-Match: *" on create to
 *      avoid clobbering concurrent changes from the user's other devices.
 *
 * Apple-specific notes:
 *   - The first PROPFIND to caldav.icloud.com always 301s to a per-user
 *     host like p43-caldav.icloud.com. We follow redirects automatically by
 *     remembering the redirected origin per integration (config.host_root).
 *   - calendar-color comes back as an 8-digit hex (#FF2968FFFF) where the
 *     last two digits are alpha (or vice-versa depending on iOS version).
 *     We slice to the leading 6 hex chars after '#'.
 *   - Calendars not containing VEVENT (Reminders/VTODO calendars) are
 *     filtered out. iCloud serves those over CalDAV too, but Zephyrly only
 *     models events.
 *
 * Errors:
 *   - 401 on the initial probe → wrong app-specific password OR wrong Apple
 *     ID. We can't tell which; surface a generic "credentials rejected".
 *   - 403/507 → quota or family-sharing weirdness; surface as last_error.
 *   - 5xx → retry once; otherwise mark last_error and bail.
 *   - We never log the password and we never include it in error messages.
 */

import { randomUUID } from "node:crypto";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { buildVTimezone } from "./_vtimezones.js";
import { parseRruleValueToTaskRecurrence } from "../recurrence-rrule.js";

const ICLOUD_CALDAV_ROOT = "https://caldav.icloud.com";

// XML namespaces we participate in.
const NS = {
  D: "DAV:",
  C: "urn:ietf:params:xml:ns:caldav",
  A: "http://apple.com/ns/ical/",
  CS: "http://calendarserver.org/ns/",
};

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

/**
 * Perform an authenticated CalDAV request. Follows up to 5 redirects manually
 * (fetch's automatic redirect drops headers like Depth which CalDAV needs).
 * Throws an Error with .statusCode set so callers can branch on auth failures.
 *
 * @param {{ origin: string, email: string, password: string }} ctx
 * @param {string} method
 * @param {string} pathOrUrl — absolute URL or path under origin
 * @param {{ headers?: Record<string, string>, body?: string, allowStatuses?: number[] }} [opts]
 * @returns {Promise<{ status: number, headers: Headers, text: string, finalUrl: string }>}
 */
async function caldavRequest(ctx, method, pathOrUrl, opts = {}) {
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
      const err = new Error("Apple Calendar rejected the credentials. Check the Apple ID and app-specific password.");
      // @ts-expect-error
      err.statusCode = 401;
      throw err;
    }
    if (opts.allowStatuses?.includes(resp.status)) {
      return { status: resp.status, headers: resp.headers, text, finalUrl: target };
    }
    if (!resp.ok && resp.status !== 207 /* multistatus */ && resp.status !== 204) {
      const err = new Error(`Apple CalDAV ${method} ${redactPath(target)} failed (${resp.status}): ${truncate(text)}`);
      // @ts-expect-error
      err.statusCode = resp.status;
      throw err;
    }
    return { status: resp.status, headers: resp.headers, text, finalUrl: target };
  }
  const err = new Error(`Apple CalDAV ${method} too many redirects: ${redactPath(target)}`);
  // @ts-expect-error
  err.statusCode = lastResp?.status || 0;
  throw err;
}

function redactPath(url) {
  // Strip query & path past depth 4 so we don't dump per-event UIDs into logs.
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.split("/").slice(0, 5).join("/")}…`;
  } catch {
    return "[url]";
  }
}

function truncate(s) {
  return String(s || "").replace(/\s+/g, " ").slice(0, 300);
}

// ---------------------------------------------------------------------------
// Tiny XML helpers
// ---------------------------------------------------------------------------
//
// We avoid pulling in a full XML library. CalDAV responses are very regular:
// a <D:multistatus> envelope containing <D:response> children, each with one
// <D:href> and one or more <D:propstat>/<D:prop> blocks. The properties we
// care about are leaf values or single-token elements (no mixed content), so a
// few targeted regexes are enough — and fast.

/**
 * Iterate <D:response> blocks in a multistatus body. Yields raw inner text
 * for each.
 *
 * @param {string} xml
 * @returns {Array<{ raw: string }>}
 */
function splitResponses(xml) {
  const out = [];
  // Match either D:response or unprefixed response; some servers omit the prefix.
  const re = /<([a-zA-Z][\w:-]*?:)?response\b[^>]*>([\s\S]*?)<\/\1?response>/g;
  let m;
  while ((m = re.exec(xml))) out.push({ raw: m[2] });
  return out;
}

/**
 * Pull the first text node of <{prefix}localName> from `xml`. Returns "" if
 * the element is missing or empty. Strips CDATA wrappers.
 */
function pickText(xml, localName) {
  const re = new RegExp(`<(?:[a-zA-Z][\\w-]*:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z][\\w-]*:)?${localName}>`);
  const m = re.exec(xml);
  if (!m) return "";
  let inner = m[1];
  inner = inner.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // If the inner is itself an element (e.g. <D:href> inside current-user-principal),
  // return inner unchanged so the caller can call pickText again.
  return inner;
}

/** Pull href text from inside a property value (handles <D:href>…</D:href>). */
function pickHref(xml) {
  const re = /<(?:[a-zA-Z][\w-]*:)?href\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z][\w-]*:)?href>/;
  const m = re.exec(xml);
  return m ? decodeXmlEntities(m[1].trim()) : "";
}

function decodeXmlEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// Discovery: principal → calendar home → calendar list
// ---------------------------------------------------------------------------

/**
 * Verify the credentials and return the principal/home URLs + all writable+
 * VEVENT-supporting calendars. Used both at connect-time (to seed the row)
 * and on each call to refreshAppleCalendars.
 *
 * @param {{ email: string, password: string }} creds
 * @returns {Promise<{
 *   origin: string,
 *   principalUrl: string,
 *   calendarHomeUrl: string,
 *   calendars: Array<{
 *     url: string,
 *     id: string,
 *     summary: string,
 *     description: string,
 *     timeZone: string,
 *     colorHex: string,
 *     accessRole: 'owner'|'writer'|'reader',
 *     primary: boolean,
 *     getctag: string,
 *   }>,
 * }>}
 */
export async function discoverAppleCalendars({ email, password }) {
  // Stage 1: principal.
  const ctx = { origin: ICLOUD_CALDAV_ROOT, email, password };
  const principalBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="${NS.D}">
  <D:prop>
    <D:current-user-principal/>
    <D:principal-URL/>
  </D:prop>
</D:propfind>`;

  const principalResp = await caldavRequest(ctx, "PROPFIND", "/", {
    headers: { Depth: "0" },
    body: principalBody,
  });
  // Adopt whatever origin the server redirected us to (e.g. p43-caldav.icloud.com).
  const finalOrigin = new URL(principalResp.finalUrl).origin;
  ctx.origin = finalOrigin;

  const principalPath = (() => {
    const responses = splitResponses(principalResp.text);
    for (const r of responses) {
      const cup = pickText(r.raw, "current-user-principal");
      const href = pickHref(cup);
      if (href) return href;
    }
    return "";
  })();

  if (!principalPath) {
    throw new Error("Apple CalDAV did not return a current-user-principal — credentials may be wrong.");
  }

  const principalUrl = principalPath.startsWith("http")
    ? principalPath
    : `${finalOrigin}${principalPath}`;

  // Stage 2: calendar-home-set.
  const homeBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="${NS.D}" xmlns:C="${NS.C}">
  <D:prop>
    <C:calendar-home-set/>
  </D:prop>
</D:propfind>`;

  const homeResp = await caldavRequest(ctx, "PROPFIND", principalUrl, {
    headers: { Depth: "0" },
    body: homeBody,
  });
  const calendarHomeHref = (() => {
    const responses = splitResponses(homeResp.text);
    for (const r of responses) {
      const chs = pickText(r.raw, "calendar-home-set");
      const href = pickHref(chs);
      if (href) return href;
    }
    return "";
  })();
  if (!calendarHomeHref) {
    throw new Error("Apple CalDAV did not return a calendar-home-set.");
  }
  const calendarHomeUrl = calendarHomeHref.startsWith("http")
    ? calendarHomeHref
    : `${finalOrigin}${calendarHomeHref}`;

  // Stage 3: list calendars in the home (Depth: 1).
  const listBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="${NS.D}" xmlns:C="${NS.C}" xmlns:A="${NS.A}" xmlns:CS="${NS.CS}">
  <D:prop>
    <D:resourcetype/>
    <D:displayname/>
    <D:current-user-privilege-set/>
    <C:calendar-description/>
    <C:supported-calendar-component-set/>
    <C:calendar-timezone/>
    <A:calendar-color/>
    <CS:getctag/>
  </D:prop>
</D:propfind>`;

  const listResp = await caldavRequest(ctx, "PROPFIND", calendarHomeUrl, {
    headers: { Depth: "1" },
    body: listBody,
  });

  const calendars = [];
  const responses = splitResponses(listResp.text);
  for (const r of responses) {
    const href = pickHref(r.raw);
    if (!href) continue;
    // Only collections that declare resourcetype contains <calendar/>.
    if (!/<(?:[a-zA-Z][\w-]*:)?calendar\b/.test(pickText(r.raw, "resourcetype"))) continue;
    // Filter out VTODO-only calendars (Reminders) — we only model events.
    const components = pickText(r.raw, "supported-calendar-component-set");
    if (components && !/name="VEVENT"/i.test(components) && !/VEVENT/i.test(components)) continue;

    const summary = pickText(r.raw, "displayname").trim() || "(Untitled)";
    const description = pickText(r.raw, "calendar-description").trim();
    const timeZone = parseCalendarTz(pickText(r.raw, "calendar-timezone"));
    const colorHex = normalizeAppleColor(pickText(r.raw, "calendar-color").trim());
    const ctag = pickText(r.raw, "getctag").trim();

    // Privileges: if write-content is granted, we can create/modify events.
    const privileges = pickText(r.raw, "current-user-privilege-set");
    const writable = /<(?:[a-zA-Z][\w-]*:)?write-content\b/.test(privileges) ||
                     /<(?:[a-zA-Z][\w-]*:)?write\b/.test(privileges);
    const accessRole = /** @type {"reader" | "writer" | "owner"} */ (writable ? "writer" : "reader");

    const url = href.startsWith("http") ? href : `${finalOrigin}${href}`;
    calendars.push({
      url,
      id: url, // we use the absolute URL as the external_calendar_id
      summary,
      description,
      timeZone,
      colorHex,
      accessRole,
      primary: false, // iCloud doesn't expose a primary flag; we mark the
                     // first writable one as primary in the caller.
      getctag: ctag,
    });
  }

  // Heuristic: pick the calendar called "Calendar" or "Home" as primary,
  // else the first writable one.
  if (calendars.length) {
    const preferred =
      calendars.find((c) => /^calendar$/i.test(c.summary)) ||
      calendars.find((c) => /^home$/i.test(c.summary)) ||
      calendars.find((c) => c.accessRole === "writer") ||
      calendars[0];
    preferred.primary = true;
  }

  return {
    origin: finalOrigin,
    principalUrl,
    calendarHomeUrl,
    calendars,
  };
}

/** "#FF2968FFFF" → "#ff2968"; lowercased. Returns "" when unparsable. */
function normalizeAppleColor(raw) {
  if (!raw) return "";
  const m = /#([0-9a-fA-F]{6,8})/.exec(raw);
  if (!m) return "";
  return `#${m[1].slice(0, 6).toLowerCase()}`;
}

/** Pull TZID from a VTIMEZONE-wrapped calendar-timezone if present. */
function parseCalendarTz(s) {
  if (!s) return "";
  const m = /TZID:([^\r\n]+)/.exec(s);
  return m ? m[1].trim() : "";
}

// ---------------------------------------------------------------------------
// Sync: incremental change pull via sync-collection (RFC 6578)
// ---------------------------------------------------------------------------

/**
 * Pull events for one calendar. If `syncToken` is provided we use
 * sync-collection (deltas only); otherwise we use calendar-query bounded by
 * the same 30-back / 90-forward window that Google sync uses, to avoid
 * dumping years of history into the user's task list on first connect.
 *
 * @param {{ email: string, password: string, origin: string }} ctx
 * @param {string} calendarUrl — absolute URL of the calendar collection
 * @param {string | null | undefined} syncToken
 * @returns {Promise<{
 *   changes: Array<{ href: string, etag: string, ics: string, deleted: boolean }>,
 *   nextSyncToken: string | null,
 *   fullResync: boolean,
 * }>}
 */
export async function listEventsIncremental(ctx, calendarUrl, syncToken) {
  // ---- Path A: incremental ----
  if (syncToken) {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<D:sync-collection xmlns:D="${NS.D}" xmlns:C="${NS.C}">
  <D:sync-token>${escapeXml(syncToken)}</D:sync-token>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
</D:sync-collection>`;
    let resp;
    try {
      resp = await caldavRequest(ctx, "REPORT", calendarUrl, {
        headers: { Depth: "1" },
        body,
      });
    } catch (err) {
      // 410 Gone = sync token invalid. Fall through to a full resync.
      if (/** @type {any} */ (err).statusCode === 410) {
        return { changes: [], nextSyncToken: null, fullResync: true };
      }
      throw err;
    }

    const responses = splitResponses(resp.text);
    /** @type {Array<{ href: string, etag: string, ics: string, deleted: boolean }>} */
    const changes = [];
    for (const r of responses) {
      const href = pickHref(r.raw);
      if (!href) continue;
      // Each <D:response> has a <D:status> at the top level when the resource
      // was deleted. Otherwise the etag/calendar-data live in <D:propstat>.
      const topStatus = /<(?:[a-zA-Z][\w-]*:)?status\b[^>]*>HTTP\/[\d.]+\s+(\d+)/i.exec(r.raw);
      const isDeleted = topStatus && topStatus[1] === "404";
      const etag = pickText(r.raw, "getetag").replace(/^"|"$/g, "").trim();
      const ics = pickText(r.raw, "calendar-data").trim();
      changes.push({
        href: href.startsWith("http") ? href : `${ctx.origin}${href}`,
        etag,
        ics,
        deleted: !!isDeleted,
      });
    }
    const nextSyncToken = (() => {
      const re = /<(?:[a-zA-Z][\w-]*:)?sync-token\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z][\w-]*:)?sync-token>/i;
      const m = re.exec(resp.text);
      return m ? m[1].trim() : null;
    })();
    return { changes, nextSyncToken, fullResync: false };
  }

  // ---- Path B: initial query (windowed) ----
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const body = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="${NS.D}" xmlns:C="${NS.C}">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${toIcsDateTime(start)}" end="${toIcsDateTime(end)}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

  const resp = await caldavRequest(ctx, "REPORT", calendarUrl, {
    headers: { Depth: "1" },
    body,
  });
  const responses = splitResponses(resp.text);
  /** @type {Array<{ href: string, etag: string, ics: string, deleted: boolean }>} */
  const changes = [];
  for (const r of responses) {
    const href = pickHref(r.raw);
    if (!href) continue;
    const etag = pickText(r.raw, "getetag").replace(/^"|"$/g, "").trim();
    const ics = pickText(r.raw, "calendar-data").trim();
    if (!ics) continue;
    changes.push({
      href: href.startsWith("http") ? href : `${ctx.origin}${href}`,
      etag,
      ics,
      deleted: false,
    });
  }

  // Now ask for a fresh sync-token so subsequent calls are incremental.
  // We use an empty sync-token on a sync-collection REPORT — RFC 6578 says
  // an empty token means "give me current state and a fresh token", which
  // can be expensive on huge calendars but fine on personal accounts.
  let nextSyncToken = null;
  try {
    const initBody = `<?xml version="1.0" encoding="utf-8"?>
<D:sync-collection xmlns:D="${NS.D}" xmlns:C="${NS.C}">
  <D:sync-token/>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>`;
    const initResp = await caldavRequest(ctx, "REPORT", calendarUrl, {
      headers: { Depth: "1" },
      body: initBody,
    });
    const re = /<(?:[a-zA-Z][\w-]*:)?sync-token\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z][\w-]*:)?sync-token>/i;
    const m = re.exec(initResp.text);
    nextSyncToken = m ? m[1].trim() : null;
  } catch {
    // Server doesn't support sync-collection — we'll fall back to full
    // calendar-query every tick. iCloud does support it, so this is a
    // safety net rather than expected behavior.
  }

  return { changes, nextSyncToken, fullResync: false };
}

function toIcsDateTime(date) {
  // YYYYMMDDTHHmmssZ — UTC
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

// ---------------------------------------------------------------------------
// ICS parsing — a deliberately small subset
// ---------------------------------------------------------------------------
//
// We don't attempt full RFC 5545 compliance. We extract the fields Zephyrly's
// task model uses: SUMMARY, DESCRIPTION, DTSTART, DTEND, RRULE, UID, STATUS,
// LAST-MODIFIED. Multi-component VCALENDARs (e.g. one-off override instances
// of a recurring series) are simplified by taking the first VEVENT block.

/**
 * Parse a single VEVENT out of an ICS string.
 *
 * @param {string} ics
 * @returns {null | {
 *   uid: string,
 *   summary: string,
 *   description: string,
 *   dtstart: { value: string, isDate: boolean, tzid: string },
 *   dtend: { value: string, isDate: boolean, tzid: string } | null,
 *   rrule: string,
 *   status: string,
 *   recurrenceId: string,
 * }}
 */
export function parseVEvent(ics) {
  if (!ics) return null;
  // RFC 5545 line folding: any CRLF followed by a SPACE or TAB continues the
  // previous line. Unfold first, then split.
  const unfolded = String(ics).replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  let inEvent = false;
  /** @type {Record<string, { value: string, params: Record<string, string> }>} */
  const props = {};
  for (const line of lines) {
    if (!line) continue;
    if (line === "BEGIN:VEVENT") {
      if (inEvent) break; // first VEVENT only — skip overrides
      inEvent = true;
      continue;
    }
    if (line === "END:VEVENT") {
      if (inEvent) break;
      continue;
    }
    if (!inEvent) continue;

    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const semi = head.indexOf(";");
    const name = (semi === -1 ? head : head.slice(0, semi)).toUpperCase();
    /** @type {Record<string, string>} */
    const params = {};
    if (semi !== -1) {
      for (const part of head.slice(semi + 1).split(";")) {
        const eq = part.indexOf("=");
        if (eq === -1) continue;
        params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
      }
    }
    if (!props[name]) props[name] = { value, params };
  }
  if (!props.UID) return null;
  if (!props.DTSTART) return null;

  const parseDt = (p) => {
    const isDate = p.params.VALUE === "DATE" || /^\d{8}$/.test(p.value);
    return {
      value: p.value,
      isDate,
      tzid: p.params.TZID || "",
    };
  };

  return {
    uid: props.UID.value,
    summary: unescapeIcsText(props.SUMMARY?.value || ""),
    description: unescapeIcsText(props.DESCRIPTION?.value || ""),
    dtstart: parseDt(props.DTSTART),
    dtend: props.DTEND ? parseDt(props.DTEND) : null,
    rrule: props.RRULE?.value || "",
    status: (props.STATUS?.value || "").toUpperCase(),
    recurrenceId: props["RECURRENCE-ID"]?.value || "",
  };
}

function unescapeIcsText(s) {
  return String(s)
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function escapeIcsText(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Convert a parsed VEVENT into a Zephyrly Task input.
 *
 * @param {ReturnType<typeof parseVEvent>} ev
 * @param {any} calendarRow
 * @returns {any | null}
 */
export function mapVEventToTaskInput(ev, calendarRow) {
  if (!ev) return null;

  // Display zone — what wallclock should show up in Zephyrly.
  // Prefer the per-calendar tz (from VTIMEZONE in calendar-timezone PROPFIND),
  // fall back to UTC. Final fallback prevents a missing tz from crashing
  // formatInTimeZone.
  const displayTz = String(calendarRow?.time_zone || "UTC") || "UTC";

  let due_date = "";
  let task_time = "";
  let task_end_time = "";

  if (ev.dtstart.isDate) {
    // YYYYMMDD → YYYY-MM-DD
    const v = ev.dtstart.value;
    if (v.length !== 8) return null;
    due_date = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  } else {
    const startDt = parseIcsDateTime(ev.dtstart.value, ev.dtstart.tzid, displayTz);
    if (!startDt) return null;
    due_date = formatYmdInTz(startDt, displayTz);
    task_time = formatTaskTimeInTz(startDt, displayTz);
    if (ev.dtend) {
      const endDt = parseIcsDateTime(ev.dtend.value, ev.dtend.tzid, displayTz);
      if (endDt && formatYmdInTz(endDt, displayTz) === due_date) {
        task_end_time = formatTaskTimeInTz(endDt, displayTz);
      }
    }
  }

  // Apple iCloud personal calendars are the user's own — anything writable is
  // a "task"-equivalent. Read-only (subscribed/shared) calendars become "event".
  const writable = !calendarRow || calendarRow.access_role === "writer" || calendarRow.access_role === "owner";
  const sourceKind = writable ? "task" : "event";

  // Recurrence — same parser shape as Google's so the UI renders the violet dot.
  const recurrenceMapped = ev.rrule
    ? parseRruleValueToTaskRecurrence(ev.rrule, { dtstartYmd: due_date })
    : null;
  const taskType = recurrenceMapped?.recurrence ? "recurring" : "one_time";

  return {
    title: String(ev.summary || "(No title)").slice(0, 200),
    description: String(ev.description || "").slice(0, 5000),
    due_date,
    task_time,
    task_end_time,
    status: "todo",
    task_type: taskType,
    recurrence: recurrenceMapped?.recurrence || "none",
    recurrence_days: recurrenceMapped?.recurrence_days || [],
    recurrence_end_date: recurrenceMapped?.recurrence_end_date || "",
    source_provider: "apple",
    source_kind: sourceKind,
    source_calendar_id: calendarRow?.external_calendar_id || "",
    source_calendar_name: calendarRow?.summary || "",
    source_color_hex: calendarRow?.color_hex || "",
    source_writable: writable,
    source_recurrence_rule: ev.rrule ? `RRULE:${ev.rrule}` : "",
  };
}

/**
 * Parse a CalDAV/ICS DTSTART/DTEND value into a real UTC-anchored Date.
 *
 * Three cases per RFC 5545 §3.3.5:
 *   - "YYYYMMDDTHHmmssZ"               — already UTC
 *   - "YYYYMMDDTHHmmss" with TZID=…    — wallclock in that IANA zone
 *   - "YYYYMMDDTHHmmss" floating       — undefined zone; we interpret it as
 *                                        `fallbackTz` (the calendar's display
 *                                        zone), which matches how iCloud and
 *                                        most CalDAV servers render floating
 *                                        events to the user.
 *
 * date-fns-tz handles DST correctly using Node's bundled IANA tz database
 * (Intl), so a 2026-03-08T02:30 in America/New_York correctly resolves to
 * 06:30 UTC even though that wallclock technically doesn't exist (DST jump).
 *
 * @param {string} value
 * @param {string} tzid
 * @param {string} fallbackTz
 * @returns {Date | null}
 */
function parseIcsDateTime(value, tzid, fallbackTz) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) return null;
  const [, Y, M, D, h, mi, s, z] = m;
  if (z === "Z") {
    return new Date(Date.UTC(+Y, +M - 1, +D, +h, +mi, +s));
  }
  const zone = tzid || fallbackTz || "UTC";
  // fromZonedTime expects a "YYYY-MM-DDTHH:mm:ss" wallclock and a zone.
  const wall = `${Y}-${M}-${D}T${h}:${mi}:${s}`;
  try {
    return fromZonedTime(wall, zone);
  } catch {
    // Bad zone → fall back to floating-as-UTC so the event still imports.
    return new Date(Date.UTC(+Y, +M - 1, +D, +h, +mi, +s));
  }
}

function formatYmdInTz(date, tz) {
  try {
    return formatInTimeZone(date, tz || "UTC", "yyyy-MM-dd");
  } catch {
    return formatInTimeZone(date, "UTC", "yyyy-MM-dd");
  }
}

function formatTaskTimeInTz(date, tz) {
  // Zephyrly's task_time format is "H:MMAM|PM" with no leading zero on the
  // hour. date-fns format `h:mma` matches "1:00PM"; we lowercase-uppercase to
  // get "AM"/"PM" instead of "am"/"pm".
  try {
    return formatInTimeZone(date, tz || "UTC", "h:mmaaa")
      .replace("am", "AM")
      .replace("pm", "PM");
  } catch {
    return formatInTimeZone(date, "UTC", "h:mmaaa")
      .replace("am", "AM")
      .replace("pm", "PM");
  }
}

// ---------------------------------------------------------------------------
// Outbound: PUT/DELETE individual events
// ---------------------------------------------------------------------------

/**
 * Build a minimal VCALENDAR/VEVENT body. Used for both create and update.
 *
 * @param {{
 *   uid: string,
 *   summary: string,
 *   description?: string,
 *   start: { date?: string, dateTime?: string, tzid?: string },
 *   end?: { date?: string, dateTime?: string, tzid?: string },
 *   rrule?: string,
 *   color?: string,
 * }} ev
 */
export function buildVEvent(ev) {
  const now = new Date();
  const dtstamp = toIcsDateTime(now);
  const startLine = ev.start.date
    ? `DTSTART;VALUE=DATE:${ev.start.date.replace(/-/g, "")}`
    : ev.start.tzid
      ? `DTSTART;TZID=${ev.start.tzid}:${ev.start.dateTime}`
      : `DTSTART:${ev.start.dateTime}`;
  const endLine = ev.end
    ? ev.end.date
      ? `DTEND;VALUE=DATE:${ev.end.date.replace(/-/g, "")}`
      : ev.end.tzid
        ? `DTEND;TZID=${ev.end.tzid}:${ev.end.dateTime}`
        : `DTEND:${ev.end.dateTime}`
    : "";

  // Collect TZIDs referenced by this event so we can prepend matching
  // VTIMEZONE blocks before VEVENT. Servers that interpret TZID strictly
  // (Outlook/Exchange, some shared CalDAV servers) require this; iCloud
  // tolerates omissions, but it's never wrong to include them.
  const tzids = new Set();
  if (ev.start.tzid) tzids.add(ev.start.tzid);
  if (ev.end?.tzid) tzids.add(ev.end.tzid);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Zephyrly//Zephyrly 1.0//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const tzid of tzids) {
    const block = buildVTimezone(tzid);
    if (block) lines.push(...block);
    // If we don't have a hardcoded definition, fall through silently —
    // Apple will resolve the TZID by name. Future Outlook support should
    // reject events here instead.
  }
  lines.push(
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${dtstamp}`,
    startLine,
    endLine,
    `SUMMARY:${escapeIcsText(ev.summary || "")}`,
  );
  if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
  if (ev.rrule) lines.push(`RRULE:${ev.rrule.replace(/^RRULE:/i, "")}`);
  // RFC 7986 §5.9 — per-event color override. iOS/macOS Calendar honors
  // this for individual events; Apple Web (iCloud.com) is hit or miss.
  // Spec calls for a CSS3 color name, but every implementation we've
  // tested also accepts #RRGGBB hex, which preserves shade fidelity for
  // the deeper Tailwind variants.
  if (ev.color) lines.push(`COLOR:${ev.color}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  // Re-fold long lines at 75 octets per RFC 5545 §3.1.
  return lines.filter(Boolean).map(foldIcsLine).join("\r\n") + "\r\n";
}

function foldIcsLine(line) {
  if (line.length <= 75) return line;
  const chunks = [];
  let i = 0;
  while (i < line.length) {
    chunks.push((i === 0 ? "" : " ") + line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join("\r\n");
}

/**
 * Create or update an event at a known href.
 *
 * @param {{ email: string, password: string, origin: string }} ctx
 * @param {string} href — absolute URL of the event resource
 * @param {string} ics
 * @param {string} [etag] If-Match for safe updates
 * @returns {Promise<{ status: number, etag: string }>}
 */
export async function putEvent(ctx, href, ics, etag) {
  const headers = { "Content-Type": "text/calendar; charset=utf-8" };
  if (etag) headers["If-Match"] = etag;
  else headers["If-None-Match"] = "*";
  const resp = await caldavRequest(ctx, "PUT", href, { headers, body: ics, allowStatuses: [412] });
  // 412 = our If-Match lost the race, or If-None-Match found an existing UID.
  // Fall back to unconditional PUT so the user's edit lands.
  if (resp.status === 412) {
    const retry = await caldavRequest(ctx, "PUT", href, {
      headers: { "Content-Type": "text/calendar; charset=utf-8" },
      body: ics,
    });
    return { status: retry.status, etag: stripEtag(retry.headers.get("etag")) };
  }
  return { status: resp.status, etag: stripEtag(resp.headers.get("etag")) };
}

/**
 * Delete an event. Quiet on 404/410.
 *
 * @param {{ email: string, password: string, origin: string }} ctx
 * @param {string} href
 * @param {string} [etag]
 */
export async function deleteEvent(ctx, href, etag) {
  const headers = etag ? { "If-Match": etag } : {};
  try {
    await caldavRequest(ctx, "DELETE", href, { headers });
  } catch (err) {
    const s = /** @type {any} */ (err).statusCode;
    if (s === 404 || s === 410) return;
    if (s === 412) {
      // etag race — retry without If-Match.
      await caldavRequest(ctx, "DELETE", href, {});
      return;
    }
    throw err;
  }
}

function stripEtag(h) {
  if (!h) return "";
  return h.replace(/^W\//, "").replace(/^"|"$/g, "");
}

/**
 * PROPPATCH a calendar's color. iCloud uses Apple's namespaced
 * `apple-calendar-color` property. The value is an 8-digit hex
 * `#RRGGBBAA` — we accept a normal `#RRGGBB` and append `FF` for full
 * alpha (transparent calendars wouldn't be useful here).
 *
 * @param {{ email: string, password: string, origin: string }} ctx
 * @param {string} calendarUrl  the absolute CalDAV calendar URL
 * @param {string} hex          "#RRGGBB"
 */
export async function setCalendarColor(ctx, calendarUrl, hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    const err = /** @type {any} */ (new Error(`Invalid hex color: ${hex}`));
    err.statusCode = 400;
    throw err;
  }
  const value = `${hex}FF`; // RRGGBBAA — full alpha
  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:A="http://apple.com/ns/ical/">
  <D:set>
    <D:prop>
      <A:calendar-color>${value}</A:calendar-color>
    </D:prop>
  </D:set>
</D:propertyupdate>`;
  await caldavRequest(ctx, "PROPPATCH", calendarUrl, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
    body,
  });
}

/**
 * Build the absolute href where a new event should live: the calendar URL
 * with a `<UID>.ics` suffix. iCloud accepts arbitrary paths inside a
 * calendar collection, but using `<UID>.ics` is the universal convention.
 */
export function eventHrefForUid(calendarUrl, uid) {
  const base = calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`;
  return `${base}${encodeURIComponent(uid)}.ics`;
}

/** Generate a UID for a new Zephyrly-originated event. */
export function newEventUid() {
  return `zephyrly-${randomUUID()}@zephyrly`;
}
