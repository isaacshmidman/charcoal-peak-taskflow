// @ts-check
/**
 * @file An OpenAPI 3.1 description of /api/v1, generated from the tool
 * registry so it can't drift from what the tools accept. For anything that
 * reads OpenAPI rather than speaking MCP: ChatGPT's GPT Actions, Gemini
 * function calling, scripts.
 */
import { publicOrigin } from "../http.js";
import { allTools } from "./tools.js";

/**
 * @param {any} config
 */
export function openApiDocument(config) {
  /** @type {Record<string, any>} */
  const paths = {};
  for (const tool of allTools()) {
    paths[`/api/v1/tools/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: tool.title,
        description: tool.write ? `${tool.description} Only for a connection allowed to change tasks.` : tool.description,
        requestBody: { required: false, content: { "application/json": { schema: tool.inputSchema } } },
        responses: {
          200: {
            description: "The answer, or a refusal the caller can act on (ok: false, with the reason in text).",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ToolResult" } } },
          },
          401: { description: "No valid Zephyrly token for AI apps." },
          429: { description: "Too many requests; see Retry-After." },
        },
        security: [{ bearer: [] }],
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Zephyrly",
      version: "1",
      description:
        "Read the person's tasks and notes and, when their connection allows it, change tasks. Calendar items are read-only and nothing is deleted for good. Tokens come from Zephyrly → Settings → Connected apps.",
    },
    servers: [{ url: publicOrigin(config) }],
    paths,
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "A Zephyrly token for AI apps." },
      },
      schemas: {
        ToolResult: {
          type: "object",
          properties: {
            ok: { type: "boolean", description: "false when the tool refused or the arguments were wrong." },
            text: { type: "string", description: "A readable answer, with ids." },
            data: { description: "The same facts as structured data (absent when ok is false)." },
          },
          required: ["ok", "text"],
        },
      },
    },
  };
}
