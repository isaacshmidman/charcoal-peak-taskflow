// @ts-check
/**
 * @file Link rules for the rich-text editor, kept pure so they can be
 * tested without an editor.
 *
 * Links were switched off entirely for fear of hostile hrefs — descriptions
 * include text other people wrote (calendar invites). That fear is answered
 * here instead: the only links that exist are absolute http, https and
 * mailto URLs. Everything else (javascript:, data:, relative paths, tel:,
 * ftp: …) never becomes a link, and a stored href is re-checked each time
 * it is drawn or opened, so a hand-crafted document can't slip one in.
 */
import { find } from "linkifyjs";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** "zoom.us/j/1", "www.example.com" — a domain with no scheme. */
const BARE_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(?:[/?#:]|$)/i;
/** "someone@example.com" with no scheme. */
const BARE_EMAIL_RE = /^[^\s@/:]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/**
 * The href as a safe absolute URL, or null. Only http, https and mailto
 * pass, and http(s) must have a host.
 *
 * @param {unknown} href
 * @returns {string | null}
 */
export function safeHref(href) {
  if (typeof href !== "string") return null;
  const trimmed = href.trim();
  // Only absolute URLs: a relative "/foo" would resolve against the app.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  if (url.protocol !== "mailto:" && !url.hostname) return null;
  return url.href;
}

/**
 * What someone typed or pasted as a link, as a safe href: adds https:// to
 * a bare domain and mailto: to a bare email address. Null if it isn't a
 * web address or email.
 *
 * @param {unknown} text
 * @returns {string | null}
 */
export function normalizeLinkInput(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (BARE_EMAIL_RE.test(trimmed)) return safeHref(`mailto:${trimmed}`);
  if (BARE_DOMAIN_RE.test(trimmed)) return safeHref(`https://${trimmed}`);
  return safeHref(trimmed);
}

/**
 * Whether the editor may make this a link. Called by the Link extension
 * for pasted HTML, setLink, and autolink — which passes what was typed
 * ("zoom.us/j/1"), before a scheme is added.
 *
 * @param {unknown} url
 * @returns {boolean}
 */
export function isAllowedLink(url) {
  return normalizeLinkInput(url) != null;
}

/**
 * Whether text should become a link on its own, as it's typed, pasted or
 * found in old text. Only unmistakable addresses: a scheme ("https://…"),
 * "www.", an email, or a domain with a path ("zoom.us/j/1"). A bare
 * "name.ext" is left alone — .md, .py, .sh, .rs, .mov and .zip are all
 * real domains, so "notes.md" or "setup.sh" would otherwise link to a
 * stranger's website. Anything else can still be linked on purpose (⌘K).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function shouldAutoLink(value) {
  if (!isAllowedLink(value)) return false;
  const text = String(value).trim();
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(text) ||
    /^www\./i.test(text) ||
    BARE_EMAIL_RE.test(text) ||
    /^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S/i.test(text)
  );
}

/**
 * A short, honest label for where a link goes: host and path without the
 * scheme, or the address of a mailto. Shown in the link bar so the real
 * destination is visible whatever the link's text says.
 *
 * @param {string} href
 * @param {number} [max]
 * @returns {string}
 */
export function linkLabel(href, max = 48) {
  const safe = safeHref(href);
  if (!safe) return "";
  const url = new URL(safe);
  const label =
    url.protocol === "mailto:"
      ? decodeURIComponent(url.pathname)
      : `${url.host}${url.pathname === "/" ? "" : url.pathname}${url.search}`;
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/**
 * Open a link in a new tab with no reference back to this app. Re-checks
 * the href: whatever reaches here must still be http, https or mailto.
 *
 * @param {unknown} href
 * @returns {boolean} whether anything was opened
 */
export function openLink(href) {
  const safe = safeHref(href);
  if (!safe) return false;
  window.open(safe, "_blank", "noopener,noreferrer");
  return true;
}

/**
 * Ranges of plain URLs in a document that aren't links yet: text that
 * arrived before links existed, or plain-text calendar descriptions. Same
 * rule as typing (shouldAutoLink), so old text links exactly as new text
 * would.
 *
 * @param {import("@tiptap/pm/model").Node} doc
 * @returns {Array<{ from: number, to: number, href: string }>}
 */
export function unlinkedUrlRanges(doc) {
  /** @type {Array<{ from: number, to: number, href: string }>} */
  const ranges = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return;
    if (parent?.type.spec.code) return;
    if (node.marks.some((mark) => mark.type.name === "link" || mark.type.spec.code)) return;
    for (const match of find(node.text, { defaultProtocol: "https" })) {
      if (!match.isLink || !shouldAutoLink(match.value)) continue;
      const href = normalizeLinkInput(match.type === "email" ? match.value : match.href);
      if (!href) continue;
      ranges.push({ from: pos + match.start, to: pos + match.end, href });
    }
  });
  return ranges;
}
