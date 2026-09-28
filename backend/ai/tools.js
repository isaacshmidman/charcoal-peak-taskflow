// @ts-check
/**
 * @file The tools AI apps call. One registry behind every way in (MCP at
 * /api/mcp, plain HTTP at /api/v1), so what an app can do, and the rules
 * it's held to, don't depend on how it connects.
 *
 * A tool is { name, title, description, inputSchema, annotations, write,
 * handler(ctx, args) → { text, data } } (see context.js). Read tools are
 * offered to every connection; write tools only to one allowed to make
 * changes, and runTool refuses them otherwise too.
 */
import { HttpError } from "../http.js";
import { ToolError, validateArgs } from "./args.js";
import { READ_TOOLS } from "./reads.js";

/**
 * @typedef {import("./context.js").Tool} Tool
 * @typedef {import("./context.js").ToolContext} ToolContext
 * @typedef {import("./context.js").ToolResult} ToolResult
 */

/** @type {Tool[]} */
export const WRITE_TOOLS = [];

const ALL_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];

/**
 * The tools this connection may use, in the order they're offered.
 * @param {any} grant
 */
export function toolsForGrant(grant) {
  return grant.can_write ? ALL_TOOLS : READ_TOOLS;
}

/**
 * Run a tool for a connection. Mistakes and refusals come back as a
 * ToolError the AI app sees and can act on; anything else is a real fault.
 *
 * @param {ToolContext} ctx
 * @param {string} name
 * @param {unknown} rawArgs
 * @returns {Promise<ToolResult>}
 */
export async function runTool(ctx, name, rawArgs) {
  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (!tool) throw new ToolError(`There's no tool called "${name}".`);
  if (tool.write && !ctx.grant.can_write) {
    throw new ToolError(
      "This connection can only read. The person can allow changes in Zephyrly → Settings → Connected apps."
    );
  }
  const args = validateArgs(tool.inputSchema, rawArgs);
  try {
    return await tool.handler(ctx, args);
  } catch (error) {
    if (error instanceof HttpError && error.status < 500) throw new ToolError(error.message);
    throw error;
  }
}
