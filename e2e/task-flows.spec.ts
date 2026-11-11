import { expect, test, type Locator, type Page } from "@playwright/test";
import { installMockBackend } from "./utils/mockBackend";
import { holdToast, toastSays } from "./utils/toast";

const formatDateOffset = (offsetDays = 0) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

const defaultPriority = {
  id: "priority-1",
  name: "Medium",
  order: 1,
  color: "slate",
};

const recurringTask = (overrides: Record<string, any> = {}) => ({
  id: "series-1",
  title: "Series task",
  description: "",
  priority_id: defaultPriority.id,
  status: "todo",
  task_type: "recurring",
  recurrence: "daily",
  recurrence_days: [],
  recurrence_end_date: "",
  due_date: formatDateOffset(0),
  task_time: "",
  tags: [],
  completed_at: "",
  ...overrides,
});

const taskCardByTitle = (page: Page, title: string) =>
  page.locator(`[data-testid^="task-card-"][data-task-title="${title}"]`);

const getPendingMutationCount = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((entry) => entry.startsWith("taskflow_pending_mutations"));
    return JSON.parse(localStorage.getItem(key || "") || "[]").length;
  });

/**
 * Click outside a Radix dialog until it closes. Radix starts listening for
 * outside presses one tick after the dialog mounts (setTimeout 0), so a
 * click fired the instant it becomes visible can land before the listener
 * exists and be ignored — which a slow CI runner hit. Retrying still fails
 * if outside clicks stop dismissing; it just can't lose that race.
 */
