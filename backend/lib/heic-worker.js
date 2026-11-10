// @ts-check
/**
 * @file Runs in a worker thread (see heic.js): decodes one HEIC/HEIF
 * image to raw RGBA pixels with libheif compiled to WebAssembly.
 *
 * It lives in a worker because the decode is a single long synchronous
 * call — on the main thread it would freeze every other request to the
 * server for as long as a photo takes.
 */
import { parentPort, workerData } from "node:worker_threads";
import decode from "heic-decode";

try {
  const { width, height, data } = await decode({ buffer: workerData });
  const pixels = /** @type {ArrayBuffer} */ (data.buffer);
  parentPort?.postMessage({ width, height, pixels }, [pixels]);
} catch (err) {
  parentPort?.postMessage({ error: /** @type {any} */ (err)?.message || "HEIC decode failed" });
}
