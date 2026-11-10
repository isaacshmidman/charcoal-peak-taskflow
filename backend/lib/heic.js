// @ts-check
/**
 * @file HEIC/HEIF → JPEG without a system codec.
 *
 * Why this exists: sharp's bundled image library reads AVIF but NOT
 * HEIC — the HEVC decoder is left out of its prebuilt binaries for
 * patent reasons ("Support for this compression format has not been
 * built in"). The Docker image installs Debian's libvips and libheif,
 * but sharp never uses them: it would have to be compiled against them,
 * and Debian's libvips is older than sharp accepts. So in production a
 * HEIC photo was stored as-is, and showed no preview in any browser but
 * Safari.
 *
 * This decodes with libheif compiled to WebAssembly (heic-decode), in a
 * worker thread so the server keeps answering, one photo at a time so a
 * batch of uploads can't pile up decoders on a small machine. sharp
 * then encodes the pixels as JPEG.
 */
import { Worker } from "node:worker_threads";
import sharp from "sharp";

const WORKER_URL = new URL("./heic-worker.js", import.meta.url);
/** A 48-megapixel photo on a slow CPU fits well inside this. */
const DECODE_TIMEOUT_MS = 90_000;

/** One decode at a time: each waits for the one before it. */
let queue = Promise.resolve();

/**
 * @param {Buffer} buffer
 * @returns {Promise<{ width: number, height: number, pixels: ArrayBuffer }>}
 */
function decodeInWorker(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { workerData: buffer });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("HEIC decode timed out"));
    }, DECODE_TIMEOUT_MS);
    const finish = (/** @type {() => void} */ settle) => {
      clearTimeout(timer);
      void worker.terminate();
      settle();
    };
    worker.once("message", (message) =>
      finish(() => (message?.error ? reject(new Error(message.error)) : resolve(message)))
    );
    worker.once("error", (err) => finish(() => reject(err)));
    worker.once("exit", (code) => {
      // Reached only if the worker died without a word.
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`HEIC decoder exited with code ${code}`));
    });
  });
}

/**
 * Convert a HEIC/HEIF image to a JPEG. Rotation stored in the file is
 * applied by the decoder, so the JPEG comes out the right way up.
 *
 * @param {Buffer} buffer
 * @param {{ quality?: number }} [options]
 * @returns {Promise<Buffer>}
 */
export function heicToJpeg(buffer, { quality = 90 } = {}) {
  const run = async () => {
    const { width, height, pixels } = await decodeInWorker(buffer);
    return sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } })
      // JPEG has no transparency; a see-through HEIC lands on white.
      .flatten({ background: "#ffffff" })
      .jpeg({ quality })
      .toBuffer();
  };
  // Chain onto the queue whether the previous decode worked or not.
  const result = queue.then(run, run);
  queue = result.then(() => {}, () => {});
  return result;
}
