// @ts-check
/**
 * @file Task attachment routes.
 *
 *   GET    /api/apps/:appId/tasks/:taskId/attachments      list
 *   POST   /api/apps/:appId/tasks/:taskId/attachments      upload (multipart)
 *   GET    /api/apps/:appId/attachments/usage              storage stats
 *   GET    /api/apps/:appId/attachments/:id                fetch bytes
 *   DELETE /api/apps/:appId/attachments/:id                delete
 *
 * All routes require an authenticated user. Ownership is enforced
 * inside backend/attachments.js — neither task nor attachment can be
 * accessed across users.
 *
 * Upload parsing: busboy. We previously had a hand-rolled multipart
 * parser; replaced with busboy because it's the standard Node lib used
 * by Express/Fastify/etc., handles every browser quirk (Safari's
 * `filename*=` syntax, chunked transfer encoding, weird boundaries),
 * and removes a class of "did my parser corrupt a byte?" bugs that's
 * impossible to fully test from the outside.
 */
import { createRequire } from "node:module";
import { HttpError, sendJson } from "../http.js";
import { requireAuthenticatedUser } from "../auth.js";
import {
  createAttachment,
  deleteAttachment,
  getAttachment,
  getStorageOverview,
  listAttachmentsForTask,
  sendAttachmentFile,
  MAX_FILE_BYTES,
} from "../attachments.js";
import { log } from "../log.js";

const require = createRequire(import.meta.url);
/** @type {any} */
const Busboy = require("busboy");

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ config: any, db: any, url: URL, segments: string[] }} ctx
 * @returns {Promise<boolean>}
 */
export async function handleAttachmentsRoute(request, response, { config, db, url, segments }) {
  if (segments[0] !== "api" || segments[1] !== "apps") return false;
  const appId = segments[2];
  if (!appId || appId !== config.appId) return false;

  // ─ /api/apps/:appId/tasks/:taskId/attachments ─
  if (
    segments[3] === "tasks" &&
    segments[4] &&
    segments[5] === "attachments"
  ) {
    const user = requireAuthenticatedUser(db, config, request, appId);
    const taskId = segments[4];

    if (request.method === "GET" && segments.length === 6) {
      sendJson(response, 200, {
        attachments: listAttachmentsForTask(db, { appId, user, taskId }),
      });
      return true;
    }

    if (request.method === "POST" && segments.length === 6) {
      const file = await readSingleFileFromMultipart(request, MAX_FILE_BYTES);
      if (!file) throw new HttpError(400, "Expected a `file` form field.", "no_file");
      log.info(`[attachments] upload received task=${taskId} filename="${file.filename}" mime=${file.mimeType} size=${file.data.length}`);
      const attachment = await createAttachment(db, config, { appId, user, taskId, file });
      log.info(`[attachments] upload completed id=${attachment.id} has_thumb=${attachment.has_thumb}`);
      sendJson(response, 201, attachment);
      return true;
    }
  }

  // ─ /api/apps/:appId/attachments/usage ─
  if (
    request.method === "GET" &&
    segments[3] === "attachments" &&
    segments[4] === "usage" &&
    segments.length === 5
  ) {
    const user = requireAuthenticatedUser(db, config, request, appId);
    sendJson(response, 200, getStorageOverview(db, { appId, user }));
    return true;
  }

  // ─ /api/apps/:appId/attachments/:id ─
  if (segments[3] === "attachments" && segments[4]) {
    const user = requireAuthenticatedUser(db, config, request, appId);
    const id = segments[4];

    if (request.method === "GET" && segments.length === 5) {
      const asThumb = url.searchParams.get("thumb") === "1";
      const { row, absolutePath, servingThumb } = getAttachment(db, config, { appId, user, id, thumb: asThumb });
      const asDownload = url.searchParams.get("download") === "1";
      // Thumbnails are always WebP regardless of the original MIME, so
      // override the response Content-Type when we serve one.
      const mimeType = servingThumb ? "image/webp" : row.mime_type;
      await sendAttachmentFile(
        response,
        absolutePath,
        { filename: row.filename, mimeType },
        { asDownload }
      );
      return true;
    }

    if (request.method === "DELETE" && segments.length === 5) {
      sendJson(response, 200, await deleteAttachment(db, config, { appId, user, id }));
      return true;
    }
  }

  return false;
}

/**
 * Stream-parse a multipart/form-data request looking for the FIRST file
 * field. Buffers up to `maxBytes` in memory; rejects with 413 if larger.
 * Resolves to null if no file field was found.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<{ filename: string, mimeType: string, data: Buffer } | null>}
 */
function readSingleFileFromMultipart(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = Busboy({
        headers: req.headers,
        limits: { fileSize: maxBytes, files: 1 },
      });
    } catch (err) {
      reject(new HttpError(400, `Invalid multipart body: ${err?.message || "unknown"}`, "invalid_multipart"));
      return;
    }

    /** @type {{ filename: string, mimeType: string, data: Buffer } | null} */
    let captured = null;
    let exceededLimit = false;

    bb.on("file", (_fieldName, stream, info) => {
      const filename = info?.filename || "file";
      const mimeType = info?.mimeType || "application/octet-stream";
      /** @type {Buffer[]} */
      const chunks = [];
      let total = 0;

      stream.on("data", (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          exceededLimit = true;
          stream.resume();  // drain so busboy doesn't deadlock
          return;
        }
        chunks.push(chunk);
      });

      stream.on("limit", () => {
        // busboy fires this when fileSize cap is hit
        exceededLimit = true;
      });

      stream.on("end", () => {
        if (exceededLimit) return;  // captured stays null → reject below
        captured = {
          filename,
          mimeType,
          data: Buffer.concat(chunks),
        };
      });
    });

    bb.on("close", () => {
      if (exceededLimit) {
        reject(new HttpError(
          413,
          `Upload exceeds the ${Math.round(maxBytes / 1_000_000)} MB limit.`,
          "payload_too_large"
        ));
        return;
      }
      resolve(captured);
    });

    bb.on("error", (err) => {
      reject(new HttpError(400, `Multipart parse error: ${err?.message || "unknown"}`, "invalid_multipart"));
    });

    // IncomingMessage IS a Readable stream; the typings don't always
    // surface `.pipe` on the namespace import we use elsewhere.
    /** @type {any} */ (req).pipe(bb);
  });
}
