import { expect, test } from "@playwright/test";
import { installMockBackend } from "./utils/mockBackend";

/**
 * Restore from an export, through the Settings page. The server side
 * (what gets added, owners, ids, files) is covered in backend tests; here
 * the browser really uploads the chosen file and shows the result.
 */

const defaultPriority = { id: "priority-1", name: "Medium", order: 1, color: "slate" };
const today = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

test("choosing an export uploads it and shows what came back", async ({ page }) => {
  await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });

  let uploaded = "";
  await page.route("**/restore", async (route) => {
    uploaded = route.request().postDataBuffer()?.toString("latin1") || "";
    // What the server would have added, so the app has something to refetch.
    await page.evaluate((date) => {
      const backend = (window as any).__TASKFLOW_E2E_BACKEND__;
      backend.state.tasks.push({
        id: "restored-1", title: "Back from the export", description: "", priority_id: "priority-1", status: "todo",
        task_type: "one_time", recurrence: "none", recurrence_days: [], recurrence_end_date: "", due_date: date,
        task_time: "", tags: [], completed_at: "",
      });
      window.localStorage.setItem("__taskflow_e2e_backend__", JSON.stringify(backend));
    }, today());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        added: { tasks: 1, notes: 0, priorities: 0, tags: 0, recentlyDeleted: 0, files: 0 },
        notes: ["Notification settings and calendar connections aren't part of a restore — yours are unchanged."],
      }),
    });
  });

  await page.goto("/Settings");
  await page.getByText("Export & restore").click();
  await page.getByTestId("restore-file-input").setInputFiles({
    name: "zephyrly-export-2026-09-28.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("PK\u0003\u0004 pretend archive"),
  });

  await expect(page.getByTestId("restore-summary")).toContainText("Added 1 task.");
  await expect(page.getByTestId("restore-summary")).toContainText("aren't part of a restore");
  expect(uploaded).toContain('filename="zephyrly-export-2026-09-28.zip"');
  expect(uploaded).toContain("pretend archive");

  await page.goto("/Today");
  await expect(page.locator('[data-testid^="task-card-"][data-task-title="Back from the export"]')).toBeVisible();
});

test("a refused file says why and changes nothing", async ({ page }) => {
  const api = await installMockBackend(page, { tasks: [], priorities: [defaultPriority] });
  await page.route("**/restore", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ message: "That file isn't a Zephyrly export.", code: "restore_not_export" }),
    })
  );
  await page.goto("/Settings");
  await page.getByText("Export & restore").click();
  await page.getByTestId("restore-file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByTestId("restore-error")).toHaveText("That file isn't a Zephyrly export.");
  expect((await api.getState()).tasks).toHaveLength(0);
});
