import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ExportSection from "./ExportSection";

vi.mock("@/api/apiClient", () => ({
  apiClient: { attachments: { usage: async () => ({ used_bytes: 12_400_000, max_bytes: 1_000_000_000 }) } },
  exportDownloadUrl: () => "http://localhost/api/apps/app-1/export",
}));

const renderSection = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ExportSection />
    </QueryClientProvider>
  );

const setOnline = (value) => {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
};

afterEach(() => {
  setOnline(true);
  vi.restoreAllMocks();
});

describe("ExportSection", () => {
  it("downloads the export through a plain link, and says roughly how big it is", async () => {
    setOnline(true);
    const clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      clicked.push({ href: this.href, download: this.hasAttribute("download") });
    });
    renderSection();

    expect(await screen.findByText("About 12.4 MB, mostly attachments.")).toBeTruthy();
    fireEvent.click(screen.getByTestId("export-download"));

    expect(clicked).toEqual([{ href: "http://localhost/api/apps/app-1/export", download: true }]);
    // A second tap can't start a second export straight away.
    expect(screen.getByTestId("export-download")).toHaveProperty("disabled", true);
    expect(screen.getByText("Download started")).toBeTruthy();
  });

  it("is unavailable offline, and says why", async () => {
    setOnline(false);
    renderSection();
    expect(screen.getByTestId("export-download")).toHaveProperty("disabled", true);
    expect(screen.getByText("You're offline. Exporting needs a connection.")).toBeTruthy();

    setOnline(true);
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(screen.getByTestId("export-download")).toHaveProperty("disabled", false));
  });
});
