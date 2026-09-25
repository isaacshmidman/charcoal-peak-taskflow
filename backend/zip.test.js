/* @vitest-environment node */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planZip } from "./zip.js";
import { readZip } from "./test-support/readZip.js";

/** Run a plan into one Buffer, counting chunks. */
async function build(entries) {
  const plan = planZip(entries);
  const chunks = [];
  await plan.write(async (chunk) => { chunks.push(Buffer.from(chunk)); });
  return { plan, zip: Buffer.concat(chunks) };
}

const photo = Buffer.alloc(200_000);
for (let i = 0; i < photo.length; i += 1) photo[i] = (i * 7919) % 251; // incompressible-ish bytes

const entries = () => [
  { name: "export/README.txt", data: "Hello\r\n".repeat(50) },
  { name: "export/notes/Café ☕ plans.md", data: "# Café\n\nUTF-8 names survive.\n" },
  { name: "export/empty.txt", data: "" },
  { name: "export/attachments/Trip/photo.jpg", size: photo.length, read: async () => photo },
];

describe("planZip", () => {
  it("writes exactly the size it promised, and a reader gets every file back intact", async () => {
    const { plan, zip } = await build(entries());
    // The Content-Length the export sends is this number.
    expect(zip.length).toBe(plan.totalBytes);

    const files = readZip(zip);
    expect([...files.keys()]).toEqual(entries().map((e) => e.name));
    expect(files.get("export/README.txt").toString()).toBe("Hello\r\n".repeat(50));
    expect(files.get("export/notes/Café ☕ plans.md").toString()).toContain("UTF-8 names survive.");
    expect(files.get("export/empty.txt").length).toBe(0);
    expect(files.get("export/attachments/Trip/photo.jpg").equals(photo)).toBe(true);
  });

  it("compresses text", async () => {
    const { zip } = await build([{ name: "big.json", data: JSON.stringify({ rows: Array(2000).fill("same row") }) }]);
    expect(zip.length).toBeLessThan(2_000);
  });

  it("refuses to write a file whose size changed after the plan was made", async () => {
    const plan = planZip([{ name: "a.bin", size: 10, read: async () => Buffer.alloc(12) }]);
    await expect(plan.write(async () => {})).rejects.toThrow(/changed while exporting/);
  });

  it("is accepted by the system unzip, where there is one", async () => {
    let unzipAvailable = true;
    try { execFileSync("unzip", ["-v"], { stdio: "ignore" }); } catch { unzipAvailable = false; }
    if (!unzipAvailable) return;

    const { zip } = await build(entries());
    const dir = mkdtempSync(join(tmpdir(), "zip-test-"));
    try {
      const file = join(dir, "export.zip");
      writeFileSync(file, zip);
      const report = execFileSync("unzip", ["-t", file]).toString();
      expect(report).toContain("No errors detected");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
