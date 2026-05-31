// @ts-nocheck
/* @vitest-environment node */
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { parseMultipart } from "./multipart.js";

/**
 * Build a fake IncomingMessage-shaped request from a Buffer body + a
 * Content-Type header. Just enough surface for parseMultipart.
 */
function fakeRequest(body, contentType) {
  const stream = Readable.from(body);
  stream.headers = { "content-type": contentType };
  return stream;
}

/**
 * Assemble a multipart body the same way a browser FormData submission
 * does — opening boundary, headers, CRLFs, body, ..., closing boundary.
 */
function buildMultipartBody(boundary, parts) {
  const out = [];
  for (const p of parts) {
    out.push(Buffer.from(`--${boundary}\r\n`));
    const headers = [`Content-Disposition: form-data; name="${p.name}"`];
    if (p.filename) headers[0] += `; filename="${p.filename}"`;
    if (p.contentType) headers.push(`Content-Type: ${p.contentType}`);
    out.push(Buffer.from(headers.join("\r\n") + "\r\n\r\n"));
    out.push(Buffer.isBuffer(p.body) ? p.body : Buffer.from(p.body));
    out.push(Buffer.from("\r\n"));
  }
  out.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(out),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("parseMultipart", () => {
  it("parses a single file part with text content unchanged", async () => {
    const { body, contentType } = buildMultipartBody("BOUNDARY123", [
      { name: "file", filename: "hello.txt", contentType: "text/plain", body: "hello world" },
    ]);
    const req = fakeRequest(body, contentType);
    const { fields, file } = await parseMultipart(req, { maxBytes: 1024 });
    expect(fields).toEqual({});
    expect(file).not.toBeNull();
    expect(file.fieldName).toBe("file");
    expect(file.filename).toBe("hello.txt");
    expect(file.mimeType).toBe("text/plain");
    expect(file.data.toString("utf8")).toBe("hello world");
  });

  it("preserves binary file bytes byte-for-byte (the previous parser was eating 2 bytes)", async () => {
    // Spot-check JPG magic bytes + a tail that would have been chopped
    // by an off-by-2 slice. Catches the regression that made screenshot
    // uploads silently corrupt.
    const original = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x00, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
      // Trailing 4 bytes — the old parser would have lost two of these.
      0xDE, 0xAD, 0xBE, 0xEF,
    ]);
    const { body, contentType } = buildMultipartBody("WebKitFormBoundaryXY", [
      { name: "file", filename: "screenshot.jpg", contentType: "image/jpeg", body: original },
    ]);
    const req = fakeRequest(body, contentType);
    const { file } = await parseMultipart(req, { maxBytes: 1024 });
    expect(file.data.length).toBe(original.length);
    expect(file.data.equals(original)).toBe(true);
  });

  it("parses mixed text fields + a file in the same body", async () => {
    const { body, contentType } = buildMultipartBody("BOUNDARY", [
      { name: "subject", body: "Demo" },
      { name: "file", filename: "doc.pdf", contentType: "application/pdf", body: "%PDF-1.4\n" },
    ]);
    const req = fakeRequest(body, contentType);
    const { fields, file } = await parseMultipart(req, { maxBytes: 1024 });
    expect(fields.subject).toBe("Demo");
    expect(file.filename).toBe("doc.pdf");
    expect(file.data.toString("utf8")).toBe("%PDF-1.4\n");
  });

  it("rejects when Content-Type lacks a boundary", async () => {
    const req = fakeRequest(Buffer.from("x"), "multipart/form-data");
    await expect(parseMultipart(req, { maxBytes: 1024 })).rejects.toThrow(/boundary/i);
  });

  it("rejects when the body exceeds maxBytes", async () => {
    const { body, contentType } = buildMultipartBody("B", [
      { name: "file", filename: "big.bin", contentType: "application/octet-stream", body: Buffer.alloc(2048) },
    ]);
    const req = fakeRequest(body, contentType);
    await expect(parseMultipart(req, { maxBytes: 512 })).rejects.toThrow(/exceeds/i);
  });
});
