export const VALID_NAV_ROUTES = ["/Today", "/Groupings", "/Calendar", "/Active", "/Completed", "/Notes"];

export const DEFAULT_NAV_ORDER = [...VALID_NAV_ROUTES];

/**
 * A path inside the app taken from a link's next= value, or null. Only
 * this site's own pages, and never a path the router would read as
 * another site: "//evil.com" (or "/\\evil.com", which URLs turn into it)
 * would send someone already signed in straight to a look-alike page.
 * @param {unknown} raw
 * @param {string} [origin]
 * @returns {string | null}
 */
export function safeInAppPath(raw, origin = window.location.origin) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return null;
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null;
    return path;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} route
 */
export function sanitizeNavRoute(route) {
  return typeof route === "string" && VALID_NAV_ROUTES.includes(route) ? route : "/Today";
}

/**
 * @param {unknown} order
 */
export function sanitizeNavOrder(order) {
  /** @type {string[]} */
  const normalized = Array.isArray(order) ? order.filter((path) => VALID_NAV_ROUTES.includes(path)) : [];
  const deduped = [...new Set(normalized)];

  for (const path of DEFAULT_NAV_ORDER) {
    if (!deduped.includes(path)) {
      deduped.push(path);
    }
  }

  return deduped;
}
