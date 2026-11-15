// @ts-check
/**
 * @file A page whose code is fetched when it is first needed, so opening
 * the app doesn't download the calendar, the note editor's page and
 * Settings before showing Today.
 *
 *   const Calendar = lazyPage(() => import("@/pages/Calendar.jsx"));
 *   Calendar.preload();   // fetch it now, quietly (App does this when idle)
 *
 * One thing can go wrong that an ordinary import can't: after a deploy,
 * an app that was already open still names the old build's files, and
 * those are gone. The first failure reloads the page once, which picks
 * up the new build; a second failure in the same visit is a real one
 * (offline with nothing kept, say) and is thrown for the error screen.
 */
import { createElement } from "react";

const RELOADED_KEY = "zephyrly:reloaded-for-new-build";

/** Whether an error is "that file of code could not be fetched". */
export function isChunkLoadError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /dynamically imported module|Importing a module script failed|Failed to fetch|Loading chunk|Unable to preload/i.test(message);
}

/**
 * @template {import("react").ComponentType<any>} T
 * @param {() => Promise<{ default: T }>} load
 * @param {{ reload?: () => void, storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> }} [how]  for tests
 */
export function lazyPage(load, how = {}) {
  const storage = () => {
    try { return how.storage || window.sessionStorage; } catch { return null; }
  };
  /** @type {Promise<{ default: T }> | null} */
  let loading = null;
  const loadOnce = () => {
    if (!loading) {
      loading = load().then(
        (page) => {
          try { storage()?.removeItem(RELOADED_KEY); } catch { /* nothing to clear */ }
          return page;
        },
        (error) => {
          loading = null; // let a later try fetch again
          let reloadedAlready = true;
          try { reloadedAlready = !storage() || storage()?.getItem(RELOADED_KEY) === "1"; } catch { /* treat as already tried */ }
          const online = typeof navigator === "undefined" || navigator.onLine !== false;
          if (isChunkLoadError(error) && !reloadedAlready && online) {
            try { storage()?.setItem(RELOADED_KEY, "1"); } catch { /* reload anyway */ }
            (how.reload || (() => window.location.reload()))();
            // The page is on its way out: never settle, so no error flashes first.
            return new Promise(() => {});
          }
          throw error;
        },
      );
    }
    return loading;
  };
  // What the page draws from. Not React.lazy: that remembers a failed
  // fetch for good, and "Try again" must really try again.
  /** @type {{ status: "pending" | "ready" | "failed", promise?: Promise<void>, page?: T, error?: unknown } | null} */
  let record = null;
  const start = () => {
    /** @type {NonNullable<typeof record>} */
    const next = { status: "pending" };
    next.promise = loadOnce().then(
      (module) => { next.status = "ready"; next.page = module.default; },
      (error) => { next.status = "failed"; next.error = error; },
    );
    return next;
  };
  /** @param {any} props */
  function Page(props) {
    if (!record) record = start();
    const now = record;
    if (now.status === "ready") return createElement(/** @type {any} */ (now.page), props);
    // Still arriving: the nearest Suspense shows its outline until it lands.
    if (now.status === "pending") throw now.promise;
    // Failed: the error screen gets it, and once it has, the next draw
    // ("Try again", or coming back to the page) starts a new fetch.
    setTimeout(() => { if (record === now) record = null; }, 0);
    throw now.error;
  }
  // Fetching ahead of need never reloads the page or shows an error.
  Page.preload = () => load().catch(() => {});
  return /** @type {import("react").ComponentType<any> & { preload: () => Promise<unknown> }} */ (Page);
}
