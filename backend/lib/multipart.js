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
 * Wire format reminder (RFC 7578 / RFC 2046):
 *
 *   --<boundary>\r\n               ← opening boundary
 *   Content-Disposition: ...\r\n
 *   Content-Type: ...\r\n          ← optional
 *   \r\n
 *   <part body bytes>\r\n          ← body may be binary
 *   --<boundary>\r\n               ← next-part boundary
 *   ...
 *   --<boundary>--\r\n             ← closing boundary (trailing "--")
 *
 * Strategy: split the body on `--<boundary>` (no leading CRLF). The
 * resulting chunks are the preamble (usually empty), each part
 * (surrounded by CRLFs from the wrapping boundaries), and the
 * postamble (starts with `--\r\n`). Trim the CRLF padding on each
 * part and you have its raw header+body.
 *
 * The previous version used `\r\n--<boundary>` as the delim, which
 * matched the CRLF that comes AFTER the opening boundary, eating the
 * headers + first 2 bytes of the body.
 */
import { HttpError } from "../http.js";

const CR = 0x0D;
const LF = 0x0A;
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
  const chunks = splitBuffer(body, boundaryDelim);

  // chunks layout:
  //   [0]    preamble (usually empty or just "\r\n")
  //   [1..N-2] each part — leading CRLF + headers + CRLF + CRLF + body + trailing CRLF
  //   [N-1]  postamble (begins with "--" — the closing boundary's tail — possibly "--\r\n")

  /** @type {Record<string, string>} */
  const fields = {};
  /** @type {{ fieldName: string, filename: string, mimeType: string, data: Buffer } | null} */
  let file = null;

  for (let i = 1; i < chunks.length - 1; i++) {
    let chunk = chunks[i];
    // Trim leading CRLF that came right after the opening boundary line.
    if (chunk.length >= 2 && chunk[0] === CR && chunk[1] === LF) {
      chunk = chunk.slice(2);
    }
    // Trim trailing CRLF that precedes the next boundary marker.
    if (chunk.length >= 2 && chunk[chunk.length - 2] === CR && chunk[chunk.length - 1] === LF) {
      chunk = chunk.slice(0, -2);
    }

    const headerEnd = chunk.indexOf(DOUBLE_CRLF);
    if (headerEnd === -1) continue;
    const headerText = chunk.slice(0, headerEnd).toString("utf8");
    const partBody = chunk.slice(headerEnd + DOUBLE_CRLF.length);

    const headerLines = headerText.split(/\r?\n/);
    const dispositionLine = headerLines.find((line) => /^content-disposition:/i.test(line));
    if (!dispositionLine) continue;
    const nameMatch = dispositionLine.match(/name="([^"]*)"/i);
    const filenameMatch = dispositionLine.match(/filename="([^"]*)"/i);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];

    if (filenameMatch) {
      const mimeLine = headerLines.find((line) => /^content-type:/i.test(line));
      const mimeType = mimeLine ? mimeLine.replace(/^content-type:\s*/i, "").trim() : "application/octet-stream";
      file = {
        fieldName,
        filename: filenameMatch[1],
        mimeType,
        data: partBody,
      };
    } else {
      fields[fieldName] = partBody.toString("utf8");
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
