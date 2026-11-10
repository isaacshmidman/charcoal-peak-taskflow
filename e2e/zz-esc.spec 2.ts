import { test } from "@playwright/test";
import { installMockBackend } from "./utils/mockBackend";
test("esc", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [{ id: "p", name: "Normal", order: 0, color: "blue" }] });
  await page.goto("/Today");
  await page.getByRole("button", { name: "New Task" }).click();
  const form = page.getByTestId("task-form-dialog");
  await form.locator(".tiptap-prose").click();
  await page.keyboard.type("Their site");
  await page.getByTestId("richtext-style").click();
  await page.waitForTimeout(300);
  const state = () => page.evaluate(() => ({
    menu: document.querySelector('[data-testid="richtext-style-h1"]')?.closest("[data-state]")?.getAttribute("data-state") ?? null,
    form: !!document.querySelector('[data-testid="task-form-dialog"]'),
    active: document.activeElement?.className?.toString().slice(0, 40),
    expanded: document.querySelector('[data-testid="richtext-style"]')?.getAttribute("aria-expanded"),
  }));
  console.log("BEFORE", JSON.stringify(await state()));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  console.log("AFTER", JSON.stringify(await state()));
});
