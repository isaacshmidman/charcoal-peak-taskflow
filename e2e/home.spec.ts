import { expect, test, type Page } from "@playwright/test";
import { installMockBackend } from "./utils/mockBackend";

/**
 * Home: a page of blocks the person arranges. What each block shows is
 * tested as plain functions (src/lib/home-blocks.test.js); this checks
 * the page itself: that the blocks are fed real data and act on it, and
 * that arranging the page works and is kept.
 */

const priorities = [
  { id: "p-high", name: "High", order: 0, color: "red" },
  { id: "p-low", name: "Low", order: 1, color: "slate" },
];

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
  priority_id: "p-low",
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
  task("a", "Back up the laptop", { task_time: "10:30AM", tags: ["work"] }),
  task("b", "Water the plants", { tags: ["home"] }),
  task("c", "Send the invoice", { due_date: day(-2), tags: ["work"] }),
  task("d", "Review the contract", { due_date: day(3), tags: ["work"] }),
  task("e", "Sort the garage", { due_date: "", tags: ["home"] }),
  task("f", "File the expenses", { status: "done", completed_at: new Date().toISOString() }),
  {
    ...task("ev", "Team check-in", { task_time: "9:00AM", task_end_time: "9:30AM" }),
    source_kind: "event",
    source_provider: "google",
    source_calendar_id: "work",
    source_calendar_name: "Work",
    source_color_hex: "#4f7fc4",
  },
];

const notes = [
  { id: "n1", title: "Groceries", content_json: "", content_text: "Milk", tags: [], pinned: true, updated_date: new Date().toISOString() },
  { id: "n2", title: "Trip ideas", content_json: "", content_text: "Lisbon", tags: [], pinned: false, updated_date: new Date().toISOString() },
];

