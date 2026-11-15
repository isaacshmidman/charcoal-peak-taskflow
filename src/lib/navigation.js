/**
 * The app's map. Five places in the sidebar; the board and the list of
 * finished tasks are two more ways of looking at Tasks, not places of
 * their own, so they sit behind a switch at the top of the Tasks page.
 */
export const VALID_NAV_ROUTES = ["/Home", "/Today", "/Calendar", "/Active", "/Notes"];

/** Where the app opens for someone who never chose a page. */
export const FALLBACK_ROUTE = "/Home";

export const DEFAULT_NAV_ORDER = [...VALID_NAV_ROUTES];

/** What each page is called, wherever it is named. */
export const NAV_LABELS = {
  "/Home": "Home",
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

/**
 * Tasks opens in whichever of its views the person chose (Settings →
 * Appearance), kept on this device like the rest of Appearance.
 */
export const TASKS_VIEW_KEY = "defaultTasksView";
export const TASKS_VIEW_OPTIONS = [
  { value: "list", label: "List", path: "/Active" },
  { value: "board", label: "Board", path: "/Groupings" },
  { value: "completed", label: "Completed", path: "/Completed" },
];

/** @param {unknown} value @returns {"list" | "board" | "completed"} */
export function sanitizeTasksView(value) {
  return /** @type {any} */ (TASKS_VIEW_OPTIONS.find((option) => option.value === value)?.value || "list");
}

/** A storage that may be missing or refuse (private windows): read as null. */
function read(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The page the app opens on, and the view Tasks opens in.
 *
 * The opening page used to be able to name the board or Completed
 * directly. Now it names a place, and Tasks has its own setting; an old
 * choice of "Tasks: board" reads as "Tasks, opening as the board" unless
 * a view has been chosen since.
 * @returns {{ start: string, tasksView: "list" | "board" | "completed" }}
 */
export function readStartSettings() {
  const saved = sanitizeNavRoute(read("defaultNav"));
  const start = navRouteFor(saved);
  const chosen = read(TASKS_VIEW_KEY);
  const fromOld = TASKS_VIEW_OPTIONS.find((option) => option.path === saved)?.value;
  return { start, tasksView: sanitizeTasksView(chosen || fromOld) };
}

/**
 * Keep a choice of opening page and of Tasks' view. The page is always
 * saved as a place, so an old "Tasks: board" is tidied the first time
 * either is changed. Tells the navigation so its links follow at once.
 * @param {{ start?: string, tasksView?: string }} change
 */
export function saveStartSettings(change) {
  const now = readStartSettings();
  const start = navRouteFor(sanitizeNavRoute(change.start ?? now.start));
  const tasksView = sanitizeTasksView(change.tasksView ?? now.tasksView);
  try {
    window.localStorage.setItem("defaultNav", start);
    window.localStorage.setItem(TASKS_VIEW_KEY, tasksView);
  } catch { /* storage refused: the choice lasts for this visit only */ }
  window.dispatchEvent(new Event("navOrderChanged"));
  return { start, tasksView };
}

/** The address of Tasks as the person set it to open. */
export function tasksPath() {
  const { tasksView } = readStartSettings();
  return TASKS_VIEW_OPTIONS.find((option) => option.value === tasksView)?.path || "/Active";
}

/**
 * Where a place in the navigation leads: itself, except Tasks, which
 * leads to the view it is set to open in.
 * @param {string} path
 */
export function placePath(path) {
  return path === "/Active" ? tasksPath() : path;
}

/**
 * Where a tag in the navigation leads from outside Tasks: the tag's open
 * tasks, on the board for someone who opens Tasks as the board and on
 * the list otherwise (a tag's count is of open tasks, so never Completed).
 */
export function tagsPath() {
  return tasksPath() === "/Groupings" ? "/Groupings" : "/Active";
}

/** The address the app opens on. */
export function startPath() {
  return placePath(readStartSettings().start);
}

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
  return typeof route === "string" && VALID_DEFAULT_ROUTES.includes(route) ? route : FALLBACK_ROUTE;
}

/**
 * @param {unknown} order
 */
export function sanitizeNavOrder(order) {
  /** @type {string[]} */
  const normalized = Array.isArray(order) ? order.filter((path) => VALID_NAV_ROUTES.includes(path)) : [];
  const deduped = [...new Set(normalized)];

  // A place added since the order was saved goes where it sits by
  // default: straight after the place it follows there (first, if it
  // leads). So Home, new in November 2026, arrives at the top of an
  // order saved before it existed rather than at the bottom.
  DEFAULT_NAV_ORDER.forEach((path, index) => {
    if (deduped.includes(path)) return;
    const after = index === 0 ? -1 : deduped.indexOf(DEFAULT_NAV_ORDER[index - 1]);
    deduped.splice(after + 1, 0, path);
  });

  return deduped;
}
