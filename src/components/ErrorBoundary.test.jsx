import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary from "./ErrorBoundary";
import { resetErrorReports } from "@/lib/report-error";

let broken = true;
function Page() {
  if (broken) throw new TypeError("tasks.map is not a function");
  return <p>The page</p>;
}

describe("ErrorBoundary", () => {
  let fetchMock;
  beforeEach(() => {
    broken = true;
    resetErrorReports();
    fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("shows a way out instead of a blank page, and tells the server", () => {
    render(<ErrorBoundary resetKey="/Today"><Page /></ErrorBoundary>);
    expect(screen.getByRole("alert").textContent).toContain("This page stopped working");
    expect(screen.getByRole("alert").textContent).toContain("Everything you saved is safe");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ kind: "render", message: "tasks.map is not a function" });
  });

  it("Try again draws the page again", () => {
    render(<ErrorBoundary resetKey="/Today"><Page /></ErrorBoundary>);
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("The page")).toBeTruthy();
  });

  it("going to another page clears it", () => {
    const { rerender } = render(<ErrorBoundary resetKey="/Today"><Page /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toBeTruthy();
    broken = false;
    rerender(<ErrorBoundary resetKey="/Calendar"><Page /></ErrorBoundary>);
    expect(screen.getByText("The page")).toBeTruthy();
  });

  it("says so when it was the page's code that couldn't be fetched", () => {
    const Missing = () => { throw new TypeError("Failed to fetch dynamically imported module: /assets/Calendar-abc.js"); };
    render(<ErrorBoundary resetKey="/Calendar"><Missing /></ErrorBoundary>);
    expect(screen.getByRole("alert").textContent).toContain("This page couldn't be loaded");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).kind).toBe("chunk");
  });
});