async function dismissByClickingOutside(page: Page, dialogText: string) {
  const dialog = page.getByText(dialogText);
  await expect(async () => {
    await page.mouse.click(10, 10);
    await expect(dialog).toHaveCount(0, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

async function swipeTaskCard(page: Page, card: Locator) {
  const box = await card.boundingBox();
  if (!box) throw new Error("Task card bounds were unavailable");

  await page.mouse.move(box.x + box.width * 0.82, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.08, box.y + box.height / 2, { steps: 18 });
  await page.mouse.up();
}

test("delete this reminder only skips to the next recurring instance", async ({ page }) => {
  const api = await installMockBackend(page, {
    tasks: [recurringTask()],
    priorities: [defaultPriority],
  });

  await page.goto("/Today");
  const card = taskCardByTitle(page, "Series task");
  await expect(card).toBeVisible();

  await swipeTaskCard(page, card);
  await expect(page.getByText("Delete recurring task")).toBeVisible();
  await page.getByTestId("recurring-delete-this").click();

  await expect(card).toHaveCount(0);
  const state = await api.getState();
  expect(state.tasks).toHaveLength(1);
  expect(state.tasks[0].due_date).toBe(formatDateOffset(1));

  await page.goto("/Active");
  await expect(taskCardByTitle(page, "Series task")).toBeVisible();
});

test("delete dialogs close when clicking outside without deleting anything", async ({ page }) => {
  const api = await installMockBackend(page, {
    tasks: [
      recurringTask(),
      {
        id: "done-1",
        title: "Done task",
        description: "",
        priority_id: defaultPriority.id,
        status: "done",
        task_type: "one_time",
        recurrence: "none",
        recurrence_days: [],
        recurrence_end_date: "",
        due_date: formatDateOffset(0),
        task_time: "",
        tags: [],
        completed_at: new Date().toISOString(),
      },
    ],
    priorities: [defaultPriority],
    deletedTasks: [
      {
        id: "deleted-1",
        task_id: "deleted-source-1",
        title: "Deleted task",
        description: "",
        priority_id: defaultPriority.id,
        status: "todo",
        task_type: "one_time",
        recurrence: "none",
        recurrence_days: [],
        recurrence_end_date: "",
        due_date: formatDateOffset(0),
        task_time: "",
        tags: [],
        completed_at: "",
        deleted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        was_completed: false,
        subtasks: [],
      },
    ],
  });

  await page.goto("/Today");
  await swipeTaskCard(page, taskCardByTitle(page, "Series task"));
  await expect(page.getByText("Delete recurring task")).toBeVisible();
  await dismissByClickingOutside(page, "Delete recurring task");
  await expect(taskCardByTitle(page, "Series task")).toBeVisible();

  await page.goto("/Completed");
  await page.getByTitle("Delete all completed").click();
  await expect(page.getByText("Delete all completed tasks?")).toBeVisible();
  await dismissByClickingOutside(page, "Delete all completed tasks?");
  await expect(page.getByText("Done task")).toBeVisible();

  await page.goto("/RecentlyDeleted");
  await page.getByTitle("Empty recently deleted").click();
  await expect(page.getByText("Permanently Delete everything in Recently Deleted?")).toBeVisible();
  await dismissByClickingOutside(page, "Permanently Delete everything in Recently Deleted?");

  const state = await api.getState();
  expect(state.tasks.find((task) => task.id === "series-1")).toBeTruthy();
  expect(state.tasks.find((task) => task.id === "done-1")).toBeTruthy();
  expect(state.deletedTasks).toHaveLength(1);
});

test("emptying completed moves only the deleted completed tasks into recently deleted and undo restores cleanly", async ({ page }) => {
  const existingDeletedTitle = "Older deleted task";

  const api = await installMockBackend(page, {
    tasks: [
      {
        id: "done-1",
        title: "Completed task one",
        description: "",
        priority_id: defaultPriority.id,
        status: "done",
        task_type: "one_time",
        recurrence: "none",
        recurrence_days: [],
        recurrence_end_date: "",
        due_date: formatDateOffset(0),
        task_time: "",
        tags: [],
        completed_at: new Date().toISOString(),
      },
      {
        id: "done-2",
        title: "Completed task two",
        description: "",
        priority_id: defaultPriority.id,
        status: "done",
        task_type: "one_time",
        recurrence: "none",
        recurrence_days: [],
        recurrence_end_date: "",
        due_date: formatDateOffset(1),
        task_time: "",
        tags: [],
        completed_at: new Date().toISOString(),
      },
    ],
    priorities: [defaultPriority],
    deletedTasks: [
      {
        id: "deleted-existing-1",
        task_id: "deleted-source-1",
        title: existingDeletedTitle,
        description: "",
        priority_id: defaultPriority.id,
        status: "todo",
        task_type: "one_time",
        recurrence: "none",
        recurrence_days: [],
        recurrence_end_date: "",
        due_date: formatDateOffset(-1),
        task_time: "",
        tags: [],
        completed_at: "",
        deleted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        was_completed: false,
        subtasks: [],
      },
    ],
  });

  await page.goto("/Completed");
  await expect(page.getByText("Completed task one")).toBeVisible();
  await expect(page.getByText("Completed task two")).toBeVisible();

  await page.getByTitle("Delete all completed").click();
  const toast = await holdToast(page);
  await page.getByRole("button", { name: "Delete all" }).click();

  await expect(page.getByText("Completed task one")).toHaveCount(0);
  await expect(page.getByText("Completed task two")).toHaveCount(0);

  const deletedState = await api.getState();
  expect(deletedState.deletedTasks.map((record) => record.title)).toEqual(
    expect.arrayContaining([existingDeletedTitle, "Completed task one", "Completed task two"])
  );
  expect(deletedState.deletedTasks.filter((record) => record.title === "Completed task one")).toHaveLength(1);
  expect(deletedState.deletedTasks.filter((record) => record.title === "Completed task two")).toHaveLength(1);
  expect(deletedState.deletedTasks.filter((record) => record.title === existingDeletedTitle)).toHaveLength(1);

  await page.getByTestId("delete-toast-undo").click();
  await toast.release();

  const restoredState = await api.getState();
  expect(restoredState.tasks.map((task) => task.title)).toEqual(
    expect.arrayContaining(["Completed task one", "Completed task two"])
  );
  expect(restoredState.deletedTasks.filter((record) => record.title === existingDeletedTitle)).toHaveLength(1);
  expect(restoredState.deletedTasks.filter((record) => record.title === "Completed task one")).toHaveLength(0);
  expect(restoredState.deletedTasks.filter((record) => record.title === "Completed task two")).toHaveLength(0);

  await page.goto("/RecentlyDeleted");
  await expect(page.getByText(existingDeletedTitle)).toBeVisible();
  await expect(page.getByText(existingDeletedTitle)).toHaveCount(1);
  await expect(page.getByText("Completed task one")).toHaveCount(0);
  await expect(page.getByText("Completed task two")).toHaveCount(0);

  await page.goto("/Completed");
  await expect(page.getByText("Completed task one")).toBeVisible();
  await expect(page.getByText("Completed task two")).toBeVisible();

  await page.goto("/RecentlyDeleted");
  await expect(page.getByText(existingDeletedTitle)).toBeVisible();
  await expect(page.getByText(existingDeletedTitle)).toHaveCount(1);
  await expect(page.getByText("Completed task one")).toHaveCount(0);
  await expect(page.getByText("Completed task two")).toHaveCount(0);
});

test("groupings uses the recurring delete confirmation before removing a recurring task", async ({ page }) => {
  const api = await installMockBackend(page, {
    tasks: [recurringTask()],
    priorities: [defaultPriority],
  });

  await page.goto("/Groupings");
  await page.getByText("Series task").click();
  await page.getByTestId("task-form-delete").click();

  await expect(page.getByText("Delete recurring task")).toBeVisible();
  await page.getByTestId("recurring-delete-all").click();
  await expect(page.getByText("Delete recurring task")).toHaveCount(0);

  const state = await api.getState();
  expect(state.tasks).toHaveLength(0);
});

test("delete all future reminders removes the series and undo restores it across reload", async ({ page }) => {
  await installMockBackend(page, {
    tasks: [recurringTask()],
    priorities: [defaultPriority],
  });

  await page.goto("/Today");
  const card = taskCardByTitle(page, "Series task");
  await expect(card).toBeVisible();

  await swipeTaskCard(page, card);
  const toast = await holdToast(page);
  await page.getByTestId("recurring-delete-all").click();

  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("delete-toast")).toBeVisible();

  await page.getByTestId("delete-toast-undo").click();
  await toast.release();
  await expect(taskCardByTitle(page, "Series task")).toBeVisible();

  await page.reload();
  await expect(taskCardByTitle(page, "Series task")).toBeVisible();
});

test("completing a recurring task advances it and creates a completed snapshot", async ({ page }) => {
  const api = await installMockBackend(page, {
    tasks: [
      recurringTask(),
      {
        id: "subtask-1",
        parent_id: "series-1",
        title: "Series subtask",
        status: "todo",
        task_type: "one_time",
        order: 0,
      },
    ],
    priorities: [defaultPriority],
  });

  await page.goto("/Today");
  await expect(taskCardByTitle(page, "Series task")).toBeVisible();

  await page.getByTestId("task-toggle-series-1").click();

  await expect(taskCardByTitle(page, "Series task")).toHaveCount(0);
  const state = await api.getState();

  // A one_time snapshot with status "done" should have been created as a live task
  const snapshot = state.tasks.find(
    (t) => t.task_type === "one_time" && t.status === "done" && t.title === "Series task"
  );
  expect(snapshot).toBeTruthy();

  // The recurring task should be advanced to the next day
  expect(state.tasks.find((t) => t.id === "series-1")?.due_date).toBe(formatDateOffset(1));

  // Snapshot is visible on the Completed page
  await page.goto("/Completed");
  await expect(page.getByText("Series task")).toBeVisible();

  // Recurring task is still visible on Active (with tomorrow's date)
  await page.goto("/Active");
  await expect(taskCardByTitle(page, "Series task")).toBeVisible();
});

test("offline task creation is replayed and survives a reload when connectivity returns", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const api = await installMockBackend(page, {
    tasks: [],
    priorities: [defaultPriority],
  });

  await page.goto("/Today");
  await expect(page.getByText("Clear skies. Add something when you're ready.")).toBeVisible();

  await context.setOffline(true);

  await page.getByRole("button", { name: /new task/i }).click();
  await page.getByTestId("task-form-title").fill("Offline task");
  await page.getByTestId("task-form-submit").click();

  await expect(taskCardByTitle(page, "Offline task")).toBeVisible();
  await expect
    .poll(async () => getPendingMutationCount(page))
    .toBe(1);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect
    .poll(async () => getPendingMutationCount(page))
    .toBe(0);

  const counters = await api.getCounters();
  expect(counters.taskCreates).toBe(1);

  await page.reload();
  await expect(taskCardByTitle(page, "Offline task")).toBeVisible();

  await context.close();
});

test("offline priority edits queue under the legacy key and replay when connectivity returns", async ({ browser }) => {
  // Priority is the first legacy entity migrated onto offlineEntityRegistry.
  // This pins the round trip end-to-end: the queue must still live under
  // taskflow_pending_priority_mutations (pre-migration builds wrote there),
  // and replay must reach the API.
  const context = await browser.newContext();
  const page = await context.newPage();
  const api = await installMockBackend(page, {
    tasks: [],
    priorities: [defaultPriority],
  });

  await page.goto("/Settings");
  await page.getByText("Tasks and Notes").click();
  await expect(page.getByText(defaultPriority.name)).toBeVisible();

  await context.setOffline(true);

  // Double-click the priority row to edit, rename it, commit with Enter.
  await page.getByText(defaultPriority.name).dblclick();
  // The row swaps to an inline editor; it's the first textbox in the section
  // (the "New priority name..." field follows it).
  const nameInput = page.getByRole("textbox").first();
  await nameInput.fill("Renamed Offline");
  await nameInput.press("Enter");

  await expect(page.getByText("Renamed Offline")).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((entry) =>
          entry.startsWith("taskflow_pending_priority_mutations")
        );
        return JSON.parse(localStorage.getItem(key || "") || "[]").length;
      })
    )
    .toBe(1);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((entry) =>
          entry.startsWith("taskflow_pending_priority_mutations")
        );
        return JSON.parse(localStorage.getItem(key || "") || "[]").length;
      })
    )
    .toBe(0);

  const state = await api.getState();
  expect(state.priorities.find((p) => p.id === defaultPriority.id)?.name).toBe("Renamed Offline");

  await context.close();
});

