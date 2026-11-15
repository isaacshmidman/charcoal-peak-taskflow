// @ts-check
/**
 * @file Telling the server the app broke in this browser, so a blank
 * page on someone's phone is something the log knows about.
 *
 * It goes to the app's own server (backend/routes/client-errors.js) and
 * becomes a line in its log. No outside service, nothing stored.
 *
 * Quiet by design: a handful of reports per visit, the same error once,
 * nothing when offline, and a failure to report is never itself an error.
 * What is sent: what went wrong, where in the code, which page (the
 * address without its ?query, which can hold a tag or a search), and the
 * build. Never a task, a note, or anything typed.
 */
import { appConfig, getStoredAccessToken } from "@/lib/app-config";

const MOST_PER_VISIT = 5;
let sent = 0;
const seen = new Set();

/** For tests. */
export function resetErrorReports() {
  sent = 0;
  seen.clear();
}

/**
 * @param {"render" | "error" | "promise" | "chunk"} kind
 * @param {unknown} error
 * @returns {boolean} whether a report was sent
 */
export function reportError(kind, error) {
  try {
    const message = error instanceof Error ? error.message : String(error ?? "");
    const stack = error instanceof Error && typeof error.stack === "string" ? error.stack : "";
    const key = `${kind}:${message}`;
    if (!message || seen.has(key) || sent >= MOST_PER_VISIT) return false;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
    if (!appConfig.appId) return false;
    seen.add(key);
    sent += 1;
    const body = JSON.stringify({
      kind,
      message: message.slice(0, 300),
      stack: stack.split("\n").slice(0, 6).join("\n").slice(0, 1200),
      page: window.location.pathname.slice(0, 120),
      build: String(import.meta.env.VITE_BUILD_ID || import.meta.env.MODE || ""),
    });
    const url = `${appConfig.apiBaseUrl || ""}/api/apps/${encodeURIComponent(appConfig.appId)}/client-errors`;
    // Signed in the way the rest of the app is, so the log line can say
    // whose browser it was (the server reads that from the session).
    /** @type {Record<string, string>} */
    const headers = { "Content-Type": "application/json" };
    const token = getStoredAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    void fetch(url, { method: "POST", headers, body, credentials: "include", keepalive: true }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Hear about what React's error boundary never sees: an error in an
 * event handler or a timer, and a promise nobody caught.
 */
export function listenForErrors() {
  window.addEventListener("error", (event) => {
    // A script or image that failed to load fires this too, with no error.
    if (event.error) reportError("error", event.error);
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError("promise", event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
  });
}
