import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import { createViteConfig } from "./vite.shared.js";

export default mergeConfig(
  createViteConfig(),
  defineConfig({
    test: {
      environment: "happy-dom",
      globals: true,
      // setupFiles intentionally omitted to isolate the hang
      pool: "forks",
      maxWorkers: 2,
      include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}", "backend/**/*.{test,spec}.js"],
      exclude: ["e2e/**", "playwright.config.ts"],
    },
  })
);