test("the task form submit is disabled without a title and without a date", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });

  await page.goto("/Today");
  await page.getByRole("button", { name: /new task/i }).click();

  const submit = page.getByTestId("task-form-submit");
  // Empty title → disabled.
  await expect(submit).toBeDisabled();

  // Title filled; new tasks default to today's date → enabled.
  await page.getByTestId("task-form-title").fill("needs a date");
  await expect(submit).toBeEnabled();

  // Clear the date → disabled again (every task must be scheduled).
  await page.getByTestId("task-form-date-trigger").click();
  await page.getByTestId("task-form-clear-date").click();
  await expect(submit).toBeDisabled();
});

test("email sign-in and settings logout return to the login screen", async ({ page }) => {
  const api = await installMockBackend(page, {
    tasks: [recurringTask()],
    priorities: [defaultPriority],
    currentUser: null,
  });

  await page.goto("/login?next=/Today");
  await page.getByTestId("login-email").fill("isaac@example.com");
  await page.getByTestId("login-password").fill("secret-password");
  await page.getByTestId("login-submit").click();

  await expect(page).toHaveURL(/\/Today$/);
  await expect(taskCardByTitle(page, "Series task")).toBeVisible();

  await page.goto("/Settings");
  await page.getByRole("button", { name: "Log out" }).first().click();
  await page.getByRole("button", { name: "Log out" }).last().click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId("login-email")).toBeVisible();

  const state = await api.getState();
  expect(state.currentUser).toBeNull();
});

test("google sign-in starts with the local auth callback target", async ({ page, baseURL }) => {
  const api = await installMockBackend(page, {
    tasks: [],
    priorities: [defaultPriority],
    currentUser: null,
  });

  await page.goto("/login?next=/Today");
  await page.getByRole("button", { name: "Sign In with Google" }).click();

  const meta = await api.getMeta();
  expect(meta.lastLoginProvider).toBe("google");
  expect(meta.lastLoginFromUrl).toBe(`${baseURL}/auth/callback?next=${encodeURIComponent(`${baseURL}/Today`)}`);
});

