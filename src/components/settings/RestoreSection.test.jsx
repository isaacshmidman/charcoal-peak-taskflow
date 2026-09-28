import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RestoreSection, { describeRestore } from "./RestoreSection";

/** @type {any} */
let restoreImpl = async () => ({ added: {}, notes: [] });
vi.mock("@/api/apiClient", () => ({
  restoreFromExport: (file, opts) => restoreImpl(file, opts),
}));

const setOnline = (value) => {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
};

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <RestoreSection />
    </QueryClientProvider>
  );
  return { invalidate };
}

const pick = (name = "zephyrly-export-2026-09-28.zip") =>
  fireEvent.change(screen.getByTestId("restore-file-input"), {
    target: { files: [new File(["PK"], name, { type: "application/zip" })] },
  });

afterEach(() => {
  setOnline(true);
  vi.restoreAllMocks();
});

describe("describeRestore", () => {
  it("says what came back, in plain words", () => {
    expect(describeRestore({ tasks: 12, notes: 1, priorities: 0, tags: 0, recentlyDeleted: 0, files: 2 })).toBe(
      "Added 12 tasks, 1 note and 2 files."
    );
    expect(describeRestore({ tasks: 1 })).toBe("Added 1 task.");
    expect(describeRestore({ recentlyDeleted: 3, priorities: 1 })).toBe("Added 1 priority and 3 items in Recently Deleted.");
    expect(describeRestore({ tasks: 0, files: 0 })).toBe("Nothing was missing — everything in this export is already here.");
  });
});

describe("RestoreSection", () => {
  it("uploads the chosen file, shows progress, then the summary, and refreshes everything", async () => {
    /** @type {any} */
    let finish = null;
    /** @type {any} */
    let uploaded = null;
    /** @type {any} */
    let progress = null;
    restoreImpl = (file, opts) => {
      uploaded = file;
      progress = opts.onProgress;
      return new Promise((resolve) => { finish = resolve; });
    };
    const { invalidate } = renderSection();
    pick();

    expect(uploaded?.name).toBe("zephyrly-export-2026-09-28.zip");
    act(() => progress(40));
    expect(screen.getByRole("progressbar", { name: "Uploading export" }).getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByTestId("restore-choose")).toHaveProperty("disabled", true);
    act(() => progress(100));
    expect(screen.getByTestId("restore-status").textContent).toContain("Restoring… Keep this page open");

    await act(async () => finish({
      added: { tasks: 3, notes: 0, priorities: 0, tags: 0, recentlyDeleted: 0, files: 1 },
      notes: ["2 things were already here and left as they are."],
    }));
    expect(screen.getByTestId("restore-summary").textContent).toContain("Added 3 tasks and 1 file.");
    expect(screen.getByText("2 things were already here and left as they are.")).toBeTruthy();
    expect(invalidate).toHaveBeenCalled();
    expect(screen.getByTestId("restore-choose")).toHaveProperty("disabled", false);
  });

  it("shows the server's reason when a restore is refused", async () => {
    restoreImpl = async () => {
      throw new Error("That file isn't a Zephyrly export.");
    };
    const { invalidate } = renderSection();
    pick("notes.txt");
    expect(await screen.findByTestId("restore-error")).toHaveProperty("textContent", "That file isn't a Zephyrly export.");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("is unavailable offline, and says why", async () => {
    setOnline(false);
    renderSection();
    expect(screen.getByTestId("restore-choose")).toHaveProperty("disabled", true);
    expect(screen.getByText("You're offline. Restoring needs a connection.")).toBeTruthy();
    setOnline(true);
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(screen.getByTestId("restore-choose")).toHaveProperty("disabled", false));
  });
});
