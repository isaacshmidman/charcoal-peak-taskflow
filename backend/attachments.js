// @ts-check
/**
 * @file Task attachment storage + metadata. Files live on the same
 * filesystem volume as the SQLite DB; metadata in `task_attachments`.
 *
 * Layout under `<dataDir>/attachments/`:
 *   {appId}/{userId}/{taskId}/{attId}_{slugified-filename}
 *
 * Slug is purely cosmetic — never read back; the random `attId` is
 * the actual lookup key.
 *
 * HEIC handling: sharp converts HEIC → JPEG when the underlying
 * libvips build includes libheif. The production Dockerfile installs
 * `libheif1` so this works fast (native). If you ever rebuild without
 * it, sharp's `convertHeicIfNeeded` will log and store the original
 * HEIC bytes — chip + lightbox will still render the file-icon
 * fallback but the image won't preview in non-Safari browsers.
 *
 * Cascades (handled by callers):
 *   - Permanent task delete → deleteAttachmentsForTask
 *   - Soft delete (Recently Deleted window) → no cascade; on restore
 *     the attachments are still there because the task_id row persists.
 */
import fs, { promises as fsp, createReadStream } from "node:fs";
import sharp from "sharp";
import { log } from "./log.js";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { HttpError } from "./http.js";

// @types/node in this repo doesn't expose `unlinkSync`/`rmSync` from
// the default export; pull them off the namespace via an `any` cast.
/** @type {any} */
const fsAny = fs;
const unlinkSyncSafe = /** @type {(path: string) => void} */ (fsAny.unlinkSync);
const rmSyncSafe = /** @type {(path: string, opts: any) => void} */ (fsAny.rmSync);

// ─ Limits — single source of truth. SI units (10^6 / 10^9) so the
//   numbers match what users mean by "MB" / "GB". The StorageSection
//   UI does the same conversion.
export const MAX_FILE_BYTES = 25 * 1_000_000;            // 25 MB per file
export const MAX_ATTACHMENTS_PER_TASK = 10;
export const MAX_TOTAL_BYTES_PER_USER = 1_000_000_000;   // 1 GB

const BLOCKED_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "scr", "msi", "app", "dmg", "sh", "ps1",
]);

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/heic",
  "image/heif",
]);

// MIME types we feed through sharp for thumbnail generation. SVG is an
// image but sharp can't safely rasterize arbitrary SVGs without
// security implications; GIF loses animation on resize. Both render
// fine at original size in the chip — no thumbnail needed.
const THUMBNAILABLE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const THUMB_MAX_DIM = 400;
const THUMB_QUALITY = 80;

/** Replace any image-y extension (or none) with `.jpg`. */
function renameToJpg(filename) {
  if (!filename) return "image.jpg";
  if (/\.(jpg|jpeg)$/i.test(filename)) return filename;
  if (/\.[a-z0-9]{1,5}$/i.test(filename)) return filename.replace(/\.[a-z0-9]{1,5}$/i, ".jpg");
  return `${filename}.jpg`;
}

/**
 * Sniff the first ~12 bytes of a buffer to detect HEIC/HEIF even
 * when the browser mislabels it (iOS Safari has been observed
 * sending HEIC photos with mimeType=image/jpeg in some upload
 * paths). Returns true if the file is actually HEIC/HEIF.
 *
 * Layout: ISO Base Media File Format (BMFF). Bytes [4..7] are the
 * "ftyp" box header; bytes [8..11] are the major brand. HEIC files
 * use brands like "heic", "heix", "hevc", "mif1", "heim".
 *
 * @param {Buffer} buf
 */
function sniffIsHeic(buf) {
  if (!buf || buf.length < 12) return false;
  if (buf.slice(4, 8).toString("ascii") !== "ftyp") return false;
  const brand = buf.slice(8, 12).toString("ascii").toLowerCase();
  return ["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"].includes(brand);
}