test("cancelling the new-task form creates nothing, and the create button is the only writer", async ({ page }) => {
  // The form used to autosave: a title plus the default date was enough to
  // create the task while you were still typing, and there was no way back
  // out. Creation is now deferred to the button so Cancel means "no task",
  // not "a task that was made and then removed".
  const api = await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });

  await page.goto("/Today");
  await page.getByRole("button", { name: /new task/i }).click();
  await page.getByTestId("task-form-title").fill("cancelled task");

  // Give the old autosave debounce (400ms) more than enough time to fire.
  await page.waitForTimeout(900);
  expect((await api.getState()).tasks.length).toBe(0);

  await page.getByTestId("task-form-cancel").click();
  await expect(page.getByTestId("task-form-dialog")).toBeHidden();
  expect((await api.getState()).tasks.length).toBe(0);
  await expect(taskCardByTitle(page, "cancelled task")).toHaveCount(0);

  // Escape is the same contract as Cancel while creating.
  await page.getByRole("button", { name: /new task/i }).click();
  await page.getByTestId("task-form-title").fill("escaped task");
  await page.waitForTimeout(900);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("task-form-dialog")).toBeHidden();
  expect((await api.getState()).tasks.length).toBe(0);

  // The button is what writes.
  await page.getByRole("button", { name: /new task/i }).click();
  await page.getByTestId("task-form-title").fill("kept task");
  await page.getByTestId("task-form-submit").click();
  await expect(taskCardByTitle(page, "kept task")).toHaveCount(1);
  expect((await api.getState()).tasks.map((t) => t.title)).toEqual(["kept task"]);
});

test("editing an existing task still autosaves without pressing anything", async ({ page }) => {
  // Deferred create must not have turned edits into explicit saves — an
  // open task still persists as you type, and closing commits it.
  const api = await installMockBackend(page, {
    tasks: [recurringTask({ id: "edit-me", title: "before", task_type: "one_time", recurrence: "none" })],
    priorities: [defaultPriority],
  });

  await page.goto("/Today");
  await taskCardByTitle(page, "before").click();
  await page.getByTestId("task-form-title").fill("after");
  await page.waitForTimeout(900);

  // No button pressed, yet the edit is already persisted.
  expect((await api.getState()).tasks.find((t) => t.id === "edit-me")?.title).toBe("after");

  // Edit mode has a Cancel too, but it CLOSES rather than reverts — the
  // fields were already autosaved above, and this pins that difference so
  // nobody later mistakes it for a discard.
  await expect(page.getByTestId("task-form-cancel")).toHaveCount(1);
  await page.getByTestId("task-form-cancel").click();
  await expect(page.getByTestId("task-form-dialog")).toBeHidden();
  expect((await api.getState()).tasks.find((t) => t.id === "edit-me")?.title).toBe("after");
});

test("clicking empty calendar time opens a new task there; the all-day strip makes an all-day one", async ({ page }) => {
  const api = await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });
  await page.addInitScript(() => window.localStorage.setItem("defaultCalendarView", "week"));
  await page.goto("/Calendar");

  const today = formatDateOffset(0);
  const column = page.getByTestId(`calendar-timed-${today}`);
  await expect(column).toBeVisible();
  // Bring 2 PM into view, then click just below the 2 PM line (week hours are 44px).
  await column.evaluate((el) => { el.closest(".overflow-auto")!.scrollTop = 14 * 44 - 120; });
  const box = (await column.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + 14 * 44 + 6);

  await expect(page.getByTestId("task-form-dialog")).toBeVisible();
  await page.getByTestId("task-form-title").fill("Dentist");
  await page.getByTestId("task-form-submit").click();
  await expect(page.getByTestId("task-form-dialog")).toBeHidden();

  const created = (await api.getState()).tasks.find((t) => t.title === "Dentist");
  expect(created).toMatchObject({ due_date: today, task_time: "2:00PM", task_end_time: "3:00PM" });

  // The all-day strip above the grid: same day, no time.
  await page.getByTestId(`calendar-allday-${today}`).click({ position: { x: 5, y: 5 } });
  await page.getByTestId("task-form-title").fill("Pay rent");
  await page.getByTestId("task-form-submit").click();
  await expect(page.getByTestId("task-form-dialog")).toBeHidden();
  const allDay = (await api.getState()).tasks.find((t) => t.title === "Pay rent");
  expect(allDay).toMatchObject({ due_date: today, task_time: "" });
});

