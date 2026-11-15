/**
 * The app's map. Four places in the sidebar; the board and the list of
 * finished tasks are two more ways of looking at Tasks, not places of
 * their own, so they sit behind a switch at the top of the Tasks page.
 */
export const VALID_NAV_ROUTES = ["/Today", "/Calendar", "/Active", "/Notes"];

export const DEFAULT_NAV_ORDER = [...VALID_NAV_ROUTES];

/** What each page is called, wherever it is named. */
export const NAV_LABELS = {
  "/Today": "Today",
  "/Calendar": "Calendar",
  "/Active": "Tasks",
  "/Notes": "Notes",
  "/Groupings": "Tasks: board",
  "/Completed": "Tasks: completed",
};

/** The three views of Tasks, in the order the switch shows them. */
export const TASK_VIEWS = [
  { path: "/Active", label: "List" },
  { path: "/Groupings", label: "Board" },
  { path: "/Completed", label: "Completed" },
];

/** Pages the app may open on: every place, and the two other task views. */
export const VALID_DEFAULT_ROUTES = [...VALID_NAV_ROUTES, "/Groupings", "/Completed"];

/**
 * The sidebar entry a page belongs to: the board and Completed light up
 * Tasks.
 * @param {string} pathname
 */
export function navRouteFor(pathname) {
  return TASK_VIEWS.some((view) => view.path === pathname) ? "/Active" : pathname;
}

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
  return typeof route === "string" && VALID_DEFAULT_ROUTES.includes(route) ? route : "/Today";
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
