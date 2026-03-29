import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.js"],
      css: false,
      include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
      exclude: ["e2e/**", "playwright.config.ts"],
      coverage: {
        provider: "v8",
        reporter: ["text", "html"],
      },
    },
  })
);
