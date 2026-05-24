// @ts-check
/**
 * Server-side logging. Single funnel so future swaps to pino/winston touch
 * one file. For now wraps console.* with a `[zephyrly]` prefix + level.
 *
 * Usage: `import { log } from "./log.js"; log.warn("oops", err.message);`
 *
 * CLI scripts (backend/scripts/**, backend/import-base44-exports.js) keep
 * raw console.* on purpose — `console.log` IS their UX.
 */
const isProd = process.env.NODE_ENV === "production";

export const log = {
  /** @param {...unknown} args */
  info: (...args) => console.log("[zephyrly]", ...args),
  /** @param {...unknown} args */
  warn: (...args) => console.warn("[zephyrly]", ...args),
  /** @param {...unknown} args */
  error: (...args) => console.error("[zephyrly]", ...args),
  /** @param {...unknown} args */
  debug: (...args) => {
    if (!isProd) console.log("[zephyrly:debug]", ...args);
  },
};
