// @ts-check
/**
 * @file POST /api/apps/:appId/client-errors — the app telling the server
 * that it broke in someone's browser (src/lib/report-error.js).
 *
 * There is no outside error service: the report becomes one line in the
 * server's log, which is where everything else about the box is read
 * (`docker compose logs taskflow | grep client-error`). Nothing is stored.
 *
 * Open to anyone, because the sign-in page can break too. So it trusts
 * nothing it is sent: a small body, short fields, one line each, a few
 * reports a minute per address, and it never says more than "noted".
 * Who was signed in is taken from the session, never from the body.
 */
import { readJsonBody, sendJson } from "../http.js";
import { getAuthorizedSession, getRequestIpAddress } from "../auth.js";
import { takeSlot } from "../ai/rate-limit.js";
import { log } from "../log.js";

/** Reports one address may send a minute. A page stuck in a loop stops being heard. */
export const REPORTS_PER_MINUTE = 10;
const MAX_BODY_BYTES = 8 * 1024;

/**
 * One line of plain text, cut to length: no newlines to forge a second
 * log line with, no control characters.
 * @param {unknown} value
 * @param {number} most
 */
export function oneLine(value, most) {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim().slice(0, most);
}

/**
 * The first few lines of a stack, as one line.
 * @param {unknown} value
 */
function shortStack(value) {
  if (typeof value !== "string") return "";
  return value
    .split("\n")
    .slice(0, 6)
    .map((line) => oneLine(line, 200))
    .filter(Boolean)
    .join(" | ")
    .slice(0, 1000);
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ config: any, db: any, segments: string[] }} ctx
 * @returns {Promise<boolean>}
 */
export async function handleClientErrorsRoute(request, response, { config, db, segments }) {
  if (segments[0] !== "api" || segments[1] !== "apps" || segments[3] !== "client-errors" || segments.length !== 4) return false;
  if (segments[2] !== config.appId) return false;
  if (request.method !== "POST") {
    sendJson(response, 405, { message: "Method not allowed.", code: "method_not_allowed" });
    return true;
  }
  const slot = takeSlot(`client-error:${getRequestIpAddress(request)}`, REPORTS_PER_MINUTE, 60_000);
  if (!slot.ok) {
    sendJson(response, 429, { message: "Too many reports.", code: "too_many_reports" });
    return true;
  }
  const body = /** @type {any} */ ((await readJsonBody(request, { maxBytes: MAX_BODY_BYTES })) || {});
  let who = "signed out";
  try {
    const user = getAuthorizedSession(db, config, request, config.appId)?.user;
    if (user?.id) who = `user ${user.id}`;
  } catch { /* signed out, or a bad cookie: still worth hearing about */ }

  const kind = ["render", "error", "promise", "chunk"].includes(body.kind) ? body.kind : "error";
  const message = oneLine(body.message, 300) || "(no message)";
  const page = oneLine(body.page, 120);
  const build = oneLine(body.build, 40);
  const stack = shortStack(body.stack);
  const agent = oneLine(request.headers["user-agent"], 160);
  log.warn(
    `[client-error] ${kind}: ${message}` +
      (page ? ` · page ${page}` : "") +
      ` · ${who}` +
      (build ? ` · build ${build}` : "") +
      (agent ? ` · ${agent}` : "") +
      (stack ? ` · ${stack}` : "")
  );
  sendJson(response, 202, { ok: true });
  return true;
}
