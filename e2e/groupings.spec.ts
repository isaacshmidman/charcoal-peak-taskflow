import { expect, test } from "@playwright/test";
import { installMockBackend } from "./utils/mockBackend";

const day = (offsetDays = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const priority = { id: "priority-default", name: "Normal", color: "blue", order: 0 };

const task = (id: string, title: string, offset: number, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  description: "",
  priority_id: priority.id,
  status: "todo",
  task_type: "one_time",
  recurrence: "none",
  due_date: day(offset),
  task_time: "",
  tags: [],
  created_date: new Date().toISOString(),
  ...extra,
});

test("Groupings shows one board at a time and remembers which", async ({ page }) => {
  await installMockBackend(page, {
    priorities: [priority],
    tasks: [task("a", "Pay rent", 0, { tags: ["home"] }), task("b", "Book flights", 1, { tags: ["travel"] })],
  });
  await page.goto("/Groupings");

  // By date: the four columns that look ahead, and no overdue ones —
  // nothing is overdue, so there is nothing to show for them.
  await expect(page.getByTestId("group-tod")).toContainText("Pay rent");
  await expect(page.getByTestId("group-tom")).toContainText("Book flights");
  await expect(page.getByTestId("group-next7")).toBeVisible();
  await expect(page.getByTestId("group-future")).toBeVisible();
  await expect(page.getByTestId("group-past")).toHaveCount(0);
  await expect(page.getByTestId("group-yest")).toHaveCount(0);
  await expect(page.getByTestId("group-noDue")).toHaveCount(0);

  await page.getByRole("button", { name: "By tag" }).click();
  await expect(page.getByTestId("group-tag-home")).toContainText("Pay rent");
  await expect(page.getByTestId("group-tag-travel")).toContainText("Book flights");
  await expect(page.getByTestId("group-tod")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: "By tag" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("group-tag-home")).toBeVisible();
});

test("an overdue task gets its own column, and its date button moves it to today", async ({ page }) => {
  const api = await installMockBackend(page, {
    priorities: [priority],
    tasks: [task("late", "Return library books", -4)],
  });
  await page.goto("/Groupings");

  const past = page.getByTestId("group-past");
  await expect(past).toContainText("Return library books");

  await page.getByRole("button", { name: /Change the date of Return library books/ }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();

  await expect(page.getByTestId("group-tod")).toContainText("Return library books");
  // Nothing is overdue any more, so the column is gone.
  await expect(past).toHaveCount(0);
  await expect.poll(async () => (await api.getState()).tasks.find((t) => t.id === "late")?.due_date).toBe(day(0));
});

test("a new task made on Groupings starts on today, so it can be saved straight away", async ({ page }) => {
  const api = await installMockBackend(page, { priorities: [priority], tasks: [] });
  await page.goto("/Groupings");
  await page.getByRole("button", { name: "New Task" }).click();
  await page.getByTestId("task-form-title").fill("Water the plants");
  // It used to open with no date, leaving Create disabled until one was picked.
  await expect(page.getByTestId("task-form-submit")).toBeEnabled();
  await page.getByTestId("task-form-submit").click();
  await expect(page.getByTestId("group-tod")).toContainText("Water the plants");
  await expect.poll(async () => (await api.getState()).tasks[0]?.due_date).toBe(day(0));
});

test("the tag board says so when nothing is tagged", async ({ page }) => {
  await installMockBackend(page, { priorities: [priority], tasks: [task("a", "Pay rent", 0)] });
  await page.goto("/Groupings");
  await page.getByRole("button", { name: "By tag" }).click();
  await expect(page.getByTestId("groupings-no-tags")).toContainText("No tagged tasks yet");
});
