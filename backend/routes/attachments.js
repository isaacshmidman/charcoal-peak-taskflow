// @ts-check
/**
 * @file Task attachment routes.
 *
 *   GET    /api/apps/:appId/tasks/:taskId/attachments      list
 *   POST   /api/apps/:appId/tasks/:taskId/attachments      upload (multipart)
 *   GET    /api/apps/:appId/attachments/:id                fetch bytes
 *   DELETE /api/apps/:appId/attachments/:id                delete
 *
 * All routes require an authenticated user. Ownership is enforced
 * inside backend/attachments.js — neither task nor attachment can be
 * accessed across users.
 */
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
import { parseMultipart } from "../lib/multipart.js";

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
      const { file } = await parseMultipart(request, { maxBytes: MAX_FILE_BYTES + 1024 });
      if (!file) throw new HttpError(400, "Expected a `file` form field.", "no_file");
      const attachment = await createAttachment(db, config, { appId, user, taskId, file });
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
      sendAttachmentFile(
        response,
        absolutePath,
        { filename: row.filename, mimeType },
        { asDownload }
      );
      return true;
    }

    if (request.method === "DELETE" && segments.length === 5) {
      sendJson(response, 200, deleteAttachment(db, config, { appId, user, id }));
      return true;
    }
  }

  return false;
}
