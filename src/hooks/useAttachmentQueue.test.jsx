// @ts-nocheck
/**
 * The driver that sends queued files: it has to try again by itself when
 * an upload fails while the connection is up, and give up on a file the
 * server will never take.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/api/apiClient", () => ({
  apiClient: { attachments: { upload: vi.fn() } },
}));

import { apiClient } from "@/api/apiClient";
import * as attachmentQueue from "@/lib/attachmentQueue";
import { useAttachmentQueue } from "./useAttachmentQueue";

function Driver() {
  useAttachmentQueue();
  return null;
}
const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Driver />
    </QueryClientProvider>
  );
const failure = (status) => Object.assign(new Error("failed"), { status });
const upload = () => vi.mocked(apiClient.attachments.upload);
const waiting = () => attachmentQueue.listAll();

beforeEach(() => {
  upload().mockReset();
});
afterEach(async () => {
  vi.useRealTimers();
  await attachmentQueue._clearAll();
});

describe("useAttachmentQueue", () => {
  it("sends what is waiting as soon as it starts", async () => {
    upload().mockResolvedValue({ id: "att_1" });
    await attachmentQueue.enqueue({ taskId: "task-1", file: new File(["a"], "a.txt") });
    mount();
    await waitFor(async () => expect(await waiting()).toHaveLength(0));
    expect(upload()).toHaveBeenCalledTimes(1);
  });

  it("tries again by itself after a server hiccup, without waiting for the tab to be refocused", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    upload().mockRejectedValueOnce(failure(502)).mockResolvedValue({ id: "att_1" });
    await attachmentQueue.enqueue({ taskId: "task-1", file: new File(["a"], "a.txt") });
    mount();
    await vi.waitFor(() => expect(upload()).toHaveBeenCalledTimes(1));
    // Let the failed drain finish and book its retry.
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
    expect(await waiting()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20_000);
    await vi.waitFor(() => expect(upload()).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect(await waiting()).toHaveLength(0));
  });

  it("drops a file the server refuses for good, and keeps one it might take later", async () => {
    upload().mockRejectedValueOnce(failure(413)).mockRejectedValueOnce(failure(401));
    await attachmentQueue.enqueue({ taskId: "task-1", file: new File(["a"], "too-big.zip") });
    await new Promise((r) => setTimeout(r, 2));
    await attachmentQueue.enqueue({ taskId: "task-1", file: new File(["b"], "signed-out.txt") });
    const view = mount();
    await waitFor(() => expect(upload()).toHaveBeenCalledTimes(2));
    await waitFor(async () => expect((await waiting()).map((w) => w.filename)).toEqual(["signed-out.txt"]));
    view.unmount();
  });
});
