// @ts-check
/**
 * @file Apple iCloud calendar discovery: principal → calendar-home →
 * calendar list. Three PROPFIND round trips, run on both connect (to
 * verify credentials before persisting) and on every refresh.
 */
import { ICLOUD_CALDAV_ROOT, NS, caldavRequest } from "./caldav.js";
import { splitResponses, pickText, pickHref } from "./xml.js";

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