const block = (page: Page, id: string) => page.getByTestId(`home-block-${id}`);
const order = (page: Page) =>
  page.locator('[data-testid^="home-block-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")!.replace("home-block-", "")));
const START = ["today", "schedule", "overdue", "done", "notes", "week", "tags", "deadlines", "month"];
/** A block's settings panel, opened from its settings button while customizing. */
const openSettings = async (page: Page, name: string) => {
  await page.getByRole("button", { name: `Settings for ${name}` }).click();
};

test("Home is where the app opens, and each block shows and acts on real data", async ({ page }) => {
  const mock = await installMockBackend(page, { tasks, priorities, notes });
  await page.goto("/");
  await expect(page).toHaveURL(/\/Home$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Home");
  await expect(page.getByTestId("sidebar").getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  await expect.poll(() => order(page)).toEqual(START);

  // Today and Overdue between them are the Today page's list: the
  // sidebar's number is their sum.
  await expect(page.getByTestId("home-count-today")).toHaveText("2");
  await expect(page.getByTestId("home-count-overdue")).toHaveText("1");
  await expect(page.getByTestId("sidebar").getByTestId("nav-count-Today")).toHaveText("3");
  await expect(block(page, "today").getByText("Back up the laptop")).toBeVisible();
  await expect(block(page, "today").getByText("10:30 AM")).toBeVisible();
  await expect(block(page, "overdue").getByText("Send the invoice")).toBeVisible();
  await expect(block(page, "deadlines").getByText("Review the contract")).toBeVisible();

  // Schedule: the calendar's event and the timed task, not the untimed one.
  await expect(block(page, "schedule").getByText("Team check-in")).toBeVisible();
  await expect(block(page, "schedule").getByText("Work · until 9:30 AM")).toBeVisible();
  await expect(block(page, "schedule").getByText("Back up the laptop")).toBeVisible();
  await expect(block(page, "schedule").getByText("Water the plants")).toHaveCount(0);
  // The event is not a task anywhere else on the page.
  await expect(block(page, "today").getByText("Team check-in")).toHaveCount(0);

  // The week's bars and the month's dots count the same open tasks.
  await expect(page.getByTestId(`home-day-${day(0)}`)).toHaveAttribute("aria-label", /: 2 tasks$/);
  await expect(page.getByTestId(`home-day-${day(3)}`)).toHaveAttribute("aria-label", /: 1 task$/);
  await expect(page.getByTestId(`home-month-${day(0)}`)).toHaveAttribute("data-due", "2");

  // By tag: busiest first.
  await expect(block(page, "tags").getByRole("listitem")).toHaveText([/work\s*3/, /home\s*2/]);

  // Tick a task: it leaves Today and is counted as done.
  await expect(page.getByTestId("home-done-number")).toHaveText("1");
  await block(page, "today").getByRole("checkbox", { name: "Mark Water the plants done" }).click();
  await expect(block(page, "today").getByText("Water the plants")).toHaveCount(0);
  await expect(page.getByTestId("home-count-today")).toHaveText("1");
  await expect(page.getByTestId("home-done-number")).toHaveText("2");
  await expect(block(page, "tags").getByRole("listitem")).toHaveText([/work\s*3/, /home\s*1/]);

  // A task's name opens the task.
  await block(page, "overdue").getByRole("button", { name: "Send the invoice", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTestId("task-form-title")).toHaveValue("Send the invoice");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Done this week lists what was finished; unticking one there puts it back.
  await expect(page.getByTestId("home-done-recent")).toContainText("Water the plants");
  await block(page, "done").getByRole("checkbox", { name: "Mark Water the plants not done" }).click();
  await expect(block(page, "today").getByText("Water the plants")).toBeVisible();
  await expect(page.getByTestId("home-done-number")).toHaveText("1");

  // An event on the schedule opens, like a task does.
  await block(page, "schedule").getByRole("button", { name: /Team check-in/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // A bar of the week opens its day: what is on it, usable there, and a task can be added on it.
  await page.getByTestId(`home-day-${day(3)}`).getByRole("button").click();
  const peek = page.getByTestId(`home-peek-${day(3)}`);
  await expect(peek.getByText("Review the contract")).toBeVisible();
  await expect(peek.getByRole("link", { name: "Open in Calendar" })).toHaveAttribute("href", `/Calendar?date=${day(3)}&view=day`);
  await peek.getByRole("button", { name: "New task" }).click();
  await expect(peek).toHaveCount(0);
  await page.getByTestId("task-form-title").fill("Call Marta");
  await page.getByTestId("task-form-submit").click();
  await expect.poll(async () => (await mock.getState()).tasks.find((t) => t.title === "Call Marta")?.due_date).toBe(day(3));
  await expect(page.getByTestId(`home-day-${day(3)}`)).toHaveAttribute("aria-label", /: 2 tasks$/);

  // The month: a day's mark says what it is, the day opens, and the month turns.
  const todayCell = page.getByTestId(`home-month-${day(0)}`);
  await expect(todayCell).toHaveAttribute("data-event", "true");
  await expect(todayCell).toHaveAttribute("aria-label", /today, 2 tasks due, has events$/);
  await expect(page.getByTestId("home-month-legend")).toContainText("Tasks due");
  await todayCell.click();
  await expect(page.getByTestId(`home-peek-${day(0)}`).getByText("Team check-in")).toBeVisible();
  await expect(page.getByTestId(`home-peek-${day(0)}`).getByText("Back up the laptop")).toBeVisible();
  await page.keyboard.press("Escape");
  const thisMonth = await page.getByTestId("home-month-label").textContent();
  await block(page, "month").getByRole("button", { name: "Next month" }).click();
  await expect(page.getByTestId("home-month-label")).not.toHaveText(thisMonth!);
  await expect(todayCell).toHaveCount(0);
  await block(page, "month").getByRole("button", { name: "This month" }).click();
  await expect(page.getByTestId("home-month-label")).toHaveText(thisMonth!);
  await expect(todayCell).toBeVisible();

  // A tag's bar leads to its tasks; a pinned note opens in Notes.
  await block(page, "tags").getByRole("link", { name: /^work:/ }).click();
  await expect(page).toHaveURL(/\/Active\?tag=work$/);
  await page.goBack();
  await expect(block(page, "notes").getByRole("listitem")).toHaveText([/Groceries/]);
  await block(page, "notes").getByRole("link", { name: /Groceries/ }).click();
  await expect(page).toHaveURL(/\/Notes$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Notes");
});

test("Home: Customize moves, widens, removes and adds blocks, and the page stays as set", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const mock = await installMockBackend(page, { tasks, priorities, notes });
  await page.goto("/Home");
  await expect(block(page, "today")).toBeVisible();
  expect((await mock.getState()).homeLayout).toBeNull();

  const width = async (id: string) => Math.round((await block(page, id).boundingBox())!.width);
  const half = await width("today");

  await page.getByRole("button", { name: "Customize", exact: true }).click();
  // The one block not on the starting page is the one that needs a tag chosen.
  await expect(page.getByTestId("home-tray").getByRole("button")).toHaveText([/One tag/]);
  // Nothing to put back yet.
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toHaveCount(0);
  // While arranging, a block's content can't be used.
  await expect(block(page, "today").getByRole("checkbox")).toHaveCount(0);
  // A block carries three controls: its grip, its settings, and remove.
  await expect(block(page, "today").getByRole("button")).toHaveCount(3);

  // Everything else about a block is in its settings panel.
  await openSettings(page, "Today");
  await expect(page.getByRole("button", { name: "Move Today earlier" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await openSettings(page, "Month");
  await expect(page.getByRole("button", { name: "Move Month later" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await openSettings(page, "Schedule");
  await page.getByRole("button", { name: "Move Schedule earlier" }).click();
  // The page redraws a moment after the press: wait for it, don't read at once.
  await expect.poll(async () => (await order(page)).slice(0, 2)).toEqual(["schedule", "today"]);
  await page.keyboard.press("Escape");

  // With the keyboard on a grip, the arrow keys move the block. (The panel
  // hands the keyboard back to its button as it closes: wait for that.)
  await expect(page.getByTestId("home-settings-schedule")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Settings for Schedule" })).toBeFocused();
  await page.getByRole("button", { name: "Drag Overdue to another place" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await order(page)).slice(2, 4)).toEqual(["done", "overdue"]);
  await expect(page.getByRole("button", { name: "Drag Overdue to another place" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await order(page)).slice(2, 4)).toEqual(["overdue", "done"]);

  await openSettings(page, "Today");
  await page.getByRole("group", { name: "Width of Today" }).getByRole("button", { name: "Wide" }).click();
  await expect(block(page, "today")).toHaveAttribute("data-size", "full");
  await expect.poll(() => width("today")).toBeGreaterThan(half * 1.9);
  await page.getByRole("group", { name: "Width of Today" }).getByRole("button", { name: "Narrow" }).click();
  await expect.poll(() => width("today")).toBeLessThan(half * 0.75);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Remove By tag" }).click();
  await expect(block(page, "tags")).toHaveCount(0);
  await page.getByRole("button", { name: "Remove Month" }).click();
  await expect(page.getByTestId("home-tray").getByRole("button")).toHaveText([/By tag/, /Month/, /One tag/]);
  await page.getByRole("button", { name: "Add By tag" }).click();
  // A block from the tray goes first, right under the tray it came from.
  const arranged = ["tags", "schedule", "today", "overdue", "done", "notes", "week", "deadlines"];
  await expect.poll(() => order(page)).toEqual(arranged);

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByTestId("home-tray")).toHaveCount(0);
  await expect(block(page, "today").getByRole("checkbox").first()).toBeVisible();

  // Kept on the account, so it is still there after a reload.
  await expect.poll(async () => ((await mock.getState()).homeLayout || []).map((b) => b.id)).toEqual(arranged);
  expect((await mock.getState()).homeLayout!.find((b) => b.id === "today")).toEqual({ id: "today", size: "third" });
  await page.reload();
  await expect(block(page, "schedule")).toBeVisible();
  await expect.poll(() => order(page)).toEqual(arranged);
  await expect(block(page, "today")).toHaveAttribute("data-size", "third");

  // Reset puts the starting page back.
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect.poll(() => order(page)).toEqual(START);
  await expect.poll(async () => (await mock.getState()).homeLayout).toBeNull();
  // It was someone's own arrangement: there is a way back.
  await expect(page.getByTestId("delete-toast")).toContainText("starting layout");
  await page.getByTestId("delete-toast-undo").click();
  await expect.poll(() => order(page)).toEqual(arranged);
  await expect.poll(async () => ((await mock.getState()).homeLayout || []).map((b) => b.id)).toEqual(arranged);
});

test("Home on a phone: one column, and + opens the task form here", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockBackend(page, { tasks, priorities, notes });
  await page.goto("/Home");
  await expect(block(page, "today")).toBeVisible();

  const tabs = page.getByTestId("phone-tabs");
  await expect(tabs.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");

  // Every block is the page's width, and nothing scrolls sideways.
  const today = (await block(page, "today").boundingBox())!;
  const schedule = (await block(page, "schedule").boundingBox())!;
  expect(Math.round(today.width)).toBe(390 - 32);
  expect(schedule.y).toBeGreaterThan(today.y + today.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  await tabs.getByRole("button", { name: "New Task" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/Home$/);
  await page.keyboard.press("Escape");

  // Width is a laptop's business: on a phone only order and removal are offered.
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await openSettings(page, "Today");
  await expect(page.getByRole("button", { name: "Move Today later" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Width of Today" })).toBeHidden();
});

test("Home: drag a block to a new place, set a block's own rows and days, and give a tag its own block", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const many = [
    ...tasks,
    task("g1", "Call the bank", { tags: ["work"] }),
    task("g2", "Renew the passport", { tags: ["work"] }),
    task("g3", "Book the dentist", { tags: ["home"] }),
    task("far", "Plan the trip", { due_date: day(10), tags: ["home"] }),
  ];
  const mock = await installMockBackend(page, { tasks: many, priorities, notes });
  await page.goto("/Home");
  await expect(block(page, "today")).toBeVisible();
  // Five are due today; all fit in the block's eight rows.
  await expect(block(page, "today").getByRole("checkbox")).toHaveCount(5);
  await expect(block(page, "deadlines").getByText("Plan the trip")).toBeVisible();

  await page.getByRole("button", { name: "Customize", exact: true }).click();

  // Drag Schedule by its grip and let go over Today: it takes that place.
  const grip = (await page.getByRole("button", { name: "Drag Schedule to another place" }).boundingBox())!;
  const target = (await block(page, "today").boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x - 40, grip.y - 20, { steps: 4 });
  await page.mouse.move(target.x + 200, target.y + target.height / 2, { steps: 8 });
  await expect(block(page, "today")).toHaveAttribute("data-drop-target", "true");
  await page.mouse.up();
  await expect.poll(async () => (await order(page)).slice(0, 2)).toEqual(["schedule", "today"]);

  // A block's own settings, in its panel. Opening the panel doesn't change the block's size.
  const before = (await block(page, "today").boundingBox())!.height;
  await openSettings(page, "Today");
  expect((await block(page, "today").boundingBox())!.height).toBe(before);
  await page.getByRole("group", { name: "Rows in Today" }).getByRole("button", { name: "3", exact: true }).click();
  await page.keyboard.press("Escape");
  await openSettings(page, "Deadlines");
  await page.getByRole("group", { name: "Days ahead in Deadlines" }).getByRole("button", { name: "7", exact: true }).click();
  await expect(page.getByTestId("home-count-deadlines")).toHaveText("next 7 days");
  await page.keyboard.press("Escape");
  // A block with nothing of its own to set still has its width and its place.
  await openSettings(page, "Month");
  await expect(page.getByTestId("home-settings-month").getByRole("group")).toHaveCount(1);
  await page.keyboard.press("Escape");

  // "One tag" arrives pointed at the busiest tag, and can be pointed elsewhere.
  await page.getByRole("button", { name: "Add One tag" }).click();
  await expect(page.getByRole("region", { name: "#work" })).toBeVisible();
  await expect(page.getByTestId("home-count-tag")).toHaveText("5");
  await openSettings(page, "#work");
  await page.getByRole("combobox", { name: "Which tag this block shows" }).click();
  await page.getByRole("option", { name: "home", exact: true }).click();
  await expect(page.getByRole("region", { name: "#home" })).toBeVisible();
  await expect(page.getByTestId("home-count-tag")).toHaveText("4");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Done", exact: true }).click();

  // Three rows and a link to the rest; ten days out is past the week Deadlines now looks.
  await expect(block(page, "today").getByRole("checkbox")).toHaveCount(3);
  await expect(block(page, "today").getByRole("link", { name: "and 2 more" })).toHaveAttribute("href", "/Today");
  await expect(block(page, "deadlines").getByText("Plan the trip")).toHaveCount(0);
  await expect(block(page, "deadlines").getByText("Review the contract")).toBeVisible();
  // The tag's block lists its tasks, dated ones first, and its heading leads to the tag.
  await expect(block(page, "tag").getByText("Water the plants")).toBeVisible();
  await expect(block(page, "tag").getByText("Sort the garage")).toBeVisible();
  await expect(block(page, "tag").getByRole("link", { name: "#home" })).toHaveAttribute("href", "/Active?tag=home");

  // All of it is kept on the account.
  await expect
    .poll(async () => {
      const saved = (await mock.getState()).homeLayout || [];
      return {
        first: saved[0]?.id,
        today: saved.find((b) => b.id === "today")?.options,
        deadlines: saved.find((b) => b.id === "deadlines")?.options,
        tag: saved.find((b) => b.id === "tag")?.options,
      };
    })
    .toEqual({ first: "tag", today: { rows: 3 }, deadlines: { days: 7 }, tag: { tag: "home" } });
  await page.reload();
  await expect(block(page, "today").getByRole("checkbox")).toHaveCount(3);
  await expect(page.getByTestId("home-count-deadlines")).toHaveText("next 7 days");
  await expect(page.getByRole("region", { name: "#home" })).toBeVisible();
});
