// @ts-check
/**
 * @file Test-only ZIP reader: parses an archive from its central directory,
 * checks every entry's local header and CRC, and returns the contents. Lets
 * the export tests prove the archive is valid without trusting the writer.
 */
import { crc32, inflateRawSync } from "node:zlib";

/**
 * @param {Buffer} zip
 * @returns {Map<string, Buffer>}
 */
export function readZip(zip) {
  const eocd = zip.length - 22;
  if (zip.readUInt32LE(eocd) !== 0x06054b50) throw new Error("no end-of-central-directory record");
  const count = zip.readUInt16LE(eocd + 10);
  const centralSize = zip.readUInt32LE(eocd + 12);
  let cursor = zip.readUInt32LE(eocd + 16);
  if (cursor + centralSize !== eocd) throw new Error("central directory is not where the end record says");

  /** @type {Map<string, Buffer>} */
  const files = new Map();
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error(`bad central header ${i}`);
    const method = zip.readUInt16LE(cursor + 10);
    const crc = zip.readUInt32LE(cursor + 16);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const size = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");

    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = zip.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    if (data.length !== size) throw new Error(`size mismatch for ${name}`);
    if ((crc32(data) >>> 0) !== crc) throw new Error(`CRC mismatch for ${name}`);
    files.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
