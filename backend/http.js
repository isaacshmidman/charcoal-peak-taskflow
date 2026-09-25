// @ts-check
import { URL } from "node:url";
import { log } from "./log.js";
import { MAX_JSON_BODY_BYTES } from "./limits.js";

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {string} [code]
   * @param {Record<string, unknown>} [extra]
   */
  constructor(status, message, code = "request_failed", extra = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/**
 * Read and parse a JSON request body, refusing anything over `maxBytes`.
 *
 * Without a cap the whole body was buffered before anything looked at it —
 * and /auth/login reads its body before anyone is signed in, so a single
 * anonymous request could make the server hold an arbitrarily large upload
 * in memory. A declared Content-Length over the cap is refused before
 * reading; a body that grows past it mid-stream stops being buffered at
 * once (sendError then closes the connection, so the rest is never read).
 *
 * @param {import("node:http").IncomingMessage} request
 * @param {{ maxBytes?: number }} [options]
 * @returns {Promise<any>}
 */
export function readJsonBody(request, { maxBytes = MAX_JSON_BODY_BYTES } = {}) {
  const tooLarge = () =>
    new HttpError(413, `Request body is larger than ${maxBytes} bytes.`, "payload_too_large");

  const declared = Number(request.headers?.["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return Promise.reject(tooLarge());
  }

  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let settled = false;

    const cleanup = () => {
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };

    /** @param {Buffer | string} chunk */
    function onData(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        chunks.length = 0;
        settle(reject, tooLarge());
        return;
      }
      chunks.push(buffer);
    }

    function onEnd() {
      const rawBody = Buffer.concat(chunks).toString("utf8").trim();
      if (!rawBody) {
        settle(resolve, null);
        return;
      }
      try {
        settle(resolve, JSON.parse(rawBody));
      } catch {
        settle(reject, new HttpError(400, "Request body must be valid JSON.", "invalid_json"));
      }
    }

    /** @param {Error} error */
    function onError(error) {
      settle(reject, error);
    }

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

/**
 * Resolve a redirect target against the app's public URL and keep it only
 * if it stays on that origin; anything else becomes `fallbackPath` there.
 *
 * Sign-in, sign-out and calendar-connect all bounce the browser to a URL
 * that arrived in a query string. Followed blindly that is an open
 * redirect: a link could run someone through Google's genuine sign-in page
 * and land them on a lookalike site. `javascript:` and other schemes fail
 * the origin check too.
 *
 * @param {unknown} target
 * @param {string} publicAppUrl
 * @param {string} [fallbackPath]
 * @returns {string}
 */
export function sameOriginUrl(target, publicAppUrl, fallbackPath = "/") {
  const base = new URL(publicAppUrl);
  if (typeof target === "string" && target.trim()) {
    try {
      const resolved = new URL(target, base);
      if (resolved.origin === base.origin) return resolved.toString();
    } catch {
      // Unparseable: fall through to the fallback.
    }
  }
  return new URL(fallbackPath, base).toString();
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {unknown} data
 * @param {Record<string, string | string[]>} [headers]
 */
export function sendJson(response, status, data, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(data));
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {string} location
 * @param {Record<string, string | string[]>} [headers]
 */
export function redirect(response, location, headers = {}) {
  response.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end();
}

/**
 * @param {import("node:http").IncomingMessage} request
 */
export function getRequestUrl(request) {
  return new URL(request.url || "/", "http://127.0.0.1");
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {unknown} error
 */
export function sendError(response, error) {
  if (error instanceof HttpError) {
    sendJson(
      response,
      error.status,
      { message: error.message, code: error.code, ...error.extra },
      // An oversized body was abandoned part-way; closing the connection
      // is what stops the client streaming the rest of it at us.
      error.status === 413 ? { Connection: "close" } : {}
    );
    return;
  }

  log.error(error);
  sendJson(response, 500, {
    message: "Something went wrong on the server.",
    code: "internal_error",
  });
}

