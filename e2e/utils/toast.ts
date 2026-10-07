import { expect, type Page } from "@playwright/test";

/**
 * Do `cause` and wait for the toast to say `text`, watching from inside
 * the page from before `cause` starts. A toast is only up for a few
 * seconds, and looking for it from out here once `cause` has come back can
 * be too late: when the machine holds the test runner up for longer than
 * the toast lasts (a Mac short of memory did, for over 6 seconds, in the
 * middle of a full run) it has come and gone unseen. The page can't miss
 * its own toast. Still fails if the toast never says it.
 */
export async function toastSays(page: Page, text: string, cause: () => Promise<unknown>) {
  const said = page
    .waitForFunction(
      (wanted) => !!document.querySelector('[data-testid="delete-toast"]')?.textContent?.includes(wanted),
      text,
      { timeout: 10_000 }
    )
    .then(() => true, () => false);
  await cause();
  expect(await said, `the toast saying “${text}”`).toBe(true);
}

/**
 * How long the app keeps a toast up: 3 seconds unless it asks for longer
 * (DeleteToast's default), and the longest any message asks for is 6.
 */
const SHORTEST_TOAST_MS = 3000;
const LONGEST_TOAST_MS = 10_000;

/**
 * Keep the next toast on screen until `release()`, for a test that goes on
 * to click its Undo. Watching from inside the page (toastSays) is no help
 * there: the click needs the toast still up, and a test runner held up for
 * longer than the toast lasts finds it gone.
 *
 * Call this before the action that brings the toast up. From then until
 * `release()`, a timer the page sets for between 3 and 10 seconds (the
 * toast's own; nothing shorter, so saving, fetching and animation carry on
 * as usual) isn't started. `release()` starts those timers, each for its
 * full time, and fails if there was none to hold: the toast then came up
 * before the hold, or lasts some other length of time, and the test is
 * unprotected.
 */
export async function holdToast(page: Page) {
  await page.evaluate(([shortest, longest]) => {
    const w = window as any;
    if (w.__toastHold) return;
    const startTimer = window.setTimeout.bind(window);
    const stopTimer = window.clearTimeout.bind(window);
    const waiting = new Map<number, () => number>();
    const started = new Map<number, number>();
    let nextId = -1;
    let heldSoFar = 0;
    w.setTimeout = (fn: any, ms?: number, ...args: any[]) => {
      if (!w.__toastHold || !(Number(ms) >= shortest && Number(ms) <= longest)) return startTimer(fn, ms, ...args);
      const id = nextId--;
      heldSoFar += 1;
      waiting.set(id, () => startTimer(fn, ms, ...args));
      return id;
    };
    // Stays in place after the release, for the ids handed out during the hold.
    w.clearTimeout = (id: any) => {
      if (waiting.delete(id)) return;
      if (started.has(id)) {
        stopTimer(started.get(id));
        started.delete(id);
        return;
      }
      stopTimer(id);
    };
    w.__toastHold = () => {
      w.__toastHold = null;
      for (const [id, start] of waiting) started.set(id, start());
      waiting.clear();
      return heldSoFar;
    };
  }, [SHORTEST_TOAST_MS, LONGEST_TOAST_MS]);

  return {
    async release() {
      const held = await page.evaluate(() => (window as any).__toastHold?.() ?? 0);
      expect(held, "toast timers held while the test used the toast").toBeGreaterThan(0);
    },
  };
}
