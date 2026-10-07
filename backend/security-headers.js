// @ts-check
/**
 * @file Browser protections sent with every response, and the Content
 * Security Policy for the app's page.
 *
 * The CSP matters most: the sign-in token is kept where the page's own
 * scripts can read it, so the page may only run scripts from this site
 * (plus the one small inline script in index.html that sets dark mode
 * before the app loads, allowed by its exact hash). Styles may be inline:
 * the note editor colours text with style attributes.
 *
 * One script reaches the browser that was never in the build: Cloudflare,
 * which zephyrly.app sits behind, adds its check for bots to every page on
 * the way. It is allowed by a nonce (see scriptNonce).
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

/**
 * Headers for every response.
 * @param {{ publicAppUrl?: string }} config
 * @returns {Array<[string, string]>}
 */
export function securityHeaders(config) {
  /** @type {Array<[string, string]>} */
  const headers = [
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), usb=(), payment=()"],
    ["Cross-Origin-Opener-Policy", "same-origin"],
  ];
  // Only over HTTPS: browsers then refuse plain HTTP to this site for a year.
  if (String(config.publicAppUrl || "").startsWith("https://")) headers.push(["Strict-Transport-Security", "max-age=31536000"]);
  return headers;
}

/**
 * sha256 hashes, in CSP form, of every inline <script> in a page.
 * @param {string} html
 */
export function inlineScriptHashes(html) {
  return [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (match) => `'sha256-${createHash("sha256").update(match[1], "utf8").digest("base64")}'`
  );
}

/**
 * A value made new for one response and sent only in that response's policy.
 * Cloudflare reads it there and puts it on the script it adds, which is how
 * the browser knows to run that one. Without it the browser refuses the
 * script and logs an error on every page. Nothing planted in a page can know
 * the value, so it lets nothing else in.
 */
export function scriptNonce() {
  // Hex: nothing but letters and digits for whatever copies it into a tag.
  return randomBytes(16).toString("hex");
}

/**
 * The policy for a page whose inline scripts have these hashes.
 * @param {string[]} hashes
 * @param {string} nonce  this response's (see scriptNonce), or "" for none
 */
function policy(hashes, nonce) {
  return [
    "default-src 'self'",
    ["script-src 'self'", ...hashes, ...(nonce ? [`'nonce-${nonce}'`] : [])].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * The policy for a page's HTML.
 * @param {string} html
 * @param {string} [nonce]  this response's (see scriptNonce)
 */
export function policyFor(html, nonce = "") {
  return policy(inlineScriptHashes(html), nonce);
}

/** @type {Map<string, { mtimeMs: number, hashes: string[] }>} */
const cache = new Map();

/**
 * The policy for an HTML file on disk. Its script hashes are worked out
 * again when the file changes (a new build); the nonce is the response's.
 * @param {string} filePath
 * @param {string} [nonce]  this response's (see scriptNonce)
 */
export function contentSecurityPolicy(filePath, nonce = "") {
  const { mtimeMs } = statSync(filePath);
  let cached = cache.get(filePath);
  if (!cached || cached.mtimeMs !== mtimeMs) {
    cached = { mtimeMs, hashes: inlineScriptHashes(readFileSync(filePath, "utf8")) };
    cache.set(filePath, cached);
  }
  return policy(cached.hashes, nonce);
}