test("dragging a task in week view reschedules it, showing the time it will land at; read-only events don't move", async ({ page }) => {
  const today = formatDateOffset(0);
  // A neighbouring day in the same Sunday-start week.
  const neighbour = formatDateOffset(new Date().getDay() === 0 ? 1 : -1);
  const api = await installMockBackend(page, {
    tasks: [
      recurringTask({ id: "drag-me", title: "Drag me", task_type: "one_time", recurrence: "none", due_date: today, task_time: "9:00AM", task_end_time: "10:30AM" }),
      recurringTask({ id: "holiday", title: "Holiday", task_type: "one_time", recurrence: "none", due_date: today, task_time: "",
        source_provider: "google", source_kind: "event", source_writable: false, source_calendar_name: "Holidays" }),
    ],
    priorities: [defaultPriority],
  });
  await page.addInitScript(() => window.localStorage.setItem("defaultCalendarView", "week"));
  await page.goto("/Calendar");

  const column = page.getByTestId(`calendar-timed-${today}`);
  await expect(column).toBeVisible();
  await column.evaluate((el) => { el.closest(".overflow-auto")!.scrollTop = 8 * 44; });

  const card = page.locator('[title="Drag me"]');
  const cardBox = (await card.boundingBox())!;
  const colBox = (await column.boundingBox())!;
  // Grab near the card's top and move that point to just past 2 PM.
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 6);
  await page.mouse.down();
  await page.mouse.move(colBox.x + colBox.width / 2, colBox.y + 14 * 44 + 6 + 4, { steps: 12 });
  await expect(page.getByTestId("calendar-drop-time")).toHaveText("2 PM – 3:30 PM");
  const toast = await holdToast(page);
  await page.mouse.up();

  await expect.poll(async () => (await api.getState()).tasks.find((t) => t.id === "drag-me"))
    .toMatchObject({ due_date: today, task_time: "2:00PM", task_end_time: "3:30PM" });

  // The move can be undone from the toast, back to exactly where it was.
  await expect(page.getByTestId("delete-toast")).toContainText("Moved “Drag me” to");
  await page.getByTestId("delete-toast-undo").click();
  await toast.release();
  await expect.poll(async () => (await api.getState()).tasks.find((t) => t.id === "drag-me"))
    .toMatchObject({ due_date: today, task_time: "9:00AM", task_end_time: "10:30AM" });

  // The read-only holiday can't be picked up and moved to another day.
  const holiday = page.locator('[title="Holiday"]');
  const holidayBox = (await holiday.boundingBox())!;
  const neighbourBox = (await page.getByTestId(`calendar-allday-${neighbour}`).boundingBox())!;
  await page.mouse.move(holidayBox.x + holidayBox.width / 2, holidayBox.y + holidayBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(neighbourBox.x + neighbourBox.width / 2, neighbourBox.y + 8, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect((await api.getState()).tasks.find((t) => t.id === "holiday")?.due_date).toBe(today);
});

test("dragging an event's bottom edge changes when it ends, and nothing else", async ({ page }) => {
  const today = formatDateOffset(0);
  const api = await installMockBackend(page, {
    tasks: [recurringTask({ id: "stretch", title: "Stretch me", task_type: "one_time", recurrence: "none", due_date: today, task_time: "9:00AM", task_end_time: "10:30AM" })],
    priorities: [defaultPriority],
  });
  await page.addInitScript(() => window.localStorage.setItem("defaultCalendarView", "week"));
  await page.goto("/Calendar");

  const column = page.getByTestId(`calendar-timed-${today}`);
  await expect(column).toBeVisible();
  await column.evaluate((el) => { el.closest(".overflow-auto")!.scrollTop = 8 * 44; });

  const event = page.getByTestId("calendar-event-stretch");
  await event.hover();
  const handle = page.getByTestId("calendar-resize-stretch");
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 44, { steps: 8 }); // one hour later (44px/hour)
  await expect(page.getByTestId("calendar-resize-time")).toHaveText("9 AM – 11:30 AM");
  await toastSays(page, "“Stretch me” now ends 11:30 AM", () => page.mouse.up());

  await expect.poll(async () => (await api.getState()).tasks.find((t) => t.id === "stretch"))
    .toMatchObject({ due_date: today, task_time: "9:00AM", task_end_time: "11:30AM" });
  // Letting go neither opened the task nor started a new one.
  await expect(page.getByTestId("task-form-dialog")).toHaveCount(0);
  expect((await api.getState()).tasks).toHaveLength(1);
});

test("a task can have its own reminder", async ({ page }) => {
  const api = await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });
  await page.goto("/Today");
  await page.getByRole("button", { name: "New Task" }).click();
  await page.getByTestId("task-form-title").fill("Dentist");
  await page.getByRole("switch", { name: "Set time" }).click();
  await page.getByRole("combobox", { name: "Reminder" }).click();
  await page.getByRole("option", { name: "1 hour before" }).click();
  await page.getByTestId("task-form-submit").click();
  await expect.poll(async () => (await api.getState()).tasks.find((t) => t.title === "Dentist")?.reminder).toBe("before:60");
});

