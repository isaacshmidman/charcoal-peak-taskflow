// @ts-check
/**
 * @file A small streaming ZIP writer — just enough for the data export.
 *
 * Why not a library: the format needed here is tiny (no encryption, no
 * ZIP64, no appending) and Node ships the two hard parts, CRC-32 and
 * raw deflate, in node:zlib.
 *
 * Layout is fixed before a byte is written, so the total size is known
 * up front and the response can carry a Content-Length (a real progress
 * bar for a large download). Text entries are deflated in memory as the
 * plan is made; files are stored uncompressed (attachments are mostly
 * JPEGs and PDFs, already compressed) and read one at a time as they're
 * written, so memory holds at most one file — each is capped at 25 MB.
 *
 * Limits: classic ZIP tops out at 65,535 entries and 4 GiB. A user's
 * attachments are capped at 1 GB, so neither can be reached; plan()
 * still refuses rather than write a corrupt archive.
 */
import { crc32, deflateRawSync } from "node:zlib";

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIR = 0x06054b50;
const FLAG_UTF8_NAMES = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const VERSION = 20; // 2.0: deflate and folders
const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

/**
 * @typedef {{ name: string, data: Buffer | string, date?: Date }} TextEntry
 * @typedef {{ name: string, size: number, read: () => Promise<Buffer>, date?: Date }} FileEntry
 * @typedef {TextEntry | FileEntry} ZipEntry
 */

/**
 * MS-DOS date and time, as ZIP stores them (local time, 2-second steps).
 * @param {Date} date
 */
function dosDateTime(date) {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * @param {number} signature
 * @param {Array<[number, 2 | 4]>} fields  value and byte width, in order
 * @param {Buffer} name
 */
function header(signature, fields, name) {
  const size = 4 + fields.reduce((sum, [, width]) => sum + width, 0);
  const buffer = Buffer.alloc(size + name.length);
  let offset = 0;
  buffer.writeUInt32LE(signature, offset);
  offset += 4;
  for (const [value, width] of fields) {
    if (width === 2) buffer.writeUInt16LE(value, offset);
    else buffer.writeUInt32LE(value >>> 0, offset);
    offset += width;
  }
  name.copy(buffer, offset);
  return buffer;
}

/**
 * Lay out an archive. Returns its exact size and a writer that emits it
 * through `sink` — an async function that resolves once a chunk is
 * accepted, so a slow client applies backpressure.
 *
 * @param {ZipEntry[]} entries
 * @returns {{ totalBytes: number, write: (sink: (chunk: Buffer) => Promise<void>) => Promise<void> }}
 */
export function planZip(entries) {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`Too many files for a ZIP archive (${entries.length}).`);
  }

  const now = new Date();
  const planned = entries.map((entry) => {
    const name = Buffer.from(entry.name, "utf8");
    const stamp = dosDateTime(entry.date || now);
    if ("read" in entry) {
      return { name, stamp, method: METHOD_STORE, size: entry.size, compressedSize: entry.size, read: entry.read };
    }
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const deflated = deflateRawSync(raw);
    // Tiny or incompressible text can come out bigger; store it then.
    const useDeflate = deflated.length < raw.length;
    return {
      name,
      stamp,
      method: useDeflate ? METHOD_DEFLATE : METHOD_STORE,
      size: raw.length,
      compressedSize: useDeflate ? deflated.length : raw.length,
      crc: crc32(raw),
      payload: useDeflate ? deflated : raw,
    };
  });

  const localBytes = planned.reduce((sum, p) => sum + 30 + p.name.length + p.compressedSize, 0);
  const centralBytes = planned.reduce((sum, p) => sum + 46 + p.name.length, 0);
  const totalBytes = localBytes + centralBytes + 22;
  if (totalBytes > MAX_BYTES) {
    throw new Error("Export is larger than a ZIP archive can hold (4 GiB).");
  }

  return {
    totalBytes,
    async write(sink) {
      /** @type {Buffer[]} */
      const central = [];
      let offset = 0;
      for (const p of planned) {
        let payload = p.payload;
        let crc = p.crc;
        if (p.read) {
          payload = await p.read();
          // The size is already promised in the layout (and Content-Length);
          // a file that changed underneath must not produce a broken archive.
          if (payload.length !== p.size) {
            throw new Error(`File changed while exporting: ${p.name.toString("utf8")}`);
          }
          crc = crc32(payload);
        }
        const common = /** @type {Array<[number, 2 | 4]>} */ ([
          [FLAG_UTF8_NAMES, 2],
          [p.method, 2],
          [p.stamp.time, 2],
          [p.stamp.date, 2],
          [crc, 4],
          [p.compressedSize, 4],
          [p.size, 4],
          [p.name.length, 2],
          [0, 2], // extra field length
        ]);
        await sink(header(LOCAL_HEADER, [[VERSION, 2], ...common], p.name));
        await sink(payload);
        central.push(
          header(
            CENTRAL_HEADER,
            [
              [VERSION, 2], // made by
              [VERSION, 2], // needed to extract
              ...common,
              [0, 2], // comment length
              [0, 2], // disk number
              [0, 2], // internal attributes
              [0, 4], // external attributes
              [offset, 4],
            ],
            p.name
          )
        );
        offset += 30 + p.name.length + p.compressedSize;
      }
      const centralDirectory = Buffer.concat(central);
      await sink(centralDirectory);
      await sink(
        header(
          END_OF_CENTRAL_DIR,
          [
            [0, 2], // this disk
            [0, 2], // disk with the central directory
            [planned.length, 2],
            [planned.length, 2],
            [centralDirectory.length, 4],
            [offset, 4],
            [0, 2], // comment length
          ],
          Buffer.alloc(0)
        )
      );
    },
  };
}
