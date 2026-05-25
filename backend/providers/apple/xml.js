// @ts-check
/**
 * @file Tiny XML helpers for CalDAV multistatus responses.
 *
 * We avoid pulling in a full XML library. CalDAV responses are very
 * regular: a <D:multistatus> envelope containing <D:response> children,
 * each with one <D:href> and one or more <D:propstat>/<D:prop> blocks.
 * The properties we care about are leaf values or single-token elements
 * (no mixed content), so a few targeted regexes are enough — and fast.
 */

/**
 * Iterate <D:response> blocks in a multistatus body. Yields raw inner text
 * for each.
 *
 * @param {string} xml
 * @returns {Array<{ raw: string }>}
 */
export function splitResponses(xml) {
  const out = [];
  // Match either D:response or unprefixed response; some servers omit the prefix.
  const re = /<([a-zA-Z][\w:-]*?:)?response\b[^>]*>([\s\S]*?)<\/\1?response>/g;
  let m;
  while ((m = re.exec(xml))) out.push({ raw: m[2] });
  return out;
}

/**
 * Pull the first text node of <{prefix}localName> from `xml`. Returns "" if
 * the element is missing or empty. Strips CDATA wrappers.
 */
export function pickText(xml, localName) {
  const re = new RegExp(`<(?:[a-zA-Z][\\w-]*:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z][\\w-]*:)?${localName}>`);
  const m = re.exec(xml);
  if (!m) return "";
  let inner = m[1];
  inner = inner.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // If the inner is itself an element (e.g. <D:href> inside current-user-principal),
  // return inner unchanged so the caller can call pickText again.
  return inner;
}

/** Pull href text from inside a property value (handles <D:href>…</D:href>). */
export function pickHref(xml) {
  const re = /<(?:[a-zA-Z][\w-]*:)?href\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z][\w-]*:)?href>/;
  const m = re.exec(xml);
  return m ? decodeXmlEntities(m[1].trim()) : "";
}

export function decodeXmlEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