test("the task form keeps what was typed: tags, a repeat, and a subtask left in its box", async ({ page }) => {
  const api = await installMockBackend(page, {
    tasks: [],
    priorities: [defaultPriority],
    savedTags: [{ id: "tg1", name: "errands" }],
  });
  await page.goto("/Today");
  await page.getByRole("button", { name: "New Task" }).click();
  // A new task opens with the caret already in its title.
  await expect(page.getByTestId("task-form-title")).toBeFocused();
  await page.keyboard.type("Water the plants");

  // One question, one dropdown: picking a pattern makes the task repeat.
  await page.getByRole("combobox", { name: "Repeat" }).click();
  await page.getByRole("option", { name: "Every week", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Ends" })).toBeVisible();

  // Tags: pick a saved one from the list, type a new one.
  const tagBox = page.getByLabel("Add a tag");
  await tagBox.click();
  await tagBox.pressSequentially("err");
  await page.getByRole("button", { name: "errands", exact: true }).click();
  await tagBox.pressSequentially("garden");
  await page.keyboard.press("Enter");
  // Enter in the tag box adds a tag — it must not finish the form.
  await expect(page.getByTestId("task-form-dialog")).toBeVisible();

  // A subtask typed but never "added" still counts when Create is pressed.
  await page.getByLabel("New subtask").fill("Fill the can");
  await page.getByTestId("task-form-submit").click();
  await expect(page.getByTestId("task-form-dialog")).toBeHidden();

  await expect.poll(async () => (await api.getState()).tasks.length).toBe(2);
  const tasks = (await api.getState()).tasks;
  const parent = tasks.find((t) => t.title === "Water the plants")!;
  expect(parent).toMatchObject({ task_type: "recurring", recurrence: "weekly", tags: ["errands", "garden"] });
  expect(tasks.find((t) => t.title === "Fill the can")).toMatchObject({ parent_id: parent.id });
});

test("a very long link in the task form wraps instead of making the form scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });
  await page.goto("/Today");
  await page.getByRole("button", { name: "New Task" }).click();

  const long = `https://example.com/a/link/with/no/spaces/${"abcdefghij".repeat(30)}`;
  const title = page.getByTestId("task-form-title");
  await title.fill(long);
  // The title wraps onto more lines and grows, rather than hiding most of
  // itself in one line.
  expect((await title.boundingBox())!.height).toBeGreaterThan(60);

  await page.getByTestId("task-form-dialog").locator(".tiptap-prose").click();
  await page.keyboard.insertText(long);
  await page.getByLabel("Add a tag").fill(long.slice(0, 120));
  await page.keyboard.press("Enter");
  await page.getByLabel("New subtask").fill(long.slice(0, 160));
  await page.keyboard.press("Enter");

  const overflow = await page.getByTestId("form-body").evaluate((body) => {
    const edge = body.getBoundingClientRect().right;
    const past = [...body.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().right > edge + 1);
    return { sideways: body.scrollWidth - body.clientWidth, past: past.length };
  });
  expect(overflow).toEqual({ sideways: 0, past: 0 });
});

test("files in the task form: a mixed pick keeps the good ones, and a drop anywhere in the form attaches", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });
  await page.goto("/Today");
  await page.getByRole("button", { name: "New Task" }).click();
  const form = page.getByTestId("task-form-dialog");
  await page.getByTestId("task-form-title").fill("Trip paperwork");

  await page.getByTestId("attachments-input").setInputFiles([
    { name: "itinerary.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 itinerary") },
    { name: "installer.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") },
    { name: "budget.xlsx", mimeType: "", buffer: Buffer.from("PK budget") },
  ]);
  await expect(form.getByText("itinerary.pdf")).toBeVisible();
  await expect(form.getByText("budget.xlsx")).toBeVisible();
  await expect(form.getByRole("alert")).toContainText(".exe files are not allowed");
  // Nothing is uploading yet — the task doesn't exist.
  await expect(form.getByText(/uploads when you save/)).toHaveCount(2);
  await expect(form.getByText(/Uploading/)).toHaveCount(0);

  // Drop a file on the title — nowhere near the "Add files" strip.
  const dropped = await page.getByTestId("task-form-title").evaluate((target) => {
    const data = new DataTransfer();
    data.items.add(new File(["boarding pass"], "boarding-pass.png", { type: "image/png" }));
    const fire = (type: string) =>
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
    // false = the app claimed it, so the browser won't open the file.
    return { over: fire("dragover"), drop: fire("drop") };
  });
  expect(dropped).toEqual({ over: false, drop: false });
  await expect(form.getByText("boarding-pass.png")).toBeVisible();
  await expect(page).toHaveURL(/\/Today/);

  // The form still saves with files picked.
  await page.getByTestId("task-form-submit").click();
  await expect(form).toBeHidden();
  await expect(page.getByText("Trip paperwork")).toBeVisible();
});

// A person holds the mouse button down for a moment. Anything that changes
// the layout when a box loses focus (which happens on mouse-DOWN) used to
// move the control being clicked before the button came up, so the click
// missed. Playwright's own click() is too fast to notice; these press,
// wait, and release.
async function humanClick(page: Page, target: Locator) {
  // Fully in view and at rest first: the form's opening animation, or the
  // browser scrolling a half-hidden control into view as it takes focus,
  // would otherwise read as the control moving.
  await target.evaluate(async (el) => {
    const dialog = el.closest("[role='dialog']");
    await Promise.all((dialog?.getAnimations() ?? []).map((animation) => animation.finished.catch(() => {})));
    el.scrollIntoView({ block: "center" });
  });
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + Math.min(40, box.width / 2), box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(80);
  const held = (await target.boundingBox())!;
  await page.mouse.up();
  return { movedWhileHeld: Math.round(held.y - box.y) };
}

test("clicking the date after typing a description doesn't miss", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });
  await page.goto("/Today");
  await page.getByRole("button", { name: "New Task" }).click();
  const form = page.getByTestId("task-form-dialog");
  await page.getByTestId("task-form-title").fill("Renew passport");
  await form.locator(".tiptap-prose").click();
  await page.keyboard.type("Bring two photos");
  await expect(page.getByTestId("richtext-style")).toBeVisible();

  const top = (await form.boundingBox())!.y;
  const click = await humanClick(page, page.getByTestId("task-form-date-trigger"));
  expect(click.movedWhileHeld).toBe(0);
  await expect(page.getByRole("grid")).toBeVisible();
  // The form hangs from the top: growing never moves what's above.
  expect(Math.round((await form.boundingBox())!.y - top)).toBe(0);
  // The format bar stays once it has appeared, so nothing jumps back up.
  await expect(page.getByTestId("richtext-style")).toBeVisible();
});

test("a subtask or tag left in its box doesn't make the next click miss, and is still kept", async ({ page }) => {
  const api = await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });
  await page.goto("/Today");
  await page.getByRole("button", { name: "New Task" }).click();
  const form = page.getByTestId("task-form-dialog");
  await page.getByTestId("task-form-title").fill("Post the parcel");

  // Typed, not entered — then straight to "Add files" below it.
  await page.getByLabel("New subtask").fill("Buy stamps");
  const chooser = page.waitForEvent("filechooser");
  const click = await humanClick(page, page.getByTestId("attachments-add"));
  expect(click.movedWhileHeld).toBe(0);
  await chooser;
  await expect(page.getByTestId("task-form-subtasks").getByText("Buy stamps")).toBeVisible();

  // Same for a tag, then straight to Create.
  await page.getByLabel("Add a tag").fill("errands");
  await humanClick(page, page.getByTestId("task-form-submit"));
  await expect(form).toBeHidden();
  const tasks = (await api.getState()).tasks;
  expect(tasks.find((t) => t.title === "Post the parcel")).toMatchObject({ tags: ["errands"] });
  expect(tasks.some((t) => t.title === "Buy stamps")).toBe(true);
});

