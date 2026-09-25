// @ts-check
/**
 * @file GET /api/apps/:appId/export — the signed-in user's data as a ZIP
 * download (see backend/export.js for what's inside).
 */
import { HttpError } from "../http.js";
import { requireAuthenticatedUser } from "../auth.js";
import { buildExport } from "../export.js";
import { planZip } from "../zip.js";
import { log } from "../log.js";

// An export reads every attachment a user has (up to 1 GB). One at a
// time per user, so repeated taps can't stack that work up.
const exportsInProgress = new Set();

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ config: any, db: any, url: URL, segments: string[] }} ctx
 * @returns {Promise<boolean>}
 */
export async function handleExportRoute(request, response, { config, db, segments }) {
  if (segments[0] !== "api" || segments[1] !== "apps" || segments[3] !== "export" || segments.length !== 4) {
    return false;
  }
  const appId = segments[2];
  if (!appId || appId !== config.appId) return false;
  if (request.method !== "GET") throw new HttpError(405, "Use GET to download an export.", "method_not_allowed");

  const user = requireAuthenticatedUser(db, config, request, appId);
  if (exportsInProgress.has(user.id)) {
    throw new HttpError(429, "An export is already downloading. Try again when it finishes.", "export_in_progress");
  }
  exportsInProgress.add(user.id);

  try {
    // Everything that can fail cleanly happens before the headers go out.
    const { fileName, entries } = await buildExport(db, config, { appId, user });
    const zip = planZip(entries);

    response.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.totalBytes),
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    });

    let clientGone = false;
    response.on("close", () => {
      if (!response.writableEnded) clientGone = true;
    });
    /** @param {Buffer} chunk */
    const sink = (chunk) =>
      new Promise((resolveWrite, rejectWrite) => {
        if (clientGone || response.destroyed) {
          rejectWrite(new Error("export download cancelled"));
          return;
        }
        if (response.write(chunk)) resolveWrite(undefined);
        else response.once("drain", () => resolveWrite(undefined));
      });

    try {
      await zip.write(sink);
      response.end();
    } catch (error) {
      // Headers are already sent, so there's no error response to give:
      // cut the connection so the browser reports a failed download
      // rather than saving a truncated archive as if it were whole.
      if (!clientGone) log.error(error);
      response.destroy(error instanceof Error ? error : undefined);
    }
    return true;
  } finally {
    exportsInProgress.delete(user.id);
  }
}
