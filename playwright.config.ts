import { createHash } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// Each checkout runs its e2e dev server on a port of its own, worked out
// from where it sits on disk. They used to share 4173, and because a
// server already on the port is reused, a run started while another
// worktree's server held it tested that worktree's code without saying so.
// CI has one checkout and keeps 4173; E2E_PORT picks one by hand.
const port =
  Number(process.env.E2E_PORT) ||
  (process.env.CI ? 4173 : 4200 + (createHash("sha1").update(process.cwd()).digest().readUInt16BE(0) % 700));
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: origin,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `./scripts/npmw run dev -- --mode e2e --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${origin}/Today`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
