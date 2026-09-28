// @ts-check
/**
 * @file How to plug a Zephyrly token into each AI app that takes one by
 * hand. Every app here speaks MCP over HTTP; they differ only in where
 * the address and the "Authorization: Bearer …" header go.
 */

/**
 * @typedef {{ id: string, label: string, where: string, text: string }} SetupSnippet
 */

/**
 * @param {string} mcpUrl
 * @param {string} token
 * @returns {SetupSnippet[]}
 */
export function setupSnippets(mcpUrl, token) {
  const bearer = `Bearer ${token}`;
  const json = (/** @type {unknown} */ value) => JSON.stringify(value, null, 2);
  const urlAndHeader = { url: mcpUrl, headers: { Authorization: bearer } };
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      where: "Run in a terminal:",
      text: `claude mcp add --transport http zephyrly ${mcpUrl} --header "Authorization: ${bearer}"`,
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      where: "Add to claude_desktop_config.json (Settings → Developer → Edit config), then restart Claude:",
      // mcp-remote bridges a remote server into Desktop's local config.
      // The header goes through an env var: a space inside args breaks on Windows.
      text: json({
        mcpServers: {
          zephyrly: {
            command: "npx",
            args: ["-y", "mcp-remote", mcpUrl, "--header", "Authorization:${AUTH_HEADER}"],
            env: { AUTH_HEADER: bearer },
          },
        },
      }),
    },
    {
      id: "cursor",
      label: "Cursor",
      where: "Add to ~/.cursor/mcp.json:",
      text: json({ mcpServers: { zephyrly: urlAndHeader } }),
    },
    {
      id: "lm-studio",
      label: "LM Studio",
      where: "Program → Install → Edit mcp.json, and add:",
      text: json({ mcpServers: { zephyrly: urlAndHeader } }),
    },
    {
      id: "gemini-cli",
      label: "Gemini CLI",
      where: "Add to ~/.gemini/settings.json:",
      text: json({ mcpServers: { zephyrly: { httpUrl: mcpUrl, headers: { Authorization: bearer } } } }),
    },
    {
      id: "open-webui",
      label: "Open WebUI",
      where: "Admin panel → Settings → External tools → add a server of type MCP (Streamable HTTP):",
      text: `URL: ${mcpUrl}\nAuth: Bearer\nKey: ${token}`,
    },
  ];
}