test("Escape in the link box closes the link box, not the whole form", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });
  await page.goto("/Today");
  await page.getByRole("button", { name: "New Task" }).click();
  const form = page.getByTestId("task-form-dialog");
  await page.getByTestId("task-form-title").fill("Book the venue");
  await form.locator(".tiptap-prose").click();
  await page.keyboard.type("Their site");

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("richtext-link-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("richtext-link-input")).toBeHidden();
  // The half-written task is still there.
  await expect(form).toBeVisible();
  await expect(page.getByTestId("task-form-title")).toHaveValue("Book the venue");

  // A menu from the format bar closes on Escape the same way.
  await page.getByTestId("richtext-style").click();
  await expect(page.getByTestId("richtext-style-h1")).toBeVisible();
  // All of it shows: the form's scrolling body used to cut the top off.
  await expect(page.getByTestId("richtext-style-paragraph")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("richtext-clear-formatting")).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("richtext-style-h1")).toBeHidden();
  await expect(form).toBeVisible();
});

test("the date pop-up fills only the day you pick, and closes when you pick it", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });
  await page.goto("/Today");
  await page.getByRole("button", { name: "New Task" }).click();
  const trigger = page.getByTestId("task-form-date-trigger");
  await expect(trigger).toContainText("Today");

  await trigger.click();
  const filled = () =>
    page.locator('[role="gridcell"]').evaluateAll((cells) =>
      cells
        .filter((cell) => {
          const [r, g, b, a = "1"] = (getComputedStyle(cell).backgroundColor.match(/[\d.]+/g) || []);
          return Number(a) > 0.5 && !(r === "255" && g === "255" && b === "255");
        })
        .map((cell) => cell.getAttribute("aria-selected"))
    );
  // Today is the picked day: one filled cell, and it is the selected one.
  expect(await filled()).toEqual(["true"]);

  await page.getByRole("button", { name: "Tomorrow" }).click();
  await expect(trigger).toContainText("Tomorrow");
  // Picking closed the pop-up.
  await expect(page.locator('[role="gridcell"]')).toHaveCount(0);

  await trigger.click();
  // Tomorrow is filled; today is NOT (it used to be, in a second colour).
  expect(await filled()).toEqual(["true"]);
});

test("a deleted task comes back from Recently Deleted with its end time, reminder and formatting", async ({ page }) => {
  const richDoc = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Bring card", marks: [{ type: "bold" }] }] }] });
  const api = await installMockBackend(page, {
    tasks: [
      recurringTask({
        id: "full", title: "Full task", task_type: "one_time", recurrence: "none",
        task_time: "2:00PM", task_end_time: "3:30PM", reminder: "before:60",
        description: "Bring card", description_json: richDoc,
      }),
    ],
    priorities: [defaultPriority],
  });
  await page.goto("/Today");
  await taskCardByTitle(page, "Full task").click();
  await page.getByTestId("task-form-delete").click();
  await expect.poll(async () => (await api.getState()).tasks.length).toBe(0);

  await page.goto("/RecentlyDeleted");
  await page.getByRole("button", { name: "Restore" }).first().click();
  await expect.poll(async () => (await api.getState()).tasks.find((t) => t.title === "Full task"))
    .toMatchObject({ task_time: "2:00PM", task_end_time: "3:30PM", reminder: "before:60", description_json: richDoc });
});

test("a deleted task keeps its files in Recently Deleted, still counted, and they come back when it's restored", async ({ page }) => {
  const api = await installMockBackend(page, {
    tasks: [
      recurringTask({ id: "trip", title: "Plan the trip", task_type: "one_time", recurrence: "none", attachment_count: 1 }),
      recurringTask({ id: "other", title: "Other task", task_type: "one_time", recurrence: "none", attachment_count: 1 }),
    ],
    priorities: [defaultPriority],
    attachments: [
      { id: "att-pass", task_id: "trip", filename: "Boarding pass.pdf", mime_type: "application/pdf", size_bytes: 180_000, is_image: false, has_thumb: false },
      { id: "att-other", task_id: "other", filename: "Other.pdf", mime_type: "application/pdf", size_bytes: 20_000, is_image: false, has_thumb: false },
    ],
  });
  const storageLine = async (title: string) => {
    await page.goto("/Settings");
    await page.getByText("Search attachments and check storage").click();
    return page.getByRole("listitem").filter({ hasText: title });
  };

  await page.goto("/Today");
  await taskCardByTitle(page, "Plan the trip").click();
  await expect(page.getByText("Boarding pass.pdf")).toBeVisible();
  await page.getByTestId("task-form-delete").click();
  await expect.poll(async () => (await api.getState()).tasks.map((t) => t.title)).toEqual(["Other task"]);

  // Held with the task in Recently Deleted: still counted, and marked where it is.
  const held = await storageLine("Plan the trip");
  await expect(held).toContainText("1 file · in Recently Deleted");
  await expect(held).toContainText("180.0 KB");
  await expect(page.getByRole("listitem").filter({ hasText: "Other task" })).not.toContainText("Recently Deleted");

  await page.goto("/RecentlyDeleted");
  await page.getByRole("button", { name: "Restore" }).click();
  await expect.poll(async () => (await api.getState()).tasks.find((t) => t.title === "Plan the trip")?.attachment_count).toBe(1);

  await page.goto("/Today");
  const restored = taskCardByTitle(page, "Plan the trip");
  await expect(restored.getByTitle("1 attachment")).toBeVisible();
  await restored.click();
  await expect(page.getByText("Boarding pass.pdf")).toBeVisible();

  const back = await storageLine("Plan the trip");
  await expect(back).toContainText("1 file");
  await expect(back).not.toContainText("Recently Deleted");
});

