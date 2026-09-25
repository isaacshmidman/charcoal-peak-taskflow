// @ts-check
/**
 * @file Size limits for what clients may send. One place, so the numbers
 * can be read against each other and against what the UI can produce.
 *
 * Every number here sits far above anything the app itself writes — they
 * exist to stop a hostile or runaway client, not to shape normal use:
 *   - a task description is capped at 500 words in the editor, a note at
 *     5,000; even heavily formatted, a 5,000-word note's JSON is ~0.5 MB.
 *   - Google Calendar caps event descriptions at 8,192 characters.
 *
 * These apply to requests from the browser only. Calendar sync writes
 * through the store directly and is not held to them, so an unusually
 * long imported event can never stall a sync.
 */

/** Default JSON body cap: login, settings, push subscriptions, integrations. */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

/** Body cap for entity saves (tasks, notes, trash snapshots with subtasks). */
export const MAX_ENTITY_BODY_BYTES = 4 * 1024 * 1024;

/** Longest string allowed in any field not listed in FIELD_MAX_CHARS. */
export const DEFAULT_FIELD_MAX_CHARS = 2_000;

/** Per-field string caps, in characters. */
export const FIELD_MAX_CHARS = {
  name: 200,
  title: 2_000,
  description: 200_000,
  content_text: 200_000,
  description_json: 2_000_000,
  content_json: 2_000_000,
  // Recurring events carry every exception date in their RRULE/EXDATE.
  source_recurrence_rule: 100_000,
};

/** Array fields: most items allowed, and the cap on each string item. */
export const ARRAY_LIMITS = {
  tags: { maxItems: 100, maxItemChars: 100 },
  recurrence_days: { maxItems: 31 },
  subtasks: { maxItems: 500 },
};
