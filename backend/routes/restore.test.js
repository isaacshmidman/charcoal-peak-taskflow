/* @vitest-environment node */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { saveUploadToFile } from "./restore.js";

const dir = mkdtempSync(join(tmpdir(), "taskflow-restore-upload-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const BOUNDARY = "----restore-upload-test";
function request(fileBytes) {
  const body = Buffer.concat([
    Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="export.zip"\r\nContent-Type: application/zip\r\n\r\n`),
    fileBytes,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
  const req = /** @type {any} */ (Readable.from([body]));
  req.headers = { "content-type": `multipart/form-data; boundary=${BOUNDARY}` };
  return req;
}

describe("saveUploadToFile", () => {
  it("streams the upload to disk intact", async () => {
    const bytes = Buffer.alloc(300_000, 3);
    const path = join(dir, "ok.upload");
    await expect(saveUploadToFile(request(bytes), path, 1_000_000)).resolves.toBe(true);
    expect(readFileSync(path).equals(bytes)).toBe(true);
  });

  it("refuses an upload over the limit with a 413", async () => {
    const path = join(dir, "big.upload");
    await expect(saveUploadToFile(request(Buffer.alloc(5000)), path, 1000)).rejects.toMatchObject({ status: 413 });
  });

  it("reports no file when the form has none", async () => {
    const req = /** @type {any} */ (Readable.from([Buffer.from(`--${BOUNDARY}--\r\n`)]));
    req.headers = { "content-type": `multipart/form-data; boundary=${BOUNDARY}` };
    const path = join(dir, "none.upload");
    await expect(saveUploadToFile(req, path, 1000)).resolves.toBe(false);
    expect(existsSync(path)).toBe(false);
  });
});
