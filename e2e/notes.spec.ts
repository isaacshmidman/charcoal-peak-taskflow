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

/** The text the editor itself has selected (what Make task reads). */
const editorSelection = (page: Page) =>
  page.evaluate(() => {
    const editor = (document.querySelector('[data-testid="note-scroll"] .tiptap-prose') as any)?.editor;
    if (!editor) return null;
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to);
  });

/**
 * Select the first `text.length` characters of the note from the start of
 * the line, and don't move on until the editor itself holds that
 * selection. On a busy CI runner the keys can race the editor: it has
 * taken in only part of the selection ("Call th", a click landing too
 * early), or none of it (the keys arriving before it had focus). Checking
 * once didn't cover the second, so select, wait a moment for the editor to
 * catch up, and start over if it hasn't.
 */
async function selectFromLineStart(page: Page, text: string) {
  await expect(async () => {
    await editorBody(page).click();
    await page.keyboard.press("Home");
    for (let i = 0; i < text.length; i += 1) await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(() => editorSelection(page), { timeout: 3_000 }).toBe(text);
  }).toPass({ timeout: 20_000 });
}

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

  await selectFromLineStart(page, "Call the plumber");
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
  await selectFromLineStart(page, "Call the plumber");
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

// ── Schedule Builder ────────────────────────────────────────────────────

const slots = (page: Page) => page.getByTestId("schedule-slot");
/** "7:00 AM – 8:00 AM" for each slot, from its start field's name. */
const slotRanges = (page: Page) =>
  page.getByTestId("slot-start").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")!.replace("Start of ", "")));
const savedSchedule = async (api: Awaited<ReturnType<typeof installMockBackend>>, id: string) => {
  const stored = (await api.getState()).notes.find((n) => n.id === id)?.schedule_json;
  return stored ? JSON.parse(stored) : null;
};

test("Schedule turns a note into the day by the hour, and typing a new end moves the slots after it", async ({ page }) => {
  const api = await installMockBackend(page, { tasks: [], priorities: [defaultPriority], notes: [note({ title: "Saturday" })] });
  await page.goto("/Notes");
  await page.getByRole("switch", { name: "Schedule builder" }).click();

  await expect(slots(page)).toHaveCount(24);
  const ranges = await slotRanges(page);
  expect(ranges.slice(0, 2)).toEqual(["12:00 AM – 1:00 AM", "1:00 AM – 2:00 AM"]);
  expect(ranges.at(-1)).toBe("11:00 PM – 12:00 AM");

  // 7:00 – 8:00 AM: click the end's hour, type 07 then 30.
  await page.getByRole("textbox", { name: "End of 7:00 AM – 8:00 AM, hour" }).click();
  await page.keyboard.type("07");
  await expect(page.getByRole("alert")).toHaveText("The end has to be after the start (7:00 AM).");
  await page.keyboard.type("30");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("delete-toast")).toContainText("Adjusted 16 other slots and added 1 empty slot.");
  expect((await slotRanges(page)).slice(7, 10)).toEqual(["7:00 AM – 7:30 AM", "7:30 AM – 8:30 AM", "8:30 AM – 9:30 AM"]);

  await page.getByRole("textbox", { name: "What’s happening 7:00 AM – 7:30 AM" }).fill("Breakfast");
  await expect.poll(async () => (await savedSchedule(api, "note-1"))?.slots.find((s: any) => s.text === "Breakfast"))
    .toMatchObject({ start: 7 * 60, end: 7 * 60 + 30 });

  await page.reload();
  await expect(page.getByTestId("note-row-note-1")).toContainText("7:00 AM Breakfast");
  await expect(page.getByRole("textbox", { name: "What’s happening 7:00 AM – 7:30 AM" })).toHaveValue("Breakfast");
});

test("an end before its start is put back, with the reason", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority], notes: [note()] });
  await page.goto("/Notes");
  await page.getByRole("switch", { name: "Schedule builder" }).click();

  await page.getByRole("textbox", { name: "End of 7:00 AM – 8:00 AM, hour" }).click();
  await page.keyboard.type("6");
  await page.getByTestId("note-title-input").click();
  await expect(page.getByTestId("delete-toast")).toContainText("The end has to be after the start (7:00 AM).");
  expect((await slotRanges(page))[7]).toBe("7:00 AM – 8:00 AM");
});

test("Advanced settings: a 5-minute gap ends every slot 5 minutes before the next", async ({ page }) => {
  const api = await installMockBackend(page, { tasks: [], priorities: [defaultPriority], notes: [note()] });
  await page.goto("/Notes");
  await page.getByRole("switch", { name: "Schedule builder" }).click();
  await page.getByRole("button", { name: "Advanced settings" }).click();
  await page.getByTestId("gap-5").click();

  expect((await slotRanges(page)).slice(0, 2)).toEqual(["12:00 AM – 12:55 AM", "1:00 AM – 1:55 AM"]);
  await expect.poll(async () => (await savedSchedule(api, "note-1"))?.gap).toBe(5);

  // Only the slot next to a change moves, when chosen.
  await page.getByRole("radio", { name: /Only change the slot next to it/ }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "End of 7:00 AM – 7:55 AM, minutes" }).click();
  await page.keyboard.type("25");
  expect((await slotRanges(page)).slice(7, 10)).toEqual(["7:00 AM – 7:25 AM", "7:30 AM – 8:55 AM", "9:00 AM – 9:55 AM"]);
});

