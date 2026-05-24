// @ts-check
import { URL } from "node:url";
import { log } from "./log.js";

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
 * @param {import("node:http").IncomingMessage} request
 */
export async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return null;
  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) return null;

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.", "invalid_json");
  }
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
    sendJson(response, error.status, {
      message: error.message,
      code: error.code,
      ...error.extra,
    });
    return;
  }

  log.error(error);
  sendJson(response, 500, {
    message: "Something went wrong on the server.",
    code: "internal_error",
  });
}

