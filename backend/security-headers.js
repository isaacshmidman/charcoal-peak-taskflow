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
 */
import { createHash } from "node:crypto";
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
 * The policy for a page's HTML.
 * @param {string} html
 */
export function policyFor(html) {
  return [
    "default-src 'self'",
    ["script-src 'self'", ...inlineScriptHashes(html)].join(" "),
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

/** @type {Map<string, { mtimeMs: number, policy: string }>} */
const cache = new Map();

/**
 * The policy for an HTML file on disk, worked out again when it changes
 * (a new build).
 * @param {string} filePath
 */
export function contentSecurityPolicy(filePath) {
  const { mtimeMs } = statSync(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.policy;
  const policy = policyFor(readFileSync(filePath, "utf8"));
  cache.set(filePath, { mtimeMs, policy });
  return policy;
}
