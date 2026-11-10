// @ts-nocheck
/**
 * Adding files to a task: what happens to a mixed batch, a drop that
 * misses the strip, a pasted screenshot, and files picked for a task
 * whose upload doesn't go through.
 */
import "fake-indexeddb/auto";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/api/apiClient", () => ({
  apiClient: {
    attachments: {
      list: vi.fn(async () => []),
      upload: vi.fn(async () => ({ id: "att_1", filename: "x" })),
      delete: vi.fn(async () => ({ success: true })),
      urlFor: (id) => `#${id}`,
    },
  },
}));

import { apiClient } from "@/api/apiClient";
import * as attachmentQueue from "@/lib/attachmentQueue";
import AttachmentsField, { attachToNewTask, sortPickedFiles } from "./AttachmentsField";

const MB = 1_000_000;
/** A File of a stated size, without allocating it. */
function file(name, size = 1200, type = "") {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}
const failure = (status, message) => Object.assign(new Error(message), { status });

/** @type {any[]} */
let pendingNow = [];
function Harness({ taskId = null }) {
  const [pending, setPending] = useState([]);
  pendingNow = pending;
  return (
    <div role="dialog" data-testid="form">
      <p data-testid="elsewhere">Title and other fields</p>
      <AttachmentsField taskId={taskId} pendingFiles={pending} setPendingFiles={setPending} />
    </div>
  );
}
function renderField(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
      <p data-testid="outside">The page behind the form</p>
    </QueryClientProvider>
  );
}
/** A drag or paste payload carrying files. */
const carrying = (files, text = "") => ({
  types: text ? ["Files", "text/plain"] : ["Files"],
  files,
  getData: (kind) => (kind === "text/plain" ? text : ""),
});
const names = () => pendingNow.map((p) => p.file.name);

beforeEach(() => {
  pendingNow = [];
  vi.mocked(apiClient.attachments.upload).mockReset().mockResolvedValue({ id: "att_1" });
  vi.mocked(apiClient.attachments.list).mockReset().mockResolvedValue([]);
});
afterEach(async () => {
  await attachmentQueue._clearAll();
  vi.restoreAllMocks();
});

describe("sortPickedFiles", () => {
  it("lets the good files through and names the ones it left out", () => {
    const { accepted, problems } = sortPickedFiles(
      [file("notes.pdf"), file("film.mov", 26 * MB), file("setup.EXE"), file("Holiday", 0), file("photo.heic")],
      0
    );
    expect(accepted.map((f) => f.name)).toEqual(["notes.pdf", "photo.heic"]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/film\.mov.*too large \(max 25 MB\)/);
    expect(problems[1]).toMatch(/\.exe files are not allowed/);
    expect(problems[2]).toMatch(/Holiday.*empty/);
  });

  it("takes any kind of file that isn't a program, with or without an extension", () => {
    const picked = ["a.docx", "b.xlsx", "c.pptx", "d.zip", "e.mp4", "f.mp3", "g.csv", "h.txt", "i.png", "j.webp", "k.psd", "README", "m.json", "n.pages"]
      .slice(0, 10)
      .map((name) => file(name));
    expect(sortPickedFiles(picked, 0).accepted).toHaveLength(10);
  });

  it("fills the task up to ten files and says how many didn't fit", () => {
    const picked = Array.from({ length: 5 }, (_, i) => file(`f${i}.txt`));
    const { accepted, problems } = sortPickedFiles(picked, 8);
    expect(accepted.map((f) => f.name)).toEqual(["f0.txt", "f1.txt"]);
    expect(problems).toEqual(["A task holds 10 files — 3 files were left out."]);
  });
});

