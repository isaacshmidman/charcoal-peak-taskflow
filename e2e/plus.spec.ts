import { expect, test, type Page } from "@playwright/test";
import { installMockBackend } from "./utils/mockBackend";

/**
 * Zephyrly Plus in the app. The server enforces every limit
 * (backend/plans.js, tested there); these check that the app says so
 * calmly, and that buying goes to Stripe and back.
 */

const defaultPriority = { id: "priority-1", name: "Medium", order: 1, color: "slate" };
const basic = (buyable = true) => ({
  plan: "basic",
  source: null,
  since: null,
  limits: { storage_bytes: 500_000_000, active_schedules: 1, calendar_sync: false, ai_apps: false },
  buy: buyable ? { available: true, price: { amount: 900, currency: "usd", label: "$9" } } : { available: false, price: null },
});
const note = (id: string, title: string, overrides: Record<string, any> = {}) => ({
  id, title, content_json: "", content_text: "", tags: [], pinned: false, priority_id: "",
  created_date: new Date().toISOString(), updated_date: new Date().toISOString(), ...overrides,
});

async function openPlus(page: Page) {
  await page.goto("/Settings");
  await page.getByText("Zephyrly Plus", { exact: true }).click();
}

test("a founding member sees they have Plus, and nothing to buy", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });
  await openPlus(page);
  await expect(page.getByTestId("plus-plan")).toHaveText("You have Zephyrly Plus");
  await expect(page.getByTestId("plus-section")).toContainText("A founding member");
  await expect(page.getByTestId("plus-buy")).toHaveCount(0);
});

test("Basic can buy Plus on Stripe's page, and coming back confirms it", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority], billing: basic() });
  await page.route("https://checkout.stripe.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Stripe Checkout</h1>" }));
  await openPlus(page);
  await expect(page.getByTestId("plus-plan")).toHaveText("You're on Basic");
  await expect(page.getByTestId("plus-section")).toContainText("It isn’t refundable");
  await page.getByTestId("plus-buy").click();
  await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\//);

  // Stripe sends the person back; the server is asked before anything changes.
  await page.goto("/Settings?plus=done&session_id=cs_test_paid_123");
  await expect(page.getByTestId("plus-notice")).toHaveText("Welcome to Zephyrly Plus. Thank you!");
  await expect(page.getByTestId("plus-plan")).toHaveText("You have Zephyrly Plus");
  await expect(page).toHaveURL(/\/Settings#plus$/);
});

test("cancelling at Stripe changes nothing, and says so", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority], billing: basic() });
  await page.goto("/Settings?plus=cancelled");
  await expect(page.getByTestId("plus-notice")).toHaveText("No payment was made.");
  await expect(page.getByTestId("plus-plan")).toHaveText("You're on Basic");
});

test("with buying not set up, Basic is told so instead of shown a button", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority], billing: basic(false) });
  await openPlus(page);
  await expect(page.getByText("Plus can’t be bought here yet.")).toBeVisible();
  await expect(page.getByTestId("plus-buy")).toHaveCount(0);
});

test("Basic meets Plus features calmly: calendars, AI apps, a second schedule", async ({ page }) => {
  const scheduleOn = JSON.stringify({ v: 1, enabled: true, gap: 0, slot: 60, cascade: "shift", now: true, slots: [{ id: "s1", start: 0, end: 1440, text: "" }] });
  await installMockBackend(page, {
    tasks: [],
    priorities: [defaultPriority],
    billing: basic(),
    notes: [note("mon", "Monday", { schedule_json: scheduleOn }), note("tue", "Tuesday")],
  });

  await page.goto("/Settings");
  await page.getByText("Calendars", { exact: true }).click();
  await expect(page.getByTestId("plus-prompt")).toContainText("Google and Apple Calendar sync is part of Zephyrly Plus.");
  await expect(page.getByRole("button", { name: "Connect" })).toHaveCount(0);

  await page.goto("/Settings");
  await page.getByText("Connected apps", { exact: true }).click();
  await expect(page.getByTestId("plus-prompt")).toContainText("Connecting AI apps is part of Zephyrly Plus.");
  await expect(page.getByTestId("ai-token-create")).toHaveCount(0);

  // Monday already shows as a schedule: Tuesday's switch explains instead.
  await page.goto("/Notes");
  await page.getByTestId("note-row-tue").click();
  await page.getByRole("switch", { name: "Schedule builder" }).click();
  await expect(page.getByTestId("schedule-limit")).toContainText("“Monday” is showing as a schedule.");
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("switch", { name: "Schedule builder" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("schedule-builder")).toHaveCount(0);
  await page.getByRole("switch", { name: "Schedule builder" }).click();
  await page.getByRole("button", { name: "See Plus" }).click();
  await expect(page.getByTestId("plus-section")).toBeVisible();
});
