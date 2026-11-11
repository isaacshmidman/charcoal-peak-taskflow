import { expect, test } from "@playwright/test";
import { installMockBackend } from "./utils/mockBackend";

const today = () => {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const priority = { id: "priority-default", name: "Normal", color: "blue", order: 0 };
const manyTasks = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `t${String(i).padStart(3, "0")}`,
    title: `Task ${String(i).padStart(3, "0")}`,
    description: "",
    priority_id: priority.id,
    status: "todo",
    task_type: "one_time",
    recurrence: "none",
    due_date: today(),
    task_time: "",
    tags: [],
    // Newest first is the list's default order: t000 on top, t219 last.
    created_date: new Date(Date.now() - i * 60_000).toISOString(),
  }));

test("a long list is drawn a part at a time, and the rest arrives as you scroll", async ({ page }) => {
  await installMockBackend(page, { priorities: [priority], tasks: manyTasks(220) });
  await page.goto("/Today");
  const cards = page.locator('[data-testid^="task-card-"]');
  await expect(cards.first()).toBeVisible();

  // Not all 220 at once — that is what made a long page slow to open.
  const drawnAtFirst = await cards.count();
  expect(drawnAtFirst).toBeGreaterThanOrEqual(60);
  expect(drawnAtFirst).toBeLessThan(220);

  // Scrolling is all it takes: no button, and nothing left out.
  await expect(async () => {
    await page.mouse.wheel(0, 20_000);
    expect(await cards.count()).toBe(220);
  }).toPass({ timeout: 15_000 });
  await expect(page.getByTestId("list-more")).toHaveCount(0);

  // The last one works like any other.
  const last = page.getByTestId("task-card-t219");
  await last.scrollIntoViewIfNeeded();
  await page.getByTestId("task-toggle-t219").click();
  await expect(last).toHaveCount(0);
  await expect(cards).toHaveCount(219);
});

test("searching finds a task that hasn't been drawn yet", async ({ page }) => {
  await installMockBackend(page, { priorities: [priority], tasks: manyTasks(220) });
  await page.goto("/Active");
  await expect(page.locator('[data-testid^="task-card-"]').first()).toBeVisible();
  await expect(page.getByTestId("task-card-t219")).toHaveCount(0);

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.keyboard.type("Task 219");
  await expect(page.getByTestId("task-card-t219")).toBeVisible();
  await expect(page.locator('[data-testid^="task-card-"]')).toHaveCount(1);
});

test("a board column grows inside itself as it is scrolled", async ({ page }) => {
  await installMockBackend(page, { priorities: [priority], tasks: manyTasks(150) });
  await page.goto("/Groupings");
  const column = page.getByTestId("group-tod");
  const cards = column.locator('[data-testid^="compact-task-"]');
  await expect(cards.first()).toBeVisible();
  // The count in the heading is of the whole column, not of what is drawn.
  await expect(column).toHaveAttribute("aria-label", /150 tasks/);
  expect(await cards.count()).toBeLessThan(150);

  await expect(async () => {
    await cards.last().scrollIntoViewIfNeeded();
    expect(await cards.count()).toBe(150);
  }).toPass({ timeout: 15_000 });
});