test("switching Schedule off shows the note's text again, untouched", async ({ page }) => {
  await installMockBackend(page, {
    tasks: [],
    priorities: [defaultPriority],
    notes: [note({ content_text: "Pack the tent" })],
  });
  await page.goto("/Notes");
  await expect(editorBody(page)).toContainText("Pack the tent");
  const toggle = page.getByRole("switch", { name: "Schedule builder" });
  await toggle.click();
  await expect(page.getByText("This note’s text is kept. Turn Schedule off to see it.")).toBeVisible();
  await toggle.click();
  await expect(editorBody(page)).toContainText("Pack the tent");
  await expect(slots(page)).toHaveCount(0);
});

test("the day's start and end in Advanced settings change how many slots there are", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority], notes: [note()] });
  await page.goto("/Notes");
  await page.getByRole("switch", { name: "Schedule builder" }).click();
  await page.getByRole("button", { name: "Advanced settings" }).click();

  // "7 to 11": typed over midnight at the end of the day, 11 is 11 PM.
  await page.getByRole("textbox", { name: "Day starts, hour" }).click();
  await page.keyboard.type("7");
  await page.getByRole("textbox", { name: "Day ends, hour" }).click();
  await page.keyboard.type("11");
  await page.keyboard.press("Enter");
  await expect(slots(page)).toHaveCount(16);
  const ranges = await slotRanges(page);
  expect([ranges[0], ranges.at(-1)]).toEqual(["7:00 AM – 8:00 AM", "10:00 PM – 11:00 PM"]);

  // "7 to 1": 1 PM, the nearer side of the day.
  await page.getByRole("textbox", { name: "Day ends, hour" }).click();
  await page.keyboard.type("1");
  await page.keyboard.press("Enter");
  await expect(slots(page)).toHaveCount(6);
  expect((await slotRanges(page)).at(-1)).toBe("12:00 PM – 1:00 PM");
});

test("a pinned setting is where every new schedule starts", async ({ page }) => {
  // Not "note-1": the mock numbers the notes it creates the same way.
  const api = await installMockBackend(page, { tasks: [], priorities: [defaultPriority], notes: [note({ id: "routine", title: "Routine" })] });
  await page.goto("/Notes");
  await page.getByRole("switch", { name: "Schedule builder" }).click();
  await page.getByRole("button", { name: "Advanced settings" }).click();
  await page.getByRole("textbox", { name: "Day starts, hour" }).click();
  await page.keyboard.type("7");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Pin when the day starts for every new schedule" }).click();
  await expect(page.getByRole("button", { name: "Pin when the day starts for every new schedule" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => ((await api.getState()) as any).scheduleDefaults).toEqual({ dayStart: 7 * 60 });
  await page.keyboard.press("Escape");

  await page.getByTestId("new-note-button").click();
  await page.getByRole("switch", { name: "Schedule builder" }).click();
  await expect(slots(page)).toHaveCount(17);
  expect((await slotRanges(page))[0]).toBe("7:00 AM – 8:00 AM");
});

test("Add to calendar turns filled slots into tasks on the day chosen, once, and Undo takes them back", async ({ page }) => {
  const api = await installMockBackend(page, { tasks: [], priorities: [defaultPriority], notes: [note({ id: "plan", title: "Plan" })] });
  await page.goto("/Notes");
  await page.getByRole("switch", { name: "Schedule builder" }).click();
  await page.getByRole("textbox", { name: "What’s happening 7:00 AM – 8:00 AM" }).fill("Breakfast");
  await page.getByRole("textbox", { name: "What’s happening 9:00 AM – 10:00 AM" }).fill("Gym");

  const tomorrow = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const added = async () =>
    (await api.getState()).tasks.filter((t: any) => t.due_date === tomorrow).map((t: any) => `${t.title} ${t.task_time}-${t.task_end_time}`).sort();

  await page.getByRole("button", { name: "Add to calendar" }).click();
  await page.getByRole("button", { name: "Tomorrow" }).click();
  await page.getByRole("checkbox", { name: "Add Gym" }).click();
  await expect(page.getByRole("checkbox", { name: "Add Gym" })).toHaveAttribute("aria-checked", "false");
  // The row's text ticks it too, once.
  await page.getByTestId("add-to-calendar-slots").getByText("Gym").click();
  await expect(page.getByRole("checkbox", { name: "Add Gym" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("checkbox", { name: "Add Gym" }).click();
  await page.getByTestId("add-to-calendar-confirm").click();
  await expect(page.getByTestId("delete-toast")).toContainText("Added 1 task to");
  await expect.poll(added).toEqual(["Breakfast 7:00AM-8:00AM"]);

  // Opened again for the same day: Breakfast is already there.
  await page.getByRole("button", { name: "Add to calendar" }).click();
  await page.getByRole("button", { name: "Tomorrow" }).click();
  await expect(page.getByTestId("add-to-calendar-slots")).toContainText("Already on this day");
  await expect(page.getByTestId("add-to-calendar-confirm")).toHaveText(/^Add 1 task to /);
  await page.getByTestId("add-to-calendar-confirm").click();
  await expect.poll(added).toEqual(["Breakfast 7:00AM-8:00AM", "Gym 9:00AM-10:00AM"]);

  // The newest toast (the one before may still be fading out).
  await page.getByTestId("delete-toast-undo").last().click();
  await expect.poll(added).toEqual(["Breakfast 7:00AM-8:00AM"]);
});
