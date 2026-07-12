export const VALID_NAV_ROUTES = ["/Today", "/Groupings", "/Calendar", "/Active", "/Completed", "/Notes"];

export const DEFAULT_NAV_ORDER = [...VALID_NAV_ROUTES];

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
