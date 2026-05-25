// @ts-check
/**
 * @file Per-calendar inbound sync via CalDAV. Two paths:
 *   - sync-collection REPORT (RFC 6578) when we have a token — gets deltas only
 *   - calendar-query REPORT bounded by a 30-back/90-forward window for the
 *     initial pull (before we have a token), to avoid dumping years of
 *     history into the user's task list on first connect
 */
import { NS, caldavRequest } from "./caldav.js";
import { splitResponses, pickText, pickHref, escapeXml } from "./xml.js";
import { toIcsDateTime } from "./ics.js";

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
