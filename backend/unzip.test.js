/* @vitest-environment node */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { planZip } from "./zip.js";
import { openZip, ZipError } from "./unzip.js";

const dir = mkdtempSync(join(tmpdir(), "taskflow-unzip-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let counter = 0;
/** @param {Buffer} bytes */
function saved(bytes) {
  counter += 1;
  const path = join(dir, `${counter}.zip`);
  writeFileSync(path, bytes);
  return path;
}

async function writtenZip(entries) {
  const zip = planZip(entries);
  const chunks = [];
  await zip.write(async (chunk) => {
    chunks.push(chunk);
  });
  return Buffer.concat(chunks);
}

/**
 * A ZIP the way Finder / Archive Utility writes one: deflated, sizes and
 * CRC left out of the local header and given in a data descriptor after
 * the data, folder entries, and __MACOSX resource-fork files.
 *
 * @param {Array<{ name: string, data?: Buffer, flags?: number, method?: number, claimSize?: number }>} entries
 */
function finderZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = entry.data ?? Buffer.alloc(0);
    const method = entry.method ?? (entry.name.endsWith("/") ? 0 : 8);
    const payload = method === 8 ? deflateRawSync(raw) : raw;
    const crc = crc32(raw) >>> 0;
    const size = entry.claimSize ?? raw.length;
    const flags = (entry.flags ?? 0) | 0x0008;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(name.length, 26);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(payload.length, 8);
    descriptor.writeUInt32LE(size, 12);
    parts.push(local, name, payload, descriptor);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(0x0314, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(flags, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(payload.length, 20);
    head.writeUInt32LE(size, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);
    offset += 30 + name.length + payload.length + 16;
  }
  const centralDir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralDir, end]);
}

describe("openZip", () => {
  it("reads back exactly what zip.js wrote — text deflated, files stored", async () => {
    const photo = Buffer.alloc(5000, 7);
    const bytes = await writtenZip([
      { name: "export/data.json", data: JSON.stringify({ hello: "wörld", list: Array(200).fill("x") }) },
      { name: "export/attachments/Trip/photo.jpg", size: photo.length, read: async () => photo },
    ]);
    const zip = await openZip(saved(bytes));
    try {
      expect(zip.entries.map((e) => e.name)).toEqual(["export/data.json", "export/attachments/Trip/photo.jpg"]);
      const json = JSON.parse((await zip.read(zip.entries[0], 1_000_000)).toString("utf8"));
      expect(json.hello).toBe("wörld");
      expect((await zip.read(zip.entries[1], 1_000_000)).equals(photo)).toBe(true);
    } finally {
      await zip.close();
    }
  });

  it("reads a Finder-style archive and hides folders and __MACOSX clutter", async () => {
    const text = Buffer.from("A note\n".repeat(100));
    const zip = await openZip(
      saved(
        finderZip([
          { name: "zephyrly-export-2026-09-28/" },
          { name: "zephyrly-export-2026-09-28/data.json", data: text },
          { name: "__MACOSX/zephyrly-export-2026-09-28/._data.json", data: Buffer.from("resource fork") },
          { name: "zephyrly-export-2026-09-28/._README.txt", data: Buffer.from("apple double") },
        ])
      )
    );
    try {
      expect(zip.entries.map((e) => e.name)).toEqual(["zephyrly-export-2026-09-28/data.json"]);
      expect((await zip.read(zip.entries[0], 1_000_000)).equals(text)).toBe(true);
    } finally {
      await zip.close();
    }
  });

  it("refuses an entry over the caller's limit before reading it", async () => {
    const zip = await openZip(saved(finderZip([{ name: "big.bin", data: Buffer.alloc(2000) }])));
    try {
      await expect(zip.read(zip.entries[0], 1000)).rejects.toThrow(ZipError);
    } finally {
      await zip.close();
    }
  });

  it("won't inflate past the size an entry claims (a zip bomb)", async () => {
    // 10 MB of zeros deflates to ~10 KB; the directory claims 100 bytes.
    const zip = await openZip(saved(finderZip([{ name: "bomb.txt", data: Buffer.alloc(10_000_000), claimSize: 100 }])));
    try {
      await expect(zip.read(zip.entries[0], 1_000_000)).rejects.toThrow(/damaged/);
    } finally {
      await zip.close();
    }
  });

  it("catches contents that don't match their CRC", async () => {
    const bytes = await writtenZip([{ name: "a.txt", data: "short" }]);
    bytes[30 + "a.txt".length] ^= 0xff; // flip a byte of the stored data
    const zip = await openZip(saved(bytes));
    try {
      await expect(zip.read(zip.entries[0], 1000)).rejects.toThrow(/damaged/);
    } finally {
      await zip.close();
    }
  });

  it("refuses password-protected archives, and files that aren't ZIPs", async () => {
    await expect(openZip(saved(finderZip([{ name: "secret.txt", data: Buffer.from("x"), flags: 0x0001 }])))).rejects.toThrow(
      /password-protected/
    );
    await expect(openZip(saved(Buffer.from("{\"format\": \"not a zip\", \"padding\": \"...........\"}")))).rejects.toThrow(ZipError);
    await expect(openZip(saved(Buffer.alloc(3)))).rejects.toThrow(ZipError);
  });

  it("refuses a ZIP whose table of contents points outside the file", async () => {
    const bytes = await writtenZip([{ name: "a.txt", data: "hello" }]);
    bytes.writeUInt32LE(0x7fffffff, bytes.length - 22 + 16); // central directory offset
    await expect(openZip(saved(bytes))).rejects.toThrow(/damaged/);
  });
});
