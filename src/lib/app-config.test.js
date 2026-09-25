import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * appConfig is built when the module loads, so each case sets up the
 * address bar and storage first and then imports a fresh copy.
 */
const loadConfig = async () => {
  vi.resetModules();
  return (await import("./app-config")).appConfig;
};

afterEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("app config and link parameters", () => {
  it("never takes the API address, a token or the app id from a link — and strips them", async () => {
    window.history.replaceState(
      {},
      "",
      "/Today?api_base_url=https%3A%2F%2Fevil.example&access_token=planted&app_id=wrong&keep=1"
    );
    const config = await loadConfig();

    expect(config.apiBaseUrl).toBe(import.meta.env.VITE_API_BASE_URL || null);
    expect(config.token).not.toBe("planted");
    expect(config.appId).not.toBe("wrong");
    expect(localStorage.getItem("taskflow_access_token")).toBeNull();
    // The ignored parameters leave the address bar; others stay.
    expect(window.location.search).toBe("?keep=1");
    expect(window.location.pathname).toBe("/Today");
  });

  it("forgets an API address an earlier link saved", async () => {
    localStorage.setItem("taskflow_api_base_url", "https://evil.example");
    const config = await loadConfig();
    expect(config.apiBaseUrl).toBe(import.meta.env.VITE_API_BASE_URL || null);
    expect(localStorage.getItem("taskflow_api_base_url")).toBeNull();
  });

  it("still reads a token the app itself saved", async () => {
    localStorage.setItem("taskflow_access_token", "real-session");
    const config = await loadConfig();
    expect(config.token).toBe("real-session");
  });
});
