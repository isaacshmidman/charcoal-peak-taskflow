// @ts-check
/**
 * @file Checks a tool call's arguments against the tool's own input schema
 * — the JSON Schema the AI app was shown — so what's advertised and what's
 * accepted can't drift apart. Covers the small subset the tools use.
 *
 * Deliberately a little forgiving about shape, because small local models
 * slip: "3" for 3, "true" for true, a single string where a list goes.
 * Never forgiving about content: unknown arguments, bad dates and values
 * outside an enum are refused with a message the model can act on.
 */

/** A refusal or mistake the AI app should see and can recover from. */
export class ToolError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "ToolError";
  }
}

export const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

/**
 * @param {string} value
 */
export function isRealDate(value) {
  if (!new RegExp(DATE_PATTERN).test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * @param {any} schema  the tool's inputSchema
 * @param {unknown} args
 * @returns {Record<string, any>}
 */
export function validateArgs(schema, args) {
  const input = args == null ? {} : args;
  if (typeof input !== "object" || Array.isArray(input)) throw new ToolError("Arguments must be an object.");
  const record = /** @type {Record<string, unknown>} */ (input);
  const properties = schema.properties || {};
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(properties, key)) {
      const allowed = Object.keys(properties);
      throw new ToolError(`Unknown argument "${key}". ${allowed.length ? `Allowed: ${allowed.join(", ")}.` : "This tool takes none."}`);
    }
  }
  /** @type {Record<string, any>} */
  const out = {};
  for (const [key, spec] of Object.entries(properties)) {
    const value = record[key];
    if (value == null || value === "") continue;
    out[key] = checkValue(key, spec, value);
  }
  for (const key of schema.required || []) {
    if (out[key] == null || (Array.isArray(out[key]) && out[key].length === 0)) throw new ToolError(`"${key}" is required.`);
  }
  return out;
}

/**
 * @param {string} key
 * @param {any} spec
 * @param {unknown} value
 */
function checkValue(key, spec, value) {
  if (spec.type === "string") return checkString(key, spec, value);
  if (spec.type === "integer") {
    const n = typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value) : value;
    if (typeof n !== "number" || !Number.isInteger(n)) throw new ToolError(`"${key}" must be a whole number.`);
    if (spec.minimum != null && n < spec.minimum) throw new ToolError(`"${key}" must be at least ${spec.minimum}.`);
    if (spec.maximum != null && n > spec.maximum) throw new ToolError(`"${key}" must be at most ${spec.maximum}.`);
    return n;
  }
  if (spec.type === "boolean") {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    throw new ToolError(`"${key}" must be true or false.`);
  }
  if (spec.type === "array") {
    const list = typeof value === "string" ? [value] : value;
    if (!Array.isArray(list)) throw new ToolError(`"${key}" must be a list.`);
    if (spec.maxItems != null && list.length > spec.maxItems) throw new ToolError(`"${key}" can have at most ${spec.maxItems} items.`);
    return list.map((item, i) => checkString(`${key}[${i}]`, spec.items || { type: "string" }, item)).filter(Boolean);
  }
  throw new ToolError(`"${key}" has an unsupported type.`);
}

/**
 * @param {string} key
 * @param {any} spec
 * @param {unknown} value
 */
function checkString(key, spec, value) {
  if (typeof value !== "string") throw new ToolError(`"${key}" must be text.`);
  const text = value.trim();
  if (spec.maxLength != null && text.length > spec.maxLength) {
    throw new ToolError(`"${key}" can be at most ${spec.maxLength} characters.`);
  }
  if (spec.enum && !spec.enum.includes(text)) {
    throw new ToolError(`"${key}" must be one of: ${spec.enum.join(", ")}.`);
  }
  if (spec.pattern === DATE_PATTERN && !isRealDate(text)) {
    throw new ToolError(`"${key}" must be a date written like 2026-09-28.`);
  }
  if (spec.pattern && spec.pattern !== DATE_PATTERN && !new RegExp(spec.pattern).test(text)) {
    throw new ToolError(`"${key}" isn't in the expected format.`);
  }
  return text;
}
