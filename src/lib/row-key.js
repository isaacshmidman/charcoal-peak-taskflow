// @ts-check
/**
 * @file The React key for a row that may have been created optimistically.
 *
 * Optimistic creates insert a record with a temporary `offline_…` id and
 * then swap in the server's real id once it lands. Keying a list on `id`
 * alone means that swap looks like one row leaving and a different row
 * arriving — inside <AnimatePresence> that plays an exit AND an enter on
 * the same row, which is the stutter you see when undoing a delete.
 *
 * `_key` is stamped on the optimistic record and carried through the
 * swap, so the row keeps one identity across it.
 *
 * @param {{ _key?: string, id?: string } | null | undefined} record
 * @returns {string | undefined}
 */
export function rowKey(record) {
  return record?._key || record?.id;
}
