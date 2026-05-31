// @ts-nocheck
/**
 * @file Minimal multipart/form-data parser. Buffers the full request
 * body in memory (capped by `maxBytes`) and splits on the boundary.
 *
 * Why not formidable/busboy: we upload one file at a time, with a
 * 25 MB cap, and want to keep the dep tree minimal — the file count
 * across this project is already 100+. Built-in Node streams +
 * Buffer.indexOf give us everything we need.
 *
 * Supported: a single file field plus arbitrary text fields. Not
 * supported: multi-file fields (yet). For Zephyrly's "upload one
 * attachment per request" pattern, this is exactly enough.
 *
 * (@ts-nocheck because the @types/node typings for Buffer methods
 * don't model the Buffer-vs-Uint8Array overloads we use; this file's
 * runtime correctness is covered by unit tests.)
 */
import { HttpError } from "../http.js";

const CRLF = Buffer.from("\r\n");
const DOUBLE_CRLF = Buffer.from("\r\n\r\n");

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {{ maxBytes: number }} opts
 * @returns {Promise<{ fields: Record<string, string>, file: { fieldName: string, filename: string, mimeType: string, data: Buffer } | null }>}
 */
export async function parseMultipart(req, { maxBytes }) {
  const contentType = String(req.headers["content-type"] || "");
  const boundary = extractBoundary(contentType);
  if (!boundary) {
    throw new HttpError(400, "Expected multipart/form-data with a boundary.", "invalid_multipart");
  }

  const body = await readBody(req, maxBytes);

  const boundaryDelim = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(body, Buffer.concat([CRLF, boundaryDelim]));
  // First chunk before the first boundary is the preamble — typically empty
  // or "--{boundary}\r\n". Drop it and the trailing "--" terminator chunk.
  parts.shift();
  if (parts.length && parts[parts.length - 1].slice(0, 2).equals(Buffer.from("--"))) {
    parts.pop();
  }

  /** @type {Record<string, string>} */
  const fields = {};
  /** @type {{ fieldName: string, filename: string, mimeType: string, data: Buffer } | null} */
  let file = null;

  for (const raw of parts) {
    // Each part starts with its own \r\n after the boundary marker that
    // split() left behind, so trim the leading CRLF if present.
    const part = raw.indexOf(CRLF) === 0 ? raw.slice(2) : raw;
    const headerEnd = part.indexOf(DOUBLE_CRLF);
    if (headerEnd === -1) continue;
    const headerText = part.slice(0, headerEnd).toString("utf8");
    // Drop the trailing CRLF that precedes the next boundary in our split.
    const body = part.slice(headerEnd + DOUBLE_CRLF.length).slice(0, -2);

    const disposition = headerText.split(/\r?\n/).find((line) => /^content-disposition:/i.test(line));
    if (!disposition) continue;
    const nameMatch = disposition.match(/name="([^"]*)"/i);
    const filenameMatch = disposition.match(/filename="([^"]*)"/i);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];

    if (filenameMatch) {
      const mimeMatch = headerText.split(/\r?\n/).find((line) => /^content-type:/i.test(line));
      const mimeType = mimeMatch ? mimeMatch.replace(/^content-type:\s*/i, "").trim() : "application/octet-stream";
      file = {
        fieldName,
        filename: filenameMatch[1],
        mimeType,
        data: body,
      };
    } else {
      fields[fieldName] = body.toString("utf8");
    }
  }

  return { fields, file };
}

/**
 * @param {string} contentType
 * @returns {string | null}
 */
function extractBoundary(contentType) {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) return null;
  return (m[1] || m[2] || "").trim();
}

/**
 * Reads up to `max` bytes from a request stream. Rejects with a 413 if
 * the body exceeds the cap before EOF.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {number} max
 * @returns {Promise<Buffer>}
 */
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > max) {
        reject(new HttpError(413, `Upload exceeds the ${Math.round(max / 1024 / 1024)} MB limit.`, "payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (err) => reject(err));
  });
}

/**
 * Split a Buffer at every occurrence of `delim`. Returns an array
 * including the segments before/after each match (empty segments
 * preserved).
 * @param {Buffer} buf
 * @param {Buffer} delim
 * @returns {Buffer[]}
 */
function splitBuffer(buf, delim) {
  /** @type {Buffer[]} */
  const out = [];
  let start = 0;
  while (true) {
    const idx = buf.indexOf(delim, start);
    if (idx === -1) {
      out.push(buf.slice(start));
      return out;
    }
    out.push(buf.slice(start, idx));
    start = idx + delim.length;
  }
}
