import { expect, test } from "@playwright/test";
import { installMockBackend } from "./utils/mockBackend";

/**
 * Settings → Connected apps. What an AI token can and can't do is covered
 * by the backend tests (backend/ai/*.test.js, server.test.js); here the
 * page itself: making a token, access, disconnecting, and Undo.
 */

const defaultPriority = { id: "priority-1", name: "Medium", order: 1, color: "slate" };

async function openConnectedApps(page) {
  await page.goto("/Settings");
  await page.getByText("Connected apps").click();
  await expect(page.getByRole("heading", { name: "AI apps", exact: true })).toBeVisible();
}

test("making a token shows it once with setup lines, then the connection can be allowed changes and disconnected", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });
  await openConnectedApps(page);
  await expect(page.getByTestId("ai-no-grants")).toHaveText("Nothing connected yet.");

  const create = page.getByTestId("ai-token-create");
  await expect(create).toBeDisabled();
  await page.getByTestId("ai-token-label").fill("Claude Code");
  await create.click();

  const token = page.getByTestId("ai-token-value");
  await expect(token).toHaveText("zeph_pat_e2e1");
  await expect(page.getByText("Copy this token now. It won't be shown again.")).toBeVisible();
  await expect(page.getByTestId("ai-setup-snippet")).toContainText('claude mcp add --transport http zephyrly');
  await expect(page.getByTestId("ai-setup-snippet")).toContainText("Authorization: Bearer zeph_pat_e2e1");
  await page.getByRole("tab", { name: "LM Studio" }).click();
  await expect(page.getByTestId("ai-setup-snippet")).toContainText('"Authorization": "Bearer zeph_pat_e2e1"');

  await page.getByRole("button", { name: "Done" }).click();
  await expect(token).toHaveCount(0);

  // Read-only unless allowed: the box was left unticked.
  const row = page.getByTestId("ai-grant-grant-1");
  await expect(row).toContainText("Claude Code");
  await expect(row).toContainText("Can read ·");
  const allow = page.getByRole("switch", { name: "Allow Claude Code to change tasks" });
  await expect(allow).toHaveAttribute("aria-checked", "false");
  await allow.click();
  await expect(row).toContainText("Can read and change tasks");
  await expect(allow).toHaveAttribute("aria-checked", "true");

  await row.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("It stops working straight away.");
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByTestId("ai-no-grants")).toBeVisible();
});

test("a token made with changes allowed says so", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });
  await openConnectedApps(page);
  await page.getByTestId("ai-token-label").fill("LM Studio");
  await page.getByTestId("ai-token-allow-changes").click();
  await page.getByTestId("ai-token-create").click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("ai-grant-grant-1")).toContainText("Can read and change tasks");
});

test("recent changes can be undone, and a delete points to Recently Deleted", async ({ page }) => {
  const at = new Date().toISOString();
  await installMockBackend(page, {
    tasks: [],
    priorities: [defaultPriority],
    aiActivity: [
      { id: "act-2", app: "Claude Code", tool: "delete_task", summary: "Moved “Old plan” to Recently Deleted.", created_date: at, undo: "recently_deleted" },
      { id: "act-1", app: "Claude Code", tool: "update_task", summary: "Changed “Essay”: date Thu 1 Oct → Fri 2 Oct.", created_date: at, undo: "available" },
    ],
  });
  await openConnectedApps(page);

  const change = page.getByTestId("ai-activity-act-1");
  await expect(change).toContainText("Changed “Essay”: date Thu 1 Oct → Fri 2 Oct.");
  await expect(change).toContainText("Claude Code ·");
  await change.getByRole("button", { name: "Undo" }).click();
  await expect(change).toContainText("Undone");
  await expect(change.getByRole("button", { name: "Undo" })).toHaveCount(0);

  const deletion = page.getByTestId("ai-activity-act-2");
  await expect(deletion.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await deletion.getByRole("link", { name: "In Recently Deleted" }).click();
  await expect(page).toHaveURL(/\/RecentlyDeleted$/);
});
