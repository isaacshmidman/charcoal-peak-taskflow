import { expect, test, type Locator, type Page } from "@playwright/test";
import { installMockBackend } from "./utils/mockBackend";

/**
 * Notes, end to end. Until these existed, Notes was the one area of the
 * app with no browser tests at all.
 */

const defaultPriority = { id: "priority-1", name: "Medium", order: 1, color: "slate" };

const note = (overrides: Record<string, any> = {}) => ({
  id: "note-1",
  title: "Groceries",
  content_json: "",
  content_text: "",
  tags: [],
  pinned: false,
  priority_id: "",
  created_date: new Date(Date.now() - 60_000).toISOString(),
  updated_date: new Date(Date.now() - 60_000).toISOString(),
  ...overrides,
});

const editorBody = (page: Page) => page.getByTestId("note-scroll").locator(".tiptap-prose");

async function swipeAway(page: Page, row: Locator) {
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.02, box.y + box.height / 2, { steps: 18 });
  await page.mouse.up();
}

test("a new note autosaves what you type and is still there after a reload", async ({ page }) => {
  const api = await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });
  await page.goto("/Notes");

  await page.getByTestId("new-note-button").click();
  await page.getByTestId("note-title-input").fill("Groceries");
  await editorBody(page).click();
  await page.keyboard.type("milk and bread");

  await expect.poll(async () => (await api.getState()).notes.find((n) => n.title === "Groceries")?.content_text)
    .toBe("milk and bread");

  await page.reload();
  await expect(page.locator('[data-testid^="note-row-"]').filter({ hasText: "Groceries" })).toBeVisible();
  await expect(editorBody(page)).toContainText("milk and bread");
});

test("New note gives you a real blank note straight away", async ({ page }) => {
  // By design (Apple Notes style): the blank page is already a note, kept
  // even if you leave without typing.
  const api = await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });
  await page.goto("/Notes");
  await page.getByTestId("new-note-button").click();
  await expect.poll(async () => (await api.getState()).notes.length).toBe(1);
  await page.reload();
  await expect(page.locator('[data-testid^="note-row-"]')).toHaveCount(1);
});

test("selected note text becomes a task, and the span tracks that task", async ({ page }) => {
  const api = await installMockBackend(page, {
    tasks: [],
    priorities: [defaultPriority],
    notes: [note({ content_text: "Call the plumber tomorrow" })],
  });
  await page.goto("/Notes");

  // Select "Call the plumber" from the start of the line.
  await editorBody(page).click();
  await page.keyboard.press("Home");
  for (let i = 0; i < "Call the plumber".length; i += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.getByTestId("richtext-make-task").click();

  await expect(page.getByTestId("task-form-title")).toHaveValue("Call the plumber");
  await page.getByTestId("task-form-submit").click();
  await expect(page.getByTestId("task-form-dialog")).toBeHidden();

  await expect.poll(async () => (await api.getState()).tasks.find((t) => t.title === "Call the plumber"))
    .toBeTruthy();
  const task = (await api.getState()).tasks.find((t) => t.title === "Call the plumber")!;

  // The span is linked to that task in the saved note, and drawn as open.
  await expect.poll(async () => (await api.getState()).notes[0].content_json).toContain(task.id);
  await expect(editorBody(page).locator(".task-link-open")).toHaveText("Call the plumber");

  // Completing the task anywhere strikes the span through.
  await page.evaluate((id) => {
    const backend = (window as any).__TASKFLOW_E2E_BACKEND__;
    backend.state.tasks.find((t: any) => t.id === id).status = "done";
    window.localStorage.setItem("__taskflow_e2e_backend__", JSON.stringify(backend));
  }, task.id);
  await page.reload();
  await expect(editorBody(page).locator(".task-link-done")).toHaveText("Call the plumber");
});

test("cancelling Make task links nothing and creates nothing", async ({ page }) => {
  const api = await installMockBackend(page, {
    tasks: [],
    priorities: [defaultPriority],
    notes: [note({ content_text: "Call the plumber tomorrow" })],
  });
  await page.goto("/Notes");
  await editorBody(page).click();
  await page.keyboard.press("Home");
  for (let i = 0; i < "Call the plumber".length; i += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.getByTestId("richtext-make-task").click();
  await page.getByTestId("task-form-cancel").click();
  await expect(page.getByTestId("task-form-dialog")).toBeHidden();

  // Edit the note afterwards, so a stale span would have been saved if kept.
  await editorBody(page).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" please");
  await expect.poll(async () => (await api.getState()).notes[0].content_text).toContain("please");
  expect((await api.getState()).tasks).toHaveLength(0);
  expect((await api.getState()).notes[0].content_json).not.toContain("taskLink");
  await expect(editorBody(page).locator(".task-link-open")).toHaveCount(0);
});

test("swiping a note away deletes it, and Undo brings it back", async ({ page }) => {
  const api = await installMockBackend(page, {
    tasks: [],
    priorities: [defaultPriority],
    notes: [note({ id: "keep", title: "Keep me" }), note({ id: "bye", title: "Delete me" })],
  });
  await page.goto("/Notes");

  await swipeAway(page, page.getByTestId("note-row-bye"));
  await expect(page.getByTestId("delete-toast")).toContainText("Note deleted");
  await expect.poll(async () => (await api.getState()).notes.map((n) => n.title)).toEqual(["Keep me"]);
  expect((await api.getState()).deletedNotes.map((n) => n.title)).toEqual(["Delete me"]);

  await page.getByTestId("delete-toast-undo").click();
  await expect.poll(async () => (await api.getState()).notes.map((n) => n.title).sort()).toEqual(["Delete me", "Keep me"]);
  await expect.poll(async () => (await api.getState()).deletedNotes).toHaveLength(0);
});

test("search finds a note by what's in it, not just its title", async ({ page }) => {
  await installMockBackend(page, {
    tasks: [],
    priorities: [defaultPriority],
    notes: [
      note({ id: "a", title: "Alpha", content_text: "the zebra crossing" }),
      note({ id: "b", title: "Beta", content_text: "nothing here" }),
    ],
  });
  await page.goto("/Notes");
  await page.getByRole("button", { name: "Search notes" }).click();
  await page.keyboard.type("zebra");
  await expect(page.getByTestId("note-row-a")).toBeVisible();
  await expect(page.getByTestId("note-row-b")).toHaveCount(0);
});

test("on a phone, tapping Notes in the nav goes back from a note to the list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority], notes: [note()] });
  await page.goto("/Notes");

  await page.getByTestId("note-row-note-1").click();
  await expect(page.getByTestId("note-back")).toBeVisible();

  await page.getByRole("link", { name: "Notes", exact: true }).filter({ visible: true }).click();
  await expect(page.getByTestId("note-row-note-1")).toBeVisible();
  await expect(page.getByTestId("note-back")).toBeHidden();
});
