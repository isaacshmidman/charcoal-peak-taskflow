import { expect, test, type Locator, type Page } from "@playwright/test";
import { installBase44Mocks } from "./utils/base44Mock";

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

async function swipeTaskCard(page: Page, card: Locator) {
  const box = await card.boundingBox();
  if (!box) throw new Error("Task card bounds were unavailable");

  await page.mouse.move(box.x + box.width * 0.82, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.08, box.y + box.height / 2, { steps: 18 });
  await page.mouse.up();
}

test("delete this reminder only skips to the next recurring instance", async ({ page }) => {
  const api = await installBase44Mocks(page, {
    tasks: [recurringTask()],
    priorities: [defaultPriority],
  });

  await page.goto("/Today");
  const card = taskCardByTitle(page, "Series task");
  await expect(card).toBeVisible();

  await swipeTaskCard(page, card);
  await expect(page.getByText("Delete recurring reminder?")).toBeVisible();
  await page.getByTestId("recurring-delete-this").click();

  await expect(card).toHaveCount(0);
  const state = await api.getState();
  expect(state.tasks).toHaveLength(1);
  expect(state.tasks[0].due_date).toBe(formatDateOffset(1));

  await page.goto("/Active");
  await expect(taskCardByTitle(page, "Series task")).toBeVisible();
});

test("delete all future reminders removes the series and undo restores it across reload", async ({ page }) => {
  await installBase44Mocks(page, {
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

test("completing a recurring task advances it and records the completed snapshot", async ({ page }) => {
  const api = await installBase44Mocks(page, {
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
  expect(state.deletedTasks).toHaveLength(1);
  expect(state.deletedTasks[0].title).toBe("Series task");
  expect(state.tasks.find((task) => task.id === "series-1")?.due_date).toBe(formatDateOffset(1));

  await page.goto("/RecentlyDeleted");
  await expect(page.getByText("Series task")).toBeVisible();

  await page.goto("/Active");
  await expect(taskCardByTitle(page, "Series task")).toBeVisible();
});

test("offline task creation is replayed and survives a reload when connectivity returns", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const api = await installBase44Mocks(page, {
    tasks: [],
    priorities: [defaultPriority],
  });

  await page.goto("/Today");
  await expect(page.getByText("Nothing due today")).toBeVisible();

  await context.setOffline(true);

  await page.getByRole("button", { name: /new task/i }).click();
  await page.getByTestId("task-form-title").fill("Offline task");
  await page.getByTestId("task-form-submit").click();

  await expect(taskCardByTitle(page, "Offline task")).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("taskflow_pending_mutations") || "[]").length))
    .toBe(1);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect
    .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("taskflow_pending_mutations") || "[]").length))
    .toBe(0);

  const counters = await api.getCounters();
  expect(counters.taskCreates).toBe(1);

  await page.reload();
  await expect(taskCardByTitle(page, "Offline task")).toBeVisible();

  await context.close();
});
