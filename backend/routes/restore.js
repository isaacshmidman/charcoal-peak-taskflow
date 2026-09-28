// @ts-check
/**
 * @file POST /api/apps/:appId/restore — upload an export (.zip, or its
 * data.json) and add back whatever's missing. See backend/restore.js.
 *
 * The upload can be large (an export carries up to 1 GB of files), so it
 * streams to a temporary file beside the database rather than into
 * memory, and the temp file is always removed afterwards.
 */
import { createWriteStream, promises as fsp } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { HttpError, sendJson } from "../http.js";
import { requireAuthenticatedUser } from "../auth.js";
import { MAX_RESTORE_UPLOAD_BYTES, openExport, restoreExport } from "../restore.js";
import { log } from "../log.js";

const require = createRequire(import.meta.url);
/** @type {any} */
const Busboy = require("busboy");

// A restore reads a whole archive and writes many records. One at a time
// per user.
const restoresInProgress = new Set();

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ config: any, db: any, url: URL, segments: string[] }} ctx
 * @returns {Promise<boolean>}
 */
export async function handleRestoreRoute(request, response, { config, db, segments }) {
  if (segments[0] !== "api" || segments[1] !== "apps" || segments[3] !== "restore" || segments.length !== 4) {
    return false;
  }
  const appId = segments[2];
  if (!appId || appId !== config.appId) return false;
  if (request.method !== "POST") throw new HttpError(405, "Use POST to restore an export.", "method_not_allowed");

  const user = requireAuthenticatedUser(db, config, request, appId);
  if (restoresInProgress.has(user.id)) {
    throw new HttpError(429, "A restore is already running. Try again when it finishes.", "restore_in_progress");
  }
  restoresInProgress.add(user.id);

  const tempDir = join(dirname(config.dbFile), "restore-uploads");
  const tempPath = join(tempDir, `${randomUUID()}.upload`);
  let result;
  try {
    await fsp.mkdir(tempDir, { recursive: true });
    const received = await saveUploadToFile(request, tempPath, MAX_RESTORE_UPLOAD_BYTES);
    if (!received) throw new HttpError(400, "Expected a `file` form field.", "no_file");

    const upload = await openExport(tempPath);
    try {
      result = await restoreExport(db, config, { appId, user, data: upload.data, readFile: upload.readFile });
    } finally {
      await upload.close();
    }
  } finally {
    // Gone before the reply, so nothing is left on disk once it's answered.
    restoresInProgress.delete(user.id);
    await fsp.rm(tempPath, { force: true }).catch(() => {});
  }
  log.info(`[restore] user=${user.id} added=${JSON.stringify(result.added)}`);
  sendJson(response, 200, result);
  return true;
}

/**
 * Stream the first file field of a multipart request to `path`. Resolves
 * true once it's fully on disk, false if there was no file field; rejects
 * with 413 past `maxBytes` (what was written is removed by the caller).
 *
 * @param {import("node:http").IncomingMessage} request
 * @param {string} path
 * @param {number} maxBytes
 * @returns {Promise<boolean>}
 */
export function saveUploadToFile(request, path, maxBytes) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = Busboy({ headers: request.headers, limits: { fileSize: maxBytes, files: 1 } });
    } catch (error) {
      reject(new HttpError(400, `Invalid upload: ${error?.message || "unknown"}`, "invalid_multipart"));
      return;
    }

    let sawFile = false;
    let tooLarge = false;
    /** @type {Promise<void> | null} */
    let written = null;
    /** @type {import("node:fs").WriteStream | null} */
    let out = null;

    bb.on("file", (_field, stream) => {
      if (sawFile) {
        stream.resume();
        return;
      }
      sawFile = true;
      const file = createWriteStream(path, { mode: 0o600 });
      out = file;
      stream.on("limit", () => {
        tooLarge = true;
      });
      written = new Promise((resolveWrite, rejectWrite) => {
        file.on("finish", () => resolveWrite());
        file.on("error", rejectWrite);
        stream.on("error", rejectWrite);
      });
      stream.pipe(file);
    });

    bb.on("close", () => {
      if (tooLarge) {
        reject(new HttpError(413, `That file is over the ${Math.round(maxBytes / 1_000_000_000 * 10) / 10} GB limit for a restore.`, "payload_too_large"));
        return;
      }
      if (!written) {
        resolve(false);
        return;
      }
      written.then(() => resolve(true), reject);
    });

    bb.on("error", (error) => {
      out?.destroy();
      reject(new HttpError(400, `Upload failed: ${error?.message || "unknown"}`, "invalid_multipart"));
    });

    /** @type {any} */ (request).pipe(bb);
  });
}
