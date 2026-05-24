import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import { createViteConfig } from "./vite.shared.js";

export default mergeConfig(
  createViteConfig(),
  defineConfig({
    test: {
      // happy-dom replaces jsdom: vitest 4.x + jsdom 29 hits a hard
      // 60s worker-startup timeout on macOS that kept `npm run verify`
      // red. happy-dom is a near drop-in for testing-library use cases —
      // setup.js's window.matchMedia stub + @testing-library/jest-dom
      // both work identically against it. Switching also makes the
      // whole test run ~30x faster (was 19 min, now ~30s).
      environment: "happy-dom",
      globals: true,
      setupFiles: ["./src/test/setup.js"],
      css: false,
      // `forks` pool also dodges the vitest-4 thread-worker hang.
      pool: "forks",
      maxWorkers: 2,
      include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}", "backend/**/*.{test,spec}.js"],
      exclude: ["e2e/**", "playwright.config.ts"],
      coverage: {
        provider: "v8",
        reporter: ["text", "html"],
      },
    },
  })
);
