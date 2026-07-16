import { expect, test, type Locator, type Page } from "@playwright/test";
import { installMockBackend } from "./utils/mockBackend";

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
  await page.mouse.click(10, 10);
  await expect(page.getByText("Delete recurring task")).toHaveCount(0);
  await expect(taskCardByTitle(page, "Series task")).toBeVisible();

  await page.goto("/Completed");
  await page.getByTitle("Delete all completed").click();
  await expect(page.getByText("Delete all completed tasks?")).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(page.getByText("Delete all completed tasks?")).toHaveCount(0);
  await expect(page.getByText("Done task")).toBeVisible();

  await page.goto("/RecentlyDeleted");
  await page.getByTitle("Empty recently deleted").click();
  await expect(page.getByText("Permanently Delete everything in Recently Deleted?")).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(page.getByText("Permanently Delete everything in Recently Deleted?")).toHaveCount(0);

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
  await page.getByTestId("recurring-delete-all").click();

  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("delete-toast")).toBeVisible();

  await page.getByTestId("delete-toast-undo").click();
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

test("google sign-in starts with the local auth callback target", async ({ page }) => {
  const api = await installMockBackend(page, {
    tasks: [],
    priorities: [defaultPriority],
    currentUser: null,
  });

  await page.goto("/login?next=/Today");
  await page.getByRole("button", { name: "Sign In with Google" }).click();

  const meta = await api.getMeta();
  expect(meta.lastLoginProvider).toBe("google");
  expect(meta.lastLoginFromUrl).toBe("http://127.0.0.1:4173/auth/callback?next=http%3A%2F%2F127.0.0.1%3A4173%2FToday");
});
