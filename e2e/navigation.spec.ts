import { expect, test, type Page } from "@playwright/test";
import { installMockBackend } from "./utils/mockBackend";

/**
 * Getting around: the sidebar on a wide screen, the tab bar on a phone,
 * and the one place, Tasks, that is a list, a board and the finished
 * ones.
 */

const priority = { id: "priority-1", name: "Medium", order: 1, color: "slate" };

/** A day as the app writes it, counted from today on this machine's clock. */
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const task = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  description: "",
  priority_id: priority.id,
  status: "todo",
  task_type: "one_time",
  recurrence: "none",
  due_date: day(0),
  task_time: "",
  tags: [],
  completed_at: "",
  ...extra,
});

const tasks = [
  task("a", "Send the invoice", { tags: ["work"] }),
  task("b", "Water the plants", { tags: ["home"] }),
  task("c", "Review the contract", { tags: ["work"], due_date: day(1) }),
  task("d", "File the expenses", { tags: ["work"], status: "done", completed_at: new Date().toISOString(), due_date: day(-1) }),
  task("e", "Sort the garage", { tags: ["home"], due_date: "" }),
];

const card = (page: Page, title: string) => page.locator(`[data-testid^="task-card-"][data-task-title="${title}"]`);

test("sidebar: a count is the rows behind it, and a tag narrows every view of Tasks", async ({ page }) => {
  await installMockBackend(page, { tasks, priorities: [priority], savedTags: [{ id: "s1", name: "someday" }] });
  await page.goto("/Today");

  const sidebar = page.getByTestId("sidebar");
  await expect(card(page, "Send the invoice")).toBeVisible();

  // Two tasks are due today; four are open altogether.
  await expect(sidebar.getByTestId("nav-count-Today")).toHaveText("2");
  await expect(sidebar.getByTestId("nav-count-Active")).toHaveText("4");
  await expect(page.locator('[data-testid^="task-card-"]')).toHaveCount(2);
  await expect(sidebar.getByRole("link", { name: "Today", exact: true })).toHaveAttribute("aria-current", "page");

  // A saved tag with nothing on it is still listed; tags come from tasks too.
  await expect(sidebar.getByRole("link", { name: "Tag someday" })).toBeVisible();

  // A tag opens Tasks narrowed to it.
  await sidebar.getByRole("link", { name: "Tag work" }).click();
  await expect(page).toHaveURL(/\/Active\?tag=work$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("work");
  await expect(page.locator('[data-testid^="task-card-"]')).toHaveCount(2);
  await expect(card(page, "Review the contract")).toBeVisible();
  await expect(card(page, "Water the plants")).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "Tag work" })).toHaveAttribute("aria-current", "page");
  await expect(sidebar.getByRole("link", { name: "Tasks", exact: true })).not.toHaveAttribute("aria-current", "page");

  // The tag stays chosen across List, Board and Completed.
  const views = page.getByRole("navigation", { name: "Task views" });
  await views.getByRole("link", { name: "Board" }).click();
  await expect(page).toHaveURL(/\/Groupings\?tag=work$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("work");
  await expect(page.getByText("Review the contract")).toBeVisible();
  await expect(page.getByText("Water the plants")).toHaveCount(0);
  // One tag has one way to be divided: the By date / By tag choice goes.
  await expect(page.getByRole("group", { name: "Columns" })).toHaveCount(0);

  await views.getByRole("link", { name: "Completed" }).click();
  await expect(page).toHaveURL(/\/Completed\?tag=work$/);
  await expect(page.getByText("File the expenses")).toBeVisible();

  // Back to everything: the board and Completed belong to Tasks.
  await page.getByRole("button", { name: "All completed tasks" }).click();
  await expect(page).toHaveURL(/\/Completed$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tasks");
  await expect(sidebar.getByRole("link", { name: "Tasks", exact: true })).toHaveAttribute("aria-current", "page");
  await views.getByRole("link", { name: "Board" }).click();
  await expect(page.getByRole("group", { name: "Columns" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Tasks", exact: true })).toHaveAttribute("aria-current", "page");
});

test("sidebar: folding it to icons is remembered, and the page takes the room", async ({ page }) => {
  await installMockBackend(page, { tasks, priorities: [priority] });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/Today");

  const sidebar = page.getByTestId("sidebar");
  const width = async () => Math.round((await sidebar.boundingBox())!.width);
  const pageLeft = async () => Math.round((await page.getByRole("heading", { level: 1 }).boundingBox())!.x);
  await expect(card(page, "Send the invoice")).toBeVisible();
  expect(await width()).toBe(240);
  const leftBefore = await pageLeft();

  await page.getByRole("button", { name: "Fold the sidebar", exact: true }).click();
  await expect.poll(width).toBe(64);
  expect(await pageLeft()).toBeLessThan(leftBefore);
  // Icons only, but every link keeps its name.
  await expect(sidebar.getByRole("link", { name: "Calendar", exact: true })).toBeVisible();

  await page.reload();
  await expect(card(page, "Send the invoice")).toBeVisible();
  expect(await width()).toBe(64);

  await page.getByRole("button", { name: "Unfold the sidebar" }).click();
  await expect.poll(width).toBe(240);
});

test("phone: tabs have words, + adds from anywhere, and More holds the rest", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockBackend(page, { tasks, priorities: [priority] });
  await page.goto("/Today");

  const tabs = page.getByTestId("phone-tabs");
  await expect(page.getByTestId("sidebar")).toBeHidden();
  for (const name of ["Home", "Today", "Calendar"]) {
    await expect(tabs.getByRole("link", { name, exact: true })).toHaveText(name);
  }
  await expect(tabs.getByRole("link", { name: "Today", exact: true })).toHaveAttribute("aria-current", "page");

  // + opens the page's own form…
  await tabs.getByRole("button", { name: "New task" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // …and from a page without one, it goes to Today and opens there, once.
  await tabs.getByRole("button", { name: "More" }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/Settings$/);
  await tabs.getByRole("button", { name: "New task" }).click();
  await expect(page).toHaveURL(/\/Today$/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(card(page, "Send the invoice")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // More: the places that didn't fit, tags, Recently deleted, Settings.
  await tabs.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("link", { name: "Tasks", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Notes", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Recently deleted" })).toBeVisible();
  await page.getByRole("link", { name: "Tag home" }).click();
  await expect(page).toHaveURL(/\/Active\?tag=home$/);
  await expect(page.locator('[data-testid^="task-card-"]')).toHaveCount(2);
  // Going somewhere closes More.
  await expect(page.getByRole("link", { name: "Recently deleted" })).toHaveCount(0);
});

test("appearance: Tasks opens in the view chosen for it, everywhere that leads to Tasks", async ({ page }) => {
  await installMockBackend(page, { tasks, priorities: [priority] });
  await page.goto("/Settings");
  await page.getByRole("button", { name: /^Appearance/ }).click();

  const sidebar = page.getByTestId("sidebar");
  const tasksLink = sidebar.getByRole("link", { name: "Tasks", exact: true });
  await expect(tasksLink).toHaveAttribute("href", "/Active");

  const choose = async (setting: string, option: string) => {
    await page.getByRole("combobox", { name: setting }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
    await expect(page.getByRole("combobox", { name: setting })).toHaveText(option);
  };

  // The link follows the setting at once, without a reload.
  await choose("Tasks opens as", "Board");
  await expect(tasksLink).toHaveAttribute("href", "/Groupings");
  await tasksLink.click();
  await expect(page).toHaveURL(/\/Groupings$/);
  await expect(tasksLink).toHaveAttribute("aria-current", "page");

  // So do the keyboard's "go to Tasks" and a tag in the sidebar.
  await sidebar.getByRole("link", { name: "Today", exact: true }).click();
  await expect(card(page, "Send the invoice")).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await expect(page).toHaveURL(/\/Groupings$/);
  await sidebar.getByRole("link", { name: "Today", exact: true }).click();
  await sidebar.getByRole("link", { name: "Tag work" }).click();
  await expect(page).toHaveURL(/\/Groupings\?tag=work$/);

  // It is remembered, and with Tasks as the start page the app opens there.
  await page.goto("/Settings");
  await page.getByRole("button", { name: /^Appearance/ }).click();
  await expect(page.getByRole("combobox", { name: "Tasks opens as" })).toHaveText("Board");
  await choose("Start page", "Tasks");
  await choose("Calendar opens as", "Week");
  expect(await page.evaluate(() => window.localStorage.getItem("defaultCalendarView"))).toBe("week");
  await page.goto("/");
  await expect(page).toHaveURL(/\/Groupings$/);

  // The theme is three pictures; choosing one changes the app there and then.
  await page.goto("/Settings");
  await page.getByRole("button", { name: /^Appearance/ }).click();
  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(page.getByRole("button", { name: "Dark theme" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Light theme" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  // The first three places are marked as the phone's tabs, and moving one keeps the mark on the first three.
  const order = page.getByTestId("nav-order");
  await expect(order.getByText("Phone tab")).toHaveCount(3);
  await order.getByRole("button", { name: "Move Tasks up" }).click();
  await expect(order.locator("> div").nth(2)).toContainText("Tasks");
  await expect(order.locator("> div").nth(2)).toContainText("Phone tab");
});

test("appearance: an old start page of the board still opens the board", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("defaultNav", "/Groupings"));
  await installMockBackend(page, { tasks, priorities: [priority] });
  await page.goto("/");
  await expect(page).toHaveURL(/\/Groupings$/);
  await expect(page.getByTestId("sidebar").getByRole("link", { name: "Tasks", exact: true })).toHaveAttribute("href", "/Groupings");
});