/**
 * Convert HEIC/HEIF to JPEG so non-Safari browsers can render it
 * inline. Uses sharp's native libvips path — requires libheif1 to be
 * installed in the runtime image (see Dockerfile).
 *
 * Returns the original file if conversion fails (no libheif, corrupt
 * file, etc.) — the file is still stored; the chip will just show the
 * file-icon fallback instead of a thumbnail.
 *
 * @param {{ data: Buffer, filename: string, mimeType: string }} file
 * @returns {Promise<{ data: Buffer, filename: string, mimeType: string }>}
 */
async function convertHeicIfNeeded(file) {
  const declared = /^image\/(heic|heif)/i.test(file.mimeType);
  const sniffed = !declared && /^image\//i.test(file.mimeType) && sniffIsHeic(file.data);
  if (!declared && !sniffed) return file;

  log.info(`[attachments] HEIC detected (${declared ? "declared" : "sniffed"}) for "${file.filename}" — converting`);
  try {
    const jpegBuffer = await sharp(file.data).rotate().jpeg({ quality: 90 }).toBuffer();
    log.info(`[attachments] HEIC converted: ${file.data.length} → ${jpegBuffer.length} bytes`);
    return {
      data: jpegBuffer,
      filename: renameToJpg(file.filename),
      mimeType: "image/jpeg",
    };
  } catch (err) {
    log.warn(`[attachments] HEIC conversion failed (sharp lacks libheif support?); storing original. err=${err?.message}`);
    return file;
  }
}

/**
 * Generate a thumbnail Buffer (WebP, max 400x400, aspect-preserving)
 * from an image buffer. Returns null on failure (corrupt file, sharp
 * misconfig, non-image masquerading as image) — caller treats null as
 * "no thumb available" and falls back to the original on read.
 *
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<Buffer | null>}
 */
