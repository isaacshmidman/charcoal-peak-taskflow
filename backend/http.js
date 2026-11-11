// @ts-check
import { createHash } from "node:crypto";
import { URL } from "node:url";
import { gzip } from "node:zlib";
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
 * Read a request body as text, refusing anything over `maxBytes`.
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
 * @returns {Promise<string>}  trimmed; "" for an empty body
 */
export function readBodyText(request, { maxBytes = MAX_JSON_BODY_BYTES } = {}) {
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
      settle(resolve, Buffer.concat(chunks).toString("utf8").trim());
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
 * Read and parse a JSON request body (see readBodyText for the size cap).
 * An empty body is null.
 *
 * @param {import("node:http").IncomingMessage} request
 * @param {{ maxBytes?: number }} [options]
 * @returns {Promise<any>}
 */
export async function readJsonBody(request, options = {}) {
  const rawBody = await readBodyText(request, options);
  if (!rawBody) return null;
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.", "invalid_json");
  }
}

/**
 * Read an application/x-www-form-urlencoded body (OAuth's token and
 * revoke endpoints) into plain fields. A JSON object body is accepted too.
 *
 * @param {import("node:http").IncomingMessage} request
 * @returns {Promise<Record<string, string>>}
 */
export async function readFormBody(request) {
  const raw = await readBodyText(request);
  if (/^application\/json/i.test(String(request.headers?.["content-type"] || ""))) {
    let parsed;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      throw new HttpError(400, "Request body must be valid JSON.", "invalid_json");
    }
    return Object.fromEntries(
      Object.entries(parsed && typeof parsed === "object" ? parsed : {}).map(([k, v]) => [k, typeof v === "string" ? v : String(v ?? "")])
    );
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

/**
 * The origin of config.publicAppUrl, or "" when it isn't a valid URL.
 * @param {{ publicAppUrl?: string }} config
 */
export function publicOrigin(config) {
  try {
    return new URL(String(config.publicAppUrl)).origin;
  } catch {
    return "";
  }
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

/** Below this a response isn't worth compressing: it fits in one packet. */
const MIN_COMPRESS_BYTES = 1024;

/**
 * True when the request says it can read gzip.
 * @param {import("node:http").IncomingMessage | undefined | null} request
 */
export function acceptsGzip(request) {
  const header = String(request?.headers?.["accept-encoding"] || "");
  return /(^|,)\s*(gzip|\*)\s*(;\s*q=(?!0(\.0*)?\s*(,|$))[^,]*)?\s*(,|$)/i.test(header);
}

/**
 * A fingerprint of a response body. Weak (`W/`): it names the content,
 * not its exact bytes, so it stays true whether or not the body goes out
 * compressed.
 * @param {string} text
 */
export function etagFor(text) {
  return `W/"${createHash("sha1").update(text).digest("base64url")}"`;
}

/**
 * @param {unknown} header  the request's If-None-Match
 * @param {string} etag
 */
function sameEtag(header, etag) {
  if (!header) return false;
  const bare = etag.replace(/^W\//, "");
  return String(header)
    .split(",")
    .some((candidate) => candidate.trim().replace(/^W\//, "") === bare || candidate.trim() === "*");
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {unknown} data
 * @param {Record<string, string | string[]>} [headers]
 */
export function sendJson(response, status, data, headers = {}) {
  sendJsonText(response, status, JSON.stringify(data), headers);
}

/**
 * Send JSON that is already text. Two things happen here that used not to:
 *
 *  - A GET carries an ETag, and a client that sends it back
 *    (If-None-Match) gets a bodiless 304 when nothing has changed. The app
 *    asks for its whole task list every time a page opens or the window
 *    is focused; almost every time the answer is the one it already has.
 *  - Anything over a kilobyte goes out gzipped when the client can read
 *    it. A task list shrinks about thirty-fold, and the slow leg of the
 *    trip — out of the house, up to Cloudflare — is the one that carried
 *    it uncompressed. Compression runs off the main thread.
 *
 * `prepared` lets a caller that keeps answers (the entity list cache)
 * hand over the ETag and the compressed bytes it already has; a freshly
 * compressed body is stored back on it.
 *
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {string | undefined} text
 * @param {Record<string, string | string[]>} [headers]
 * @param {{ etag?: string, gzipped?: Buffer | null }} [prepared]
 */
export function sendJsonText(response, status, text, headers = {}, prepared) {
  /** @type {any} */
  const head = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  };
  const request = /** @type {import("node:http").IncomingMessage | undefined} */ (/** @type {any} */ (response).req);
  const body = text ?? "";
  // A kept answer may be down to its compressed copy and its ETag.
  const ready = prepared?.gzipped && prepared.etag ? prepared.gzipped : null;

  if (status === 200 && request?.method === "GET" && (body || ready)) {
    const etag = prepared?.etag || etagFor(body);
    if (prepared) prepared.etag = etag;
    head.ETag = etag;
    if (sameEtag(request.headers?.["if-none-match"], etag)) {
      response.writeHead(304, head);
      response.end();
      return;
    }
  }

  if (!acceptsGzip(request) || (!ready && body.length < MIN_COMPRESS_BYTES)) {
    response.writeHead(status, head);
    response.end(text);
    return;
  }

  /** @param {Buffer} gzipped */
  const sendCompressed = (gzipped) => {
    response.writeHead(status, { ...head, "Content-Encoding": "gzip", "Content-Length": gzipped.length });
    response.end(gzipped);
  };
  if (prepared?.gzipped) {
    sendCompressed(prepared.gzipped);
    return;
  }
  gzip(body, { level: 6 }, (error, gzipped) => {
    if (response.destroyed || response.writableEnded) return;
    if (error) {
      response.writeHead(status, head);
      response.end(body);
      return;
    }
    if (prepared) prepared.gzipped = gzipped;
    sendCompressed(gzipped);
  });
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
 * The request line as a URL. Only its path and query mean anything; the
 * host is a stand-in.
 *
 * A request line is a path, not a link, so it must not be resolved the way
 * a browser resolves one: read like that, "//.env" is a host called ".env"
 * with the path "/" (which gets the app's page), and "//" is no host at
 * all (an error, so a 500). A line that starts with a slash is read as the
 * path it is.
 *
 * @param {import("node:http").IncomingMessage} request
 */
export function getRequestUrl(request) {
  const target = request.url || "/";
  return target.startsWith("/") ? new URL(`http://127.0.0.1${target}`) : new URL(target, "http://127.0.0.1");
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

