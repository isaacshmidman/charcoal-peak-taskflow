import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import { createViteConfig } from "./vite.shared.js";

export default mergeConfig(
  createViteConfig(),
  defineConfig({
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.js"],
      css: false,
      include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}", "backend/**/*.{test,spec}.js"],
      exclude: ["e2e/**", "playwright.config.ts"],
      coverage: {
        provider: "v8",
        reporter: ["text", "html"],
      },
    },
  })
);
