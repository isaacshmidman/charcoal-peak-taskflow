import { Suspense } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isChunkLoadError, lazyPage } from "./lazy-page";
import ErrorBoundary from "@/components/ErrorBoundary";

const memory = () => {
  const kept = new Map();
  return { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k) };
};
const gone = () => new TypeError("Failed to fetch dynamically imported module: https://zephyrly.app/assets/Calendar-abc.js");

describe("lazyPage", () => {
  it("draws the page once its code arrives", async () => {
    const Page = lazyPage(() => Promise.resolve({ default: () => <p>Calendar is here</p> }), { storage: memory(), reload: vi.fn() });
    render(<Suspense fallback={<p>outline</p>}><Page /></Suspense>);
    expect(screen.getByText("outline")).toBeTruthy();
    expect(await screen.findByText("Calendar is here")).toBeTruthy();
  });

  it("reloads once when the page's file is gone (a deploy happened while the app was open)", async () => {
    const reload = vi.fn();
    const storage = memory();
    const Page = lazyPage(() => Promise.reject(gone()), { storage, reload });
    render(<Suspense fallback={<p>outline</p>}><Page /></Suspense>);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    // Still the outline: no error flashes while the reload is on its way.
    expect(screen.getByText("outline")).toBeTruthy();
  });

  it("does not reload twice in a visit: the second failure reaches the error screen, and Try again fetches again", async () => {
    const reload = vi.fn();
    const storage = memory();
    storage.setItem("zephyrly:reloaded-for-new-build", "1");
    let reachable = false;
    const load = vi.fn(() => (reachable ? Promise.resolve({ default: () => <p>Calendar is here</p> }) : Promise.reject(gone())));
    const Page = lazyPage(load, { storage, reload });
    await expect(Page.preload()).resolves.toBeUndefined(); // fetching ahead never throws
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary resetKey="/Calendar"><Suspense fallback={<p>outline</p>}><Page /></Suspense></ErrorBoundary>);
    expect((await screen.findByRole("alert")).textContent).toContain("This page couldn't be loaded");
    expect(reload).not.toHaveBeenCalled();

    reachable = true;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Calendar is here")).toBeTruthy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("forgets the reload once a page loads, so the next deploy gets its own", async () => {
    const storage = memory();
    storage.setItem("zephyrly:reloaded-for-new-build", "1");
    const Page = lazyPage(() => Promise.resolve({ default: () => <p>ok</p> }), { storage, reload: vi.fn() });
    render(<Suspense fallback={null}><Page /></Suspense>);
    await screen.findByText("ok");
    expect(storage.getItem("zephyrly:reloaded-for-new-build")).toBeNull();
  });

  it("tells a missing file from an ordinary error", () => {
    expect(isChunkLoadError(gone())).toBe(true);
    expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
  });
});
