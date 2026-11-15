// @ts-check
/**
 * @file How long the server takes to answer, kept in the log.
 *
 * Every answer is timed. Two things come of it:
 *
 *   [slow]     one line for each answer that took too long, at the time
 *   [timings]  once an hour, a few lines: how many requests, how fast half
 *              and 95% of them were, and the routes that took the most time
 *
 * The database is read in the same thread that answers, so one slow query
 * holds up everybody; the time measured here includes that wait, which is
 * the point of measuring it.
 *
 * Nothing about who asked or for what is kept: a route is written with its
 * ids taken out ("/api/apps/:app/entities/Task/:id"), with no query string.
 *
 * Read it on the server with:
 *   docker compose logs taskflow | grep -E "\[slow\]|\[timings\]"
 */
import { log as defaultLog } from "../log.js";

/** An answer slower than this is worth a line of its own. */
export const SLOW_MS = 500;
/** Sending or taking a file takes as long as the file and the connection do. */
const TRANSFER_ALLOWANCE = 10;
/** How often the summary is written. */
export const SUMMARY_EVERY_MS = 60 * 60 * 1000;
/** A storm of slow answers says so a few times, not thousands. */
const SLOW_LINES_PER_MINUTE = 20;
/** Times kept per route for working out "95% under": enough, and bounded. */
const SAMPLES_KEPT = 500;
/** Routes named in the summary. */
const ROUTES_SHOWN = 5;

/**
 * A request's route with everything particular to one person or one record
 * taken out.
 * @param {string} method
 * @param {string} pathname no query string
 */
export function routeName(method, pathname) {
  const verb = String(method || "GET").toUpperCase();
  const path = String(pathname || "/").split("?")[0];
  if (path === "/health" || path === "/api/health") return `${verb} /health`;
  if (path.startsWith("/.well-known/")) return `${verb} /.well-known`;
  // The app's own pages and files.
  if (!path.startsWith("/api")) return `${verb} (app files)`;
  const parts = path.split("/").filter(Boolean);
  const named = parts.map((part, index) => {
    if (index === 2 && parts[1] === "apps" && part !== "public") return ":app";
    // An id has a digit in it, or is long; the names of routes have neither.
    if (/\d/.test(part) || part.length > 30) return ":id";
    return part;
  });
  return `${verb} /${named.join("/")}`;
}

/** Routes whose time is mostly a file travelling. */
function isTransfer(route) {
  return /\(app files\)|\/attachments|\/files|\/export|\/restore/.test(route);
}

/**
 * The value that `share` of the sorted times fall under.
 * @param {number[]} sorted ascending
 * @param {number} share 0..1
 */
function under(sorted, share) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * share) - 1)];
}

/** @param {number} ms */
function shown(ms) {
  if (ms >= 10_000) return `${Math.round(ms / 1000)} s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.max(1, Math.round(ms))} ms`;
}

/**
 * @param {{
 *   slowMs?: number, summaryEveryMs?: number, now?: () => number,
 *   log?: { info: (...args: unknown[]) => void, warn: (...args: unknown[]) => void },
 * }} [how]
 */
export function createTimings(how = {}) {
  const slowMs = how.slowMs && how.slowMs > 0 ? how.slowMs : SLOW_MS;
  const summaryEveryMs = how.summaryEveryMs || SUMMARY_EVERY_MS;
  const now = how.now || Date.now;
  const out = how.log || defaultLog;

  /** @type {Map<string, { count: number, total: number, slowest: number, times: number[] }>} */
  let routes = new Map();
  let since = now();
  let count = 0;
  let slow = 0;
  let failed = 0;
  let slowLinesMinute = 0;
  let slowLinesWritten = 0;

  function reset() {
    routes = new Map();
    since = now();
    count = 0;
    slow = 0;
    failed = 0;
  }

  /** The lines of the summary for what has been seen since the last one. */
  function summary() {
    if (count === 0) return [];
    const minutes = Math.max(1, Math.round((now() - since) / 60_000));
    const all = [...routes.values()].flatMap((route) => route.times).sort((a, b) => a - b);
    const slowest = Math.max(...[...routes.values()].map((route) => route.slowest));
    const lines = [
      `[timings] last ${minutes} min: ${count} ${count === 1 ? "request" : "requests"} · half under ${shown(under(all, 0.5))} · 95% under ${shown(under(all, 0.95))} · slowest ${shown(slowest)} · ${slow} slow · ${failed} failed`,
    ];
    const busiest = [...routes.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, ROUTES_SHOWN);
    for (const [route, seen] of busiest) {
      const times = [...seen.times].sort((a, b) => a - b);
      lines.push(`[timings]   ${route} · ${seen.count}× · 95% under ${shown(under(times, 0.95))} · slowest ${shown(seen.slowest)}`);
    }
    return lines;
  }

  /** Write the summary and start counting afresh. */
  function flush() {
    for (const line of summary()) out.info(line);
    reset();
  }

  /**
   * @param {string} method
   * @param {string} pathname
   * @param {number} ms how long the answer took
   * @param {number} status the answer's status code
   */
  function record(method, pathname, ms, status) {
    // The hour is up: say how it went before counting this one in the next.
    if (now() - since >= summaryEveryMs) flush();

    const route = routeName(method, pathname);
    let seen = routes.get(route);
    if (!seen) {
      seen = { count: 0, total: 0, slowest: 0, times: [] };
      routes.set(route, seen);
    }
    seen.count += 1;
    seen.total += ms;
    if (ms > seen.slowest) seen.slowest = ms;
    // Past the cap a new time takes the place of one picked at random, so
    // what is kept stays a fair sample of the whole hour.
    if (seen.times.length < SAMPLES_KEPT) seen.times.push(ms);
    else {
      const at = Math.floor(Math.random() * seen.count);
      if (at < SAMPLES_KEPT) seen.times[at] = ms;
    }
    count += 1;
    if (status >= 500) failed += 1;

    if (ms >= slowMs * (isTransfer(route) ? TRANSFER_ALLOWANCE : 1)) {
      slow += 1;
      const minute = Math.floor(now() / 60_000);
      if (minute !== slowLinesMinute) {
        slowLinesMinute = minute;
        slowLinesWritten = 0;
      }
      slowLinesWritten += 1;
      if (slowLinesWritten <= SLOW_LINES_PER_MINUTE) out.warn(`[slow] ${shown(ms)} · ${route} · ${status}`);
      else if (slowLinesWritten === SLOW_LINES_PER_MINUTE + 1) out.warn("[slow] more slow answers this minute; the hourly [timings] lines count them all");
    }
  }

  /**
   * Time one request: call when it arrives.
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   */
  function watch(request, response) {
    const started = performance.now();
    response.once("close", () => {
      // Whoever asked went away before the answer was whole: nothing to learn.
      if (!(/** @type {any} */ (response).writableFinished)) return;
      try {
        record(request.method || "GET", String(request.url || "/").split("?")[0], performance.now() - started, response.statusCode);
      } catch {
        /* timing an answer must never be what breaks one */
      }
    });
  }

  return { watch, record, summary, flush };
}