describe("AttachmentsField", () => {
  it("keeps the good files of a mixed batch and explains the rest", () => {
    renderField();
    fireEvent.change(screen.getByTestId("attachments-input"), {
      target: { files: [file("ok.pdf"), file("huge.mov", 30 * MB), file("also-ok.png")] },
    });
    expect(names()).toEqual(["ok.pdf", "also-ok.png"]);
    expect(screen.getByRole("alert").textContent).toMatch(/huge\.mov.*too large/);
  });

  it("a file picked for an unsaved task says it uploads on save, and doesn't pretend to be uploading", () => {
    renderField();
    fireEvent.change(screen.getByTestId("attachments-input"), { target: { files: [file("plan.pdf", 2_400_000)] } });
    expect(screen.getByText("2.4 MB · uploads when you save")).toBeTruthy();
    expect(screen.queryByText(/Uploading/)).toBeNull();
  });

  it("two batches added one after the other both stay", () => {
    renderField();
    const input = screen.getByTestId("attachments-input");
    fireEvent.change(input, { target: { files: [file("one.txt")] } });
    fireEvent.change(input, { target: { files: [file("two.txt")] } });
    expect(names()).toEqual(["one.txt", "two.txt"]);
  });

  it("a file dropped anywhere in the form is attached, not just on the strip", () => {
    renderField();
    const dataTransfer = carrying([file("dropped.pdf")]);
    const over = fireEvent.dragOver(screen.getByTestId("elsewhere"), { dataTransfer });
    // Claimed, so the browser won't open the file in place of the app.
    expect(over).toBe(false);
    expect(screen.getByTestId("attachments-add").textContent).toMatch(/Drop anywhere here/);
    fireEvent.drop(screen.getByTestId("elsewhere"), { dataTransfer });
    expect(names()).toEqual(["dropped.pdf"]);
    expect(screen.getByTestId("attachments-add").textContent).toMatch(/Add files/);
  });

  it("a file dropped outside the form is ignored, and never opens in the browser", () => {
    renderField();
    const dataTransfer = carrying([file("stray.pdf")]);
    expect(fireEvent.dragOver(screen.getByTestId("outside"), { dataTransfer })).toBe(false);
    expect(fireEvent.drop(screen.getByTestId("outside"), { dataTransfer })).toBe(false);
    expect(names()).toEqual([]);
  });

  it("dragging text or a link over the form is left alone", () => {
    renderField();
    const dataTransfer = { types: ["text/plain"], files: [], getData: () => "hello" };
    expect(fireEvent.dragOver(screen.getByTestId("elsewhere"), { dataTransfer })).toBe(true);
  });

  it("a pasted screenshot is attached; pasted text that brings a picture along is not", () => {
    renderField();
    fireEvent.paste(screen.getByTestId("elsewhere"), { clipboardData: carrying([file("Screenshot.png", 5000, "image/png")]) });
    expect(names()).toEqual(["Screenshot.png"]);
    fireEvent.paste(screen.getByTestId("elsewhere"), {
      clipboardData: carrying([file("cells.png", 5000, "image/png")], "A1\tB1"),
    });
    expect(names()).toEqual(["Screenshot.png"]);
  });

  it("offline, a task that isn't saved yet says so instead of dropping the files later", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderField();
    fireEvent.change(screen.getByTestId("attachments-input"), { target: { files: [file("later.pdf")] } });
    expect(names()).toEqual([]);
    expect(screen.getByRole("alert").textContent).toMatch(/You're offline\. Save this task/);
  });

  it("offline, a saved task queues the file on this device", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderField({ taskId: "task-9" });
    await act(async () => {
      fireEvent.change(screen.getByTestId("attachments-input"), { target: { files: [file("later.pdf")] } });
    });
    await waitFor(async () => expect(await attachmentQueue.listForTask("task-9")).toHaveLength(1));
    expect(apiClient.attachments.upload).not.toHaveBeenCalled();
  });
});

describe("attachToNewTask", () => {
  const pending = (...files) => files.map((f, i) => ({ tempId: `t${i}`, file: f }));

  it("says nothing when every file uploads", async () => {
    const result = await attachToNewTask("task-1", pending(file("a.pdf"), file("b.pdf")));
    expect(result).toEqual({ uploaded: 2, queued: 0, message: "" });
    expect(apiClient.attachments.upload).toHaveBeenCalledTimes(2);
  });

  it("a dropped connection keeps the file to send later, and says so", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(apiClient.attachments.upload)
      .mockResolvedValueOnce({ id: "att_1" })
      .mockRejectedValueOnce(failure(0, "Network error"))
      .mockRejectedValueOnce(failure(502, "Bad gateway"));
    const result = await attachToNewTask("task-1", pending(file("a.pdf"), file("b.pdf"), file("c.pdf")));
    expect(result.uploaded).toBe(1);
    expect(result.queued).toBe(2);
    expect(result.message).toBe("2 files will finish uploading when the connection is back.");
    const waiting = await attachmentQueue.listForTask("task-1");
    expect(waiting.map((w) => w.filename).sort()).toEqual(["b.pdf", "c.pdf"]);
  });

  it("a file the server refuses is named, with the reason, and not retried", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(apiClient.attachments.upload).mockRejectedValueOnce(
      failure(413, "This file would exceed your 1000 MB storage quota.")
    );
    const result = await attachToNewTask("task-1", pending(file("big.zip")));
    expect(result.message).toBe("Couldn't attach “big.zip”: This file would exceed your 1000 MB storage quota.");
    expect(await attachmentQueue.listForTask("task-1")).toHaveLength(0);
  });

  it("a task that was only saved offline reports that its files weren't attached", async () => {
    const result = await attachToNewTask("offline_abc", pending(file("a.pdf")));
    expect(result.message).toMatch(/saved offline, so its 1 file couldn't be attached\. Add it again/);
    expect(apiClient.attachments.upload).not.toHaveBeenCalled();
  });
});
