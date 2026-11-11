// @ts-check
/**
 * @file Calls to other companies' servers (Google, iCloud), with a limit
 * on how long any one of them may take.
 *
 * A plain `fetch` has no time limit: a server that accepts the connection
 * and then says nothing holds the call open for minutes. Calendar sync runs
 * one account after another and changes go out through one queue, so a
 * single silent server used to hold up everyone's.
 *
 * A call that runs out of time, or never reaches the server, fails with an
 * HttpStatusError numbered like the gateway errors they are (504, 503), so
 * nothing mistakes them for "your sign-in was refused" (which would mark
 * the connection as needing a reconnect) and the outbox knows to try the
 * change again later.
 */
import { HttpStatusError } from "./http-status-error.js";

/**
 * How long one call to a calendar provider may take, start to finish.
 * Generous: reading a big calendar's window is the slowest honest call and
 * takes a few seconds. This is for the server that never answers.
 */
export const PROVIDER_TIMEOUT_MS = 30_000;

/**
 * `fetch`, limited to `timeoutMs` (reading the answer's body included).
 *
 * @param {string} who  who is being called, for the message ("Google Calendar")
 * @param {string | URL} url
 * @param {RequestInit} [init]
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(who, url, init = {}, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const limit = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, limit]) : limit;
  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    throw unreachable(who, error, timeoutMs);
  }
}

/**
 * Read an answer's body as text; a body that stops arriving counts as the
 * same failure as a call that never answered.
 *
 * @param {string} who
 * @param {Response} response
 * @param {number} [timeoutMs]
 */
export async function readText(who, response, timeoutMs = PROVIDER_TIMEOUT_MS) {
  try {
    return await response.text();
  } catch (error) {
    throw unreachable(who, error, timeoutMs);
  }
}

/**
 * @param {string} who
 * @param {Response} response
 * @param {number} [timeoutMs]
 * @returns {Promise<any>}
 */
export async function readJson(who, response, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const text = await readText(who, response, timeoutMs);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpStatusError(`${who} sent an answer that couldn't be read.`, 502);
  }
}

/**
 * @param {string} who
 * @param {unknown} error
 * @param {number} timeoutMs
 */
function unreachable(who, error, timeoutMs) {
  if (error instanceof HttpStatusError) return error;
  const name = /** @type {any} */ (error)?.name;
  const failure =
    name === "TimeoutError" || name === "AbortError"
      ? new HttpStatusError(`${who} didn't answer within ${Math.round(timeoutMs / 1000)} seconds.`, 504)
      : new HttpStatusError(`Couldn't reach ${who}.`, 503);
  // Told apart from a 503 the provider itself sent: asking again straight
  // away is pointless (and, for a timeout, another long wait in a queue
  // other people's changes are standing in). It is tried again later.
  /** @type {any} */ (failure).unreachable = true;
  return failure;
}