test("undoing a delete brings the task back with its files", async ({ page }) => {
  await installMockBackend(page, {
    tasks: [
      recurringTask({ id: "tax", title: "Taxes", task_type: "one_time", recurrence: "none", attachment_count: 1 }),
      recurringTask({ id: "tax-step", title: "Find the W-2", parent_id: "tax", task_type: "one_time", recurrence: "none", attachment_count: 1 }),
    ],
    priorities: [defaultPriority],
    attachments: [
      { id: "att-return", task_id: "tax", filename: "Return.pdf", mime_type: "application/pdf", size_bytes: 50_000, is_image: false, has_thumb: false },
      { id: "att-w2", task_id: "tax-step", filename: "W-2.pdf", mime_type: "application/pdf", size_bytes: 30_000, is_image: false, has_thumb: false },
    ],
  });

  await page.goto("/Today");
  await taskCardByTitle(page, "Taxes").click();
  const toast = await holdToast(page);
  await page.getByTestId("task-form-delete").click();
  await expect(taskCardByTitle(page, "Taxes")).toHaveCount(0);
  await page.getByTestId("delete-toast-undo").click();
  await toast.release();

  // The paperclip is there at once, not after the next refetch.
  const card = taskCardByTitle(page, "Taxes");
  await expect(card.getByTitle("1 attachment")).toBeVisible();
  await card.click();
  await expect(page.getByText("Return.pdf")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/Settings");
  await page.getByText("Search attachments and check storage").click();
  await expect(page.getByRole("listitem").filter({ hasText: "Taxes" })).toContainText("1 file");
  // The subtask came back with its own file too.
  await expect(page.getByRole("listitem").filter({ hasText: "Find the W-2" })).toContainText("1 file");
  await expect(page.getByRole("listitem").filter({ hasText: "in Recently Deleted" })).toHaveCount(0);
});

test("groupings: the page itself never scrolls, a sideways swipe always moves the board, and d / t switch boards", async ({ page }) => {
  // Enough overdue tasks that the Past column is far taller than the
  // screen, and enough columns that the board is wider than it.
  const tasks = Array.from({ length: 60 }, (_, i) => ({
    id: `grouped-${i}`,
    title: `Grouped task ${i}`,
    description: "",
    priority_id: defaultPriority.id,
    status: "todo",
    task_type: "one_time",
    recurrence: "none",
    due_date: formatDateOffset(i < 50 ? -3 - (i % 20) : i - 50),
    task_time: "",
    tags: i % 2 ? ["home"] : ["work"],
    completed_at: "",
  }));
  await installMockBackend(page, { tasks, priorities: [defaultPriority] });
  await page.setViewportSize({ width: 900, height: 640 });
  await page.goto("/Groupings");

  const board = page.getByTestId("groupings-board");
  const past = page.getByTestId("group-past");
  await expect(past).toBeVisible();

  // The page is exactly the screen: nothing to scroll but the columns.
  const pageOverflow = () => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(await pageOverflow()).toBe(0);
  const pastBox = (await past.boundingBox())!;
  expect(pastBox.y + pastBox.height).toBeLessThanOrEqual(640);

  // Up and down over a column scrolls that column, and only it.
  const list = past.locator("> div");
  await page.mouse.move(pastBox.x + pastBox.width / 2, pastBox.y + 160);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // Sideways, straight after and with the pointer still over that list
  // (the case that used to need a click first), moves the board.
  const before = await board.evaluate((el) => el.scrollLeft);
  await page.mouse.wheel(160, 6);
  await expect.poll(() => board.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);

  // t and d switch the board.
  await page.mouse.move(2, 2);
  await page.keyboard.press("t");
  await expect(page.getByTestId("group-tag-home")).toBeVisible();
  await expect(past).toHaveCount(0);
  await page.keyboard.press("d");
  await expect(past).toBeVisible();
  expect(await pageOverflow()).toBe(0);
});

test("calendar: Today and the arrows sit before the date, and midnight's label is whole", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });
  await page.addInitScript(() => window.localStorage.setItem("defaultCalendarView", "week"));
  await page.goto("/Calendar");

  const left = async (locator: Locator) => (await locator.boundingBox())!.x;
  const today = page.getByRole("button", { name: "Today", exact: true });
  const previous = page.getByRole("button", { name: "Previous" });
  const next = page.getByRole("button", { name: "Next", exact: true });
  const range = page.getByTestId("calendar-range");
  await expect(range).toBeVisible();
  expect(await left(today)).toBeLessThan(await left(previous));
  expect(await left(previous)).toBeLessThan(await left(next));
  expect(await left(next)).toBeLessThan(await left(range));

  // Scrolled to the very top, "12 AM" is fully inside the grid: its top
  // edge is below the bottom of the day headers.
  for (const view of ["w", "d"]) {
    await page.keyboard.press(view);
    const label = page.getByText("12 AM", { exact: true }).first();
    await expect(label).toBeVisible();
    const clipped = await label.evaluate((el) => {
      let scroller: HTMLElement | null = el.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      if (!scroller) return "no scroller";
      scroller.scrollTop = 0;
      const top = el.getBoundingClientRect().top;
      const sticky = scroller.querySelector(".sticky");
      const limit = Math.max(scroller.getBoundingClientRect().top, sticky ? sticky.getBoundingClientRect().bottom : 0);
      return top >= limit ? "" : `label top ${top} is above ${limit}`;
    });
    expect(clipped).toBe("");
  }
});
