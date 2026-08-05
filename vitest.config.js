import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import { createViteConfig } from "./vite.shared.js";

export default mergeConfig(
  createViteConfig(),
  defineConfig({
    // The dev/build config gets JSX from @vitejs/plugin-react, which isn't
    // in the shared config the test run inherits — so without this, esbuild
    // falls back to the CLASSIC runtime and any component that doesn't
    // `import React` throws "React is not defined" the moment a test renders
    // it. Matching production's automatic runtime keeps the transform
    // faithful and stops that trap from gating what can be tested.
    esbuild: { jsx: "automatic" },
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