async function maybeGenerateThumbnail(buffer, mimeType) {
  if (!THUMBNAILABLE_MIME_TYPES.has(String(mimeType || "").toLowerCase())) return null;
  try {
    const thumb = await sharp(buffer)
      .rotate()  // honors EXIF orientation so portrait photos don't show sideways
      .resize(THUMB_MAX_DIM, THUMB_MAX_DIM, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
    log.info(`[attachments] thumbnail generated: ${buffer.length} → ${thumb.length} bytes (${mimeType})`);
    return thumb;
  } catch (err) {
    log.warn(`[attachments] thumbnail generation failed for mime=${mimeType}: ${err?.message}`);
    return null;
  }
}

/**
 * Resolve the on-disk attachments root from the SQLite db file path.
 * Both live on the same mounted volume in production.
 * @param {{ dbFile: string }} config
 */
function attachmentsRoot(config) {
  return resolve(dirname(config.dbFile), "attachments");
}

/** @param {string} filename */
function slugifyFilename(filename) {
  const base = String(filename || "file").replace(/[ -]/g, "");
  // Allowed: letters, digits, dot, dash, underscore. Collapse runs.
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "file";
}

/** @param {string} filename */
function fileExtension(filename) {
  const idx = String(filename).lastIndexOf(".");
  if (idx <= 0) return "";
  return filename.slice(idx + 1).toLowerCase();
}

/**
 * @param {string} filename
 * @returns {string | null}  ext if blocked
 */
function isBlockedExtension(filename) {
  const ext = fileExtension(filename);
  return BLOCKED_EXTENSIONS.has(ext) ? ext : null;
}

/** @param {string} mime */
function isImageMime(mime) {
  return IMAGE_MIME_TYPES.has(String(mime || "").toLowerCase());
}

/**
 * @param {any} db
 * @param {{ appId: string, userId: string }} scope
 * @returns {number}
 */
export function getUserStorageBytes(db, { appId, userId }) {
  const row = db
    .prepare(`SELECT COALESCE(SUM(size_bytes), 0) AS total FROM task_attachments WHERE app_id = ? AND user_id = ?`)
    .get(appId, userId);
  return Number(row?.total || 0);
}

/**
 * @param {any} db
 * @param {{ appId: string, taskId: string }} scope
 */
function countAttachmentsForTask(db, { appId, taskId }) {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM task_attachments WHERE app_id = ? AND task_id = ?`)
    .get(appId, taskId);
  return Number(row?.n || 0);
}

/**
 * @param {any} db
 * @param {{ appId: string, taskId: string, userId: string }} scope
 * @throws HttpError if the task does not exist or isn't owned by user
 */
function assertTaskOwnership(db, { appId, taskId, userId }) {
  const row = db
    .prepare(`SELECT created_by_id, created_by FROM tasks WHERE app_id = ? AND id = ?`)
    .get(appId, taskId);
  if (!row) throw new HttpError(404, "Task not found.", "not_found");
  // The created_by_id field is the modern owner key; created_by (email)
  // is the legacy fallback. Either match is fine.
  if (row.created_by_id && row.created_by_id !== userId) {
    throw new HttpError(403, "Not your task.", "forbidden");
  }
}

/**
 * @param {any} db
 * @param {any} _config — reserved for future use (cache invalidation hooks)
 * @param {{ appId: string, taskId: string }} scope
 */
function refreshTaskAttachmentCount(db, _config, { appId, taskId }) {
  const n = countAttachmentsForTask(db, { appId, taskId });
  db.prepare(`UPDATE tasks SET attachment_count = ? WHERE app_id = ? AND id = ?`).run(n, appId, taskId);
}

/**
 * Serialize a DB row for the API. Keeps internal storage paths off
 * the wire. `has_thumb` lets the frontend decide whether to request
 * `?thumb=1` for a smaller image (otherwise it falls back to original).
 * @param {any} row
 */
function serializeAttachment(row) {
  if (!row) return null;
  return {
    id: row.id,
    task_id: row.task_id,
    filename: row.filename,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    is_image: Boolean(row.is_image),
    has_thumb: Boolean(row.thumb_path),
    width: row.width ?? null,
    height: row.height ?? null,
    created_date: row.created_date,
  };
}

/**
 * @param {any} db
 * @param {{ appId: string, user: any, taskId: string }} args
 */
export function listAttachmentsForTask(db, { appId, user, taskId }) {
  assertTaskOwnership(db, { appId, taskId, userId: user.id });
  const rows = db
    .prepare(
      `SELECT * FROM task_attachments
       WHERE app_id = ? AND task_id = ?
       ORDER BY created_date ASC`
    )
    .all(appId, taskId);
  return rows.map(serializeAttachment);
}

/**
 * @param {any} db
 * @param {any} config
 * @param {{ appId: string, user: any, id: string, thumb?: boolean }} args
 * @returns {{ row: any, absolutePath: string, servingThumb: boolean }}
 */
export function getAttachment(db, config, { appId, user, id, thumb = false }) {
  const row = db
    .prepare(`SELECT * FROM task_attachments WHERE app_id = ? AND id = ?`)
    .get(appId, id);
  if (!row) throw new HttpError(404, "Attachment not found.", "not_found");
  if (row.user_id !== user.id) {
    throw new HttpError(403, "Not your attachment.", "forbidden");
  }
  const root = attachmentsRoot(config);
  // Prefer the thumbnail when the caller asked for it AND we have one;
  // otherwise serve the original (safe fallback for pre-Pri-2 rows or
  // images that failed thumb generation).
  const useThumb = Boolean(thumb && row.thumb_path);
  const relPath = useThumb ? row.thumb_path : row.storage_path;
  const absolutePath = resolve(root, relPath);
  if (!absolutePath.startsWith(root)) {
    throw new HttpError(404, "Attachment not found.", "not_found");
  }
  return { row: serializeAttachment(row), absolutePath, servingThumb: useThumb };
}

/**
 * @param {any} db
 * @param {any} config
 * @param {{ appId: string, user: any, taskId: string, file: { filename: string, mimeType: string, data: Buffer } }} args
 */
export async function createAttachment(db, config, { appId, user, taskId, file: rawFile }) {
  if (!rawFile || !rawFile.data || rawFile.data.length === 0) {
    throw new HttpError(400, "No file uploaded.", "no_file");
  }

  const blocked = isBlockedExtension(rawFile.filename);
  if (blocked) {
    throw new HttpError(415, `Files with .${blocked} extension are not allowed.`, "blocked_extension");
  }

  // HEIC → JPEG conversion happens BEFORE the size check so a 22 MB HEIC
  // re-encoded to a 6 MB JPEG counts against the quota at its real size.
  const file = await convertHeicIfNeeded(rawFile);

  const size = file.data.length;
  if (size > MAX_FILE_BYTES) {
    throw new HttpError(413, `File too large (max ${Math.round(MAX_FILE_BYTES / 1_000_000)} MB).`, "file_too_large");
  }

  assertTaskOwnership(db, { appId, taskId, userId: user.id });

  const existingCount = countAttachmentsForTask(db, { appId, taskId });
  if (existingCount >= MAX_ATTACHMENTS_PER_TASK) {
    throw new HttpError(
      400,
      `Too many attachments on this task (max ${MAX_ATTACHMENTS_PER_TASK}).`,
      "too_many_attachments"
    );
  }

  const usedBytes = getUserStorageBytes(db, { appId, userId: user.id });
  if (usedBytes + size > MAX_TOTAL_BYTES_PER_USER) {
    throw new HttpError(
      413,
      `This file would exceed your ${Math.round(MAX_TOTAL_BYTES_PER_USER / 1_000_000)} MB storage quota.`,
      "quota_exceeded"
    );
  }

  const id = `att_${randomUUID()}`;
  const slug = slugifyFilename(file.filename);
  const relPath = join(appId, user.id, taskId, `${id}_${slug}`);
  const absPath = join(attachmentsRoot(config), relPath);
  await fsp.mkdir(dirname(absPath), { recursive: true });
  await fsp.writeFile(absPath, file.data, { mode: 0o600 });
  log.info(`[attachments] wrote ${size} bytes to ${absPath}`);

  // Side-channel: generate a small WebP thumbnail for image MIMEs.
  // Failure is non-fatal — the row still saves, GET ?thumb=1 falls back
  // to the original.
  const thumbBuffer = await maybeGenerateThumbnail(file.data, file.mimeType);
  let thumbRelPath = null;
  if (thumbBuffer) {
    thumbRelPath = `${relPath}.thumb.webp`;
    const thumbAbs = join(attachmentsRoot(config), thumbRelPath);
    await fsp.writeFile(thumbAbs, thumbBuffer, { mode: 0o600 });
  }

  const now = new Date().toISOString();
  const isImage = isImageMime(file.mimeType) ? 1 : 0;
  db.prepare(
    `INSERT INTO task_attachments (
       id, app_id, user_id, task_id, filename, mime_type, size_bytes,
       storage_path, thumb_path, is_image, width, height, created_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`
  ).run(id, appId, user.id, taskId, file.filename, file.mimeType, size, relPath, thumbRelPath, isImage, now);

  refreshTaskAttachmentCount(db, config, { appId, taskId });

  const row = db.prepare(`SELECT * FROM task_attachments WHERE id = ?`).get(id);
  return serializeAttachment(row);
}

/**
 * @param {any} db
 * @param {any} config
 * @param {{ appId: string, user: any, id: string }} args
 */
export async function deleteAttachment(db, config, { appId, user, id }) {
  const row = db
    .prepare(`SELECT * FROM task_attachments WHERE app_id = ? AND id = ?`)
    .get(appId, id);
  if (!row) throw new HttpError(404, "Attachment not found.", "not_found");
  if (row.user_id !== user.id) {
    throw new HttpError(403, "Not your attachment.", "forbidden");
  }

  const root = attachmentsRoot(config);
  for (const relPath of [row.storage_path, row.thumb_path]) {
    if (!relPath) continue;
    const abs = resolve(root, relPath);
    try {
      if (abs.startsWith(root)) await fsp.unlink(abs);
    } catch {
      // File missing on disk — ignore; we still remove the row.
    }
  }

  db.prepare(`DELETE FROM task_attachments WHERE id = ?`).run(id);
  refreshTaskAttachmentCount(db, config, { appId, taskId: row.task_id });
  return { success: true };
}

/**
 * Cascade. Called from `deleteEntityRecord` (synchronous) when a Task
 * is permanently deleted — NOT when it's soft-deleted to Recently
 * Deleted, since the row needs to survive the 7-day undo window.
 *
 * Synchronous file unlinks: the caller is sync, and we want the files
 * to actually be gone by the time we return (otherwise rapid
 * create-then-delete cycles can leak disk). Each unlink is a fast
 * syscall; for the typical case of ≤10 attachments per task the total
 * blocking time is negligible.
 *
 * @param {any} db
 * @param {any} config
 * @param {{ appId: string, taskId: string }} args
 */
export function deleteAttachmentsForTask(db, config, { appId, taskId }) {
  const rows = db
    .prepare(`SELECT id, storage_path, thumb_path FROM task_attachments WHERE app_id = ? AND task_id = ?`)
    .all(appId, taskId);
  if (rows.length === 0) return;
  const root = attachmentsRoot(config);
  for (const row of rows) {
    for (const relPath of [row.storage_path, row.thumb_path]) {
      if (!relPath) continue;
      const abs = resolve(root, relPath);
      if (!abs.startsWith(root)) continue;
      try {
        unlinkSyncSafe(abs);
      } catch {
        // Missing file is fine — the row is still removed below.
      }
    }
  }
  db.prepare(`DELETE FROM task_attachments WHERE app_id = ? AND task_id = ?`).run(appId, taskId);
  // Also try to remove the now-empty per-task directory.
  if (rows.length) {
    const taskDir = dirname(resolve(root, rows[0].storage_path));
    try {
      rmSyncSafe(taskDir, { recursive: true, force: true });
    } catch {
      // Ignore — directory might already be gone or non-empty
    }
  }
}

/**
 * Aggregate storage stats for the user — total bytes used plus the
 * top-N tasks by total attachment size. Drives the Settings → Storage
 * sub-page.
 *
 * @param {any} db
 * @param {{ appId: string, user: any, limit?: number }} args
 */
export function getStorageOverview(db, { appId, user, limit = 10 }) {
  const usedBytes = getUserStorageBytes(db, { appId, userId: user.id });
  const biggest = db
    .prepare(
      `SELECT
         a.task_id,
         t.title AS task_title,
         SUM(a.size_bytes) AS total_bytes,
         COUNT(*) AS file_count
       FROM task_attachments a
       LEFT JOIN tasks t ON t.id = a.task_id AND t.app_id = a.app_id
       WHERE a.app_id = ? AND a.user_id = ?
       GROUP BY a.task_id
       ORDER BY total_bytes DESC
       LIMIT ?`
    )
    .all(appId, user.id, limit);
  return {
    used_bytes: usedBytes,
    max_bytes: MAX_TOTAL_BYTES_PER_USER,
    biggest_tasks: biggest.map((b) => ({
      task_id: b.task_id,
      task_title: b.task_title || "(deleted task)",
      total_bytes: Number(b.total_bytes || 0),
      file_count: Number(b.file_count || 0),
    })),
  };
}

/**
 * Stream a file to a response with the right headers. Async stat to
 * avoid blocking the event loop on slow disks.
 *
 * @param {import("node:http").ServerResponse} response
 * @param {string} absolutePath
 * @param {{ filename: string, mimeType: string }} meta
 * @param {{ asDownload?: boolean }} [opts]
 */
export async function sendAttachmentFile(response, absolutePath, meta, { asDownload = false } = {}) {
  let stat;
  try {
    stat = await fsp.stat(absolutePath);
  } catch {
    throw new HttpError(404, "Attachment file missing on disk.", "not_found");
  }
  response.setHeader("Content-Type", meta.mimeType || "application/octet-stream");
  response.setHeader("Content-Length", String(stat.size));
  // Cache for an hour — attachments are immutable (id-addressed) so we
  // could go higher, but auth cookies move quickly and we want the SW
  // not to cache anything personal indefinitely.
  response.setHeader("Cache-Control", "private, max-age=3600");
  const disposition = asDownload ? "attachment" : "inline";
  const safe = String(meta.filename || "file").replace(/"/g, "");
  response.setHeader("Content-Disposition", `${disposition}; filename="${safe}"`);
  response.writeHead(200);
  createReadStream(absolutePath).pipe(response);
}
