// @ts-check
/**
 * Browser-side logging. Single funnel so a future swap to Sentry / a remote
 * sink touches one file. Wraps console.warn/error with a `[zephyrly]` prefix.
 *
 * Only `warn` and `error` are exposed — `info`/`debug` are intentionally
 * absent so devs don't spam the user console. If you need a one-off
 * debug log during development, use console.* directly and remove before
 * committing.
 */
export const logger = {
  /** @param {...unknown} args */
  warn: (...args) => console.warn("[zephyrly]", ...args),
  /** @param {...unknown} args */
  error: (...args) => console.error("[zephyrly]", ...args),
};
