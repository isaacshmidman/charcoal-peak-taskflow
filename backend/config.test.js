/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { deriveSupportEmail } from "./config.js";

describe("deriveSupportEmail", () => {
  it("uses the address that was set", () => {
    expect(deriveSupportEmail({ TASKFLOW_SUPPORT_EMAIL: " help@example.org ", TASKFLOW_PUBLIC_APP_URL: "https://zephyrly.app" })).toBe(
      "help@example.org"
    );
  });

  it("otherwise is support@ the app's own domain", () => {
    expect(deriveSupportEmail({ TASKFLOW_PUBLIC_APP_URL: "https://zephyrly.app" })).toBe("support@zephyrly.app");
    expect(deriveSupportEmail({ TASKFLOW_PUBLIC_APP_URL: "https://tasks.example.co.uk/app" })).toBe("support@tasks.example.co.uk");
  });

  it("has no address where there's no real domain to write to", () => {
    expect(deriveSupportEmail({ TASKFLOW_PUBLIC_APP_URL: "http://127.0.0.1:5173" })).toBe("");
    expect(deriveSupportEmail({ TASKFLOW_PUBLIC_APP_URL: "http://localhost:5173" })).toBe("");
    expect(deriveSupportEmail({ TASKFLOW_PUBLIC_APP_URL: "http://app.localhost:5173" })).toBe("");
    expect(deriveSupportEmail({ TASKFLOW_PUBLIC_APP_URL: "not a url" })).toBe("");
    expect(deriveSupportEmail({})).toBe("");
  });
});
