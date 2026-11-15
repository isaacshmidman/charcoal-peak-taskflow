// @ts-check
/**
 * @file When a list is "still loading", as a person would mean it.
 *
 * The app shows whatever copy of a list this device kept, at once, and asks
 * the server in the background (lib/query-client.js seeds the lists, marked
 * as old). On a device with no copy that seed is an empty list. So "has
 * data" is true from the first moment, and a page that only asked "is there
 * data?" showed "Nothing here" for the half second before the real list
 * arrived: an answer the app didn't have yet.
 *
 * A list is still loading when there is nothing to show AND the first real
 * answer hasn't come. A kept copy with rows in it is shown straight away.
 */

/**
 * @param {{ isLoading?: boolean, isFetching?: boolean, dataUpdatedAt?: number, data?: unknown }} query
 *   a TanStack query result
 * @returns {boolean}
 */
export function awaitingFirstAnswer(query) {
  if (query.isLoading) return true;
  if (!query.isFetching || query.dataUpdatedAt !== 0) return false;
  return !Array.isArray(query.data) || query.data.length === 0;
}

/**
 * What goes where a page's count will be ("6 tasks") until the count is
 * known: a blank that still takes the line, so the heading doesn't shift
 * when the number arrives. Never "0 tasks": that is a claim.
 */
export const NO_COUNT_YET = "\u00a0";
