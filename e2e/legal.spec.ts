import { expect, test } from "@playwright/test";
import { installMockBackend } from "./utils/mockBackend";

/**
 * The Terms and Privacy pages. Stripe's Checkout links to the Terms and its
 * receipts to the Privacy Policy, so both must open for someone who isn't
 * signed in, without being sent to the login screen.
 */

test("signed out, the Terms and Privacy pages open, with the contact address", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [], currentUser: null });

  await page.goto("/terms");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms of Service");
  await expect(page.getByText("isn't refundable", { exact: false })).toBeVisible();
  await expect(page.getByTestId("legal-contact")).toHaveAttribute("href", "mailto:help@zephyrly.test");
  await expect(page).toHaveURL(/\/terms$/);

  await page.getByRole("link", { name: "Privacy Policy" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy Policy");
  await expect(page.getByText("wait in Recently Deleted for 7 days")).toBeVisible();
  await expect(page).toHaveURL(/\/privacy$/);
});

test("the sign-in screen links to both", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [], currentUser: null });
  await page.goto("/login");
  await page.getByRole("link", { name: "Terms" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms of Service");
  await page.goBack();
  await page.getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy Policy");
});
