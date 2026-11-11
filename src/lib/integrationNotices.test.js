import { describe, expect, it } from "vitest";
import { integrationNotices } from "./integrationNotices";

const texts = (integration) => integrationNotices(integration).map((n) => n.text);

describe("what Settings says under a connected calendar", () => {
  it("says nothing when all is well", () => {
    expect(integrationNotices({ provider: "google", status: "active", last_error: null, waiting_changes: 0 })).toEqual([]);
  });

  it("asks for a reconnect, and only that, when the calendar has stopped accepting the connection", () => {
    expect(texts({ provider: "google", status: "needs_reauth", last_error: 'Google refresh failed (400): {"error":"invalid_grant"}', waiting_changes: 3 })).toEqual([
      "Google Calendar no longer accepts this connection. Disconnect, then connect again to carry on syncing.",
    ]);
    expect(texts({ provider: "apple", status: "active", last_error: "Apple Calendar rejected the credentials. Check the Apple ID and app-specific password." })).toEqual([
      "iCloud Calendar no longer accepts the app-specific password. Disconnect, then connect again with a new one.",
    ]);
  });

  it("counts the changes still on their way", () => {
    expect(texts({ provider: "google", status: "active", waiting_changes: 1 })).toEqual([
      "1 change made here hasn't reached Google Calendar yet. Zephyrly keeps trying.",
    ]);
    expect(texts({ provider: "apple", status: "active", waiting_changes: 4 })[0]).toBe(
      "4 changes made here haven't reached iCloud Calendar yet. Zephyrly keeps trying."
    );
  });

  it("puts the server's error into plain words, never the raw text", () => {
    const cases = [
      ["Google Calendar didn't answer within 20 seconds.", /couldn't be reached just now/],
      ["Couldn't reach iCloud Calendar.", /couldn't be reached just now/],
      ['Google events list failed (403): {"error":{"message":"Rate Limit Exceeded"}}', /limiting how often/],
      ["Google events list failed (503): backend error", /had a problem of its own/],
      ["Apple CalDAV REPORT https://caldav.icloud.com/1/2… failed (404): ", /no longer at/],
      ["something unexpected", /didn't go through/],
    ];
    for (const [error, expected] of cases) {
      const [line] = texts({ provider: "google", status: "active", last_error: error });
      expect(line).toMatch(expected);
      expect(line).not.toContain("{");
      expect(line).not.toContain("failed (");
    }
  });
});
