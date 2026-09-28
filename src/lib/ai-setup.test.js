import { describe, expect, it } from "vitest";
import { setupSnippets } from "./ai-setup";

const URL = "https://zephyrly.app/api/mcp";
const TOKEN = "zeph_pat_example";

describe("setupSnippets", () => {
  const snippets = setupSnippets(URL, TOKEN);

  it("gives every app the address and the token", () => {
    expect(snippets.map((s) => s.id)).toEqual(["claude-code", "claude-desktop", "cursor", "lm-studio", "gemini-cli", "open-webui", "http"]);
    for (const s of snippets.filter((x) => x.id !== "http")) {
      expect(s.text).toContain(URL);
      expect(s.text).toContain(TOKEN);
    }
  });

  it("writes JSON configs that parse, with the bearer header where each app expects it", () => {
    const parsed = (id) => JSON.parse(snippets.find((s) => s.id === id).text).mcpServers.zephyrly;
    expect(parsed("cursor")).toEqual({ url: URL, headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(parsed("lm-studio")).toEqual({ url: URL, headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(parsed("gemini-cli")).toEqual({ httpUrl: URL, headers: { Authorization: `Bearer ${TOKEN}` } });
    // Claude Desktop goes through mcp-remote, with the header in an env var
    // (a space inside args breaks on Windows).
    const desktop = parsed("claude-desktop");
    expect(desktop.args).toEqual(["-y", "mcp-remote", URL, "--header", "Authorization:${AUTH_HEADER}"]);
    expect(desktop.env).toEqual({ AUTH_HEADER: `Bearer ${TOKEN}` });
  });

  it("quotes the header for the Claude Code command", () => {
    expect(snippets[0].text).toBe(`claude mcp add --transport http zephyrly ${URL} --header "Authorization: Bearer ${TOKEN}"`);
  });
});

describe("the plain HTTP line", () => {
  it("calls /api/v1 on the same server with the token", () => {
    const http = setupSnippets(URL, TOKEN).find((s) => s.id === "http");
    expect(http.text).toBe(
      `curl -X POST https://zephyrly.app/api/v1/tools/get_agenda \\\n  -H "Authorization: Bearer ${TOKEN}" \\\n  -H "Content-Type: application/json" -d '{}'`
    );
  });
});

