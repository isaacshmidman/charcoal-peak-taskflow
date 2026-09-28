// @ts-check
/**
 * @file A small ZIP reader for restoring an export — the other half of
 * zip.js, and just as narrow.
 *
 * It reads from a file on disk, never the whole archive into memory: the
 * central directory first (the table of contents at the end), then each
 * entry only when asked for, capped by the caller. That handles the
 * export as Zephyrly wrote it and the same folder re-zipped by Finder,
 * Windows or `zip` (deflate, sizes in a data descriptor, __MACOSX
 * clutter).
 *
 * Refused rather than half-read: encrypted entries, ZIP64 (archives over
 * 4 GiB or 65,535 entries — an export can't be either), multi-disk
 * archives, and any entry whose contents don't match its recorded size
 * and CRC.
 */
import { promises as fsp } from "node:fs";
import { crc32, inflateRawSync } from "node:zlib";

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIR = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const FLAG_ENCRYPTED = 0x0001;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const MAX_CENTRAL_DIR_BYTES = 16 * 1024 * 1024;

export class ZipError extends Error {}

/**
 * @typedef {{
 *   name: string,
 *   method: number,
 *   encrypted: boolean,
 *   crc: number,
 *   compressedSize: number,
 *   size: number,
 *   localOffset: number,
 * }} ZipDirectoryEntry
 */

/**
 * @param {import("node:fs/promises").FileHandle} handle
 * @param {number} position
 * @param {number} length
 */
async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new ZipError("The file ends early — it may not have finished downloading.");
  return buffer;
}

/**
 * Open an archive and read its table of contents.
 *
 * @param {string} path
 */
export async function openZip(path) {
  const handle = await fsp.open(path, "r");
  try {
    const { size: fileSize } = await handle.stat();
    if (fileSize < EOCD_SIZE) throw new ZipError("This isn't a ZIP file.");

    // The end record sits in the last 22 bytes, or further back if the
    // archive has a comment.
    const tailLength = Math.min(fileSize, EOCD_SIZE + MAX_COMMENT);
    const tailStart = fileSize - tailLength;
    const tail = await readAt(handle, tailStart, tailLength);
    let eocd = -1;
    for (let i = tail.length - EOCD_SIZE; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === END_OF_CENTRAL_DIR && i + EOCD_SIZE + tail.readUInt16LE(i + 20) <= tail.length) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipError("This isn't a ZIP file.");
    if (eocd >= 20 && tail.readUInt32LE(eocd - 20) === ZIP64_LOCATOR) {
      throw new ZipError("This archive uses ZIP64, which an export never needs.");
    }

    const disk = tail.readUInt16LE(eocd + 4);
    const centralDisk = tail.readUInt16LE(eocd + 6);
    const count = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (disk !== 0 || centralDisk !== 0) throw new ZipError("Split (multi-part) archives aren't supported.");
    if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new ZipError("This archive uses ZIP64, which an export never needs.");
    }
    if (centralSize > MAX_CENTRAL_DIR_BYTES || centralOffset + centralSize > tailStart + eocd) {
      throw new ZipError("This ZIP file is damaged.");
    }

    const central = await readAt(handle, centralOffset, centralSize);
    /** @type {ZipDirectoryEntry[]} */
    const entries = [];
    let cursor = 0;
    for (let i = 0; i < count; i += 1) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== CENTRAL_HEADER) {
        throw new ZipError("This ZIP file is damaged.");
      }
      const flags = central.readUInt16LE(cursor + 8);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);
      const nameBytes = central.subarray(cursor + 46, cursor + 46 + nameLength);
      entries.push({
        // Names without the UTF-8 flag are nominally CP437, but every
        // tool that zips an export writes UTF-8 anyway.
        name: nameBytes.toString("utf8"),
        method: central.readUInt16LE(cursor + 10),
        encrypted: Boolean(flags & FLAG_ENCRYPTED),
        crc: central.readUInt32LE(cursor + 16),
        compressedSize: central.readUInt32LE(cursor + 20),
        size: central.readUInt32LE(cursor + 24),
        localOffset: central.readUInt32LE(cursor + 42),
      });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    if (entries.some((entry) => entry.encrypted)) {
      throw new ZipError("This archive is password-protected. Use the export exactly as it was downloaded.");
    }

    return {
      /** Files only (no folders), without macOS resource-fork clutter. */
      entries: entries.filter(
        (entry) => !entry.name.endsWith("/") && !entry.name.startsWith("__MACOSX/") && !/(^|\/)\._/.test(entry.name)
      ),

      /**
       * One entry's contents, checked against its size and CRC. Refuses
       * anything larger than `maxBytes` before reading it.
       *
       * @param {ZipDirectoryEntry} entry
       * @param {number} maxBytes
       */
      async read(entry, maxBytes) {
        if (entry.size > maxBytes) throw new ZipError(`${entry.name} is too large.`);
        if (entry.method !== METHOD_STORE && entry.method !== METHOD_DEFLATE) {
          throw new ZipError(`${entry.name} uses a compression method this can't read.`);
        }
        // Deflate can't meaningfully grow data; a compressed size far past
        // the stated one means the directory is lying.
        if (entry.compressedSize > entry.size + 1024 * 64 + entry.size / 100) {
          throw new ZipError("This ZIP file is damaged.");
        }
        const local = await readAt(handle, entry.localOffset, 30);
        if (local.readUInt32LE(0) !== LOCAL_HEADER) throw new ZipError("This ZIP file is damaged.");
        const dataStart = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
        const raw = await readAt(handle, dataStart, entry.compressedSize);
        let data;
        if (entry.method === METHOD_STORE) {
          data = raw;
        } else {
          try {
            // Capped, so a small entry claiming a small size can't
            // inflate into gigabytes.
            data = inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.size) });
          } catch {
            throw new ZipError(`${entry.name} is damaged.`);
          }
        }
        if (data.length !== entry.size || (crc32(data) >>> 0) !== entry.crc) {
          throw new ZipError(`${entry.name} is damaged.`);
        }
        return data;
      },

      close: () => handle.close(),
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
