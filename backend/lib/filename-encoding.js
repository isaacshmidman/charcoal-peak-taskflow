// @ts-check
/**
 * @file Attachment names that were read with the wrong character set.
 *
 * A browser sends a multipart upload's `filename="…"` as raw UTF-8, and
 * busboy decodes it as latin1 unless told otherwise. Until the upload
 * parser said so, "Résumé.pdf" was stored as "RÃ©sumÃ©.pdf". This undoes
 * that for names already stored (a boot migration in db.js) and for names
 * in exports made before the fix (restore.js).
 *
 * Pure so it can be tested without a database.
 */

/**
 * The name as the uploader meant it, when `name` is UTF-8 that was read as
 * latin1 — or null to leave it alone. Only a name that decodes cleanly
 * changes: every character must fit in one byte, those bytes must be valid
 * UTF-8, and the result must differ. A correctly stored name practically
 * never passes (a real "é" is a single byte, which isn't UTF-8 on its own),
 * so running this over already-repaired names changes nothing.
 *
 * @param {unknown} name
 * @returns {string | null}
 */
export function repairLatin1Filename(name) {
  if (typeof name !== "string" || /[\u0100-\uffff]/.test(name)) return null;
  const bytes = Buffer.from(name, "latin1");
  const decoded = bytes.toString("utf8");
  if (decoded === name || decoded.includes("\ufffd")) return null;
  return Buffer.from(decoded, "utf8").equals(bytes) ? decoded : null;
}
