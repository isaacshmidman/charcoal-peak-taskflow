// @ts-check
/**
 * Plain Error + numeric statusCode property. Replaces the
 * `// @ts-expect-error` + `err.statusCode = X` pattern that pollutes
 * the provider modules.
 *
 * Callers check `err instanceof HttpStatusError` to decide whether to
 * retry / mark integration as needs_reauth / surface to user.
 */
export class HttpStatusError extends Error {
  /** @type {number} */
  statusCode;

  /**
   * @param {string} message
   * @param {number} statusCode
   */
  constructor(message, statusCode) {
    super(message);
    this.name = "HttpStatusError";
    this.statusCode = statusCode;
  }
}
