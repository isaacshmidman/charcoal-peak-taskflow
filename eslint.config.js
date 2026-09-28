import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";

const noopRule = {
  create: () => ({}),
};

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "tools/**",
    ],
  },
  {
    // All app code. This used to list only components/ and pages/ (and
    // ignore lib/), so hooks, api, lib and the whole backend weren't linted.
    files: ["src/**/*.{js,mjs,cjs,jsx}"],
    ignores: [
      "src/components/ui/accordion.jsx",
      "src/components/ui/aspect-ratio.jsx",
      "src/components/ui/avatar.jsx",
      "src/components/ui/breadcrumb.jsx",
      "src/components/ui/card.jsx",
      "src/components/ui/carousel.jsx",
      "src/components/ui/chart.jsx",
      "src/components/ui/checkbox.jsx",
      "src/components/ui/collapsible.jsx",
      "src/components/ui/command.jsx",
      "src/components/ui/context-menu.jsx",
      "src/components/ui/drawer.jsx",
      "src/components/ui/form.jsx",
      "src/components/ui/hover-card.jsx",
      "src/components/ui/input-otp.jsx",
      "src/components/ui/menubar.jsx",
      "src/components/ui/navigation-menu.jsx",
      "src/components/ui/pagination.jsx",
      "src/components/ui/progress.jsx",
      "src/components/ui/radio-group.jsx",
      "src/components/ui/resizable.jsx",
      "src/components/ui/scroll-area.jsx",
      "src/components/ui/separator.jsx",
      "src/components/ui/sheet.jsx",
      "src/components/ui/sidebar.jsx",
      "src/components/ui/skeleton.jsx",
      "src/components/ui/slider.jsx",
      "src/components/ui/sonner.jsx",
      "src/components/ui/switch.jsx",
      "src/components/ui/table.jsx",
      "src/components/ui/tabs.jsx",
      "src/components/ui/toast.jsx",
      "src/components/ui/toaster.jsx",
      "src/components/ui/toggle-group.jsx",
      "src/components/ui/toggle.jsx",
      "src/components/ui/tooltip.jsx",
      "src/components/ui/use-toast.jsx",
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      react: pluginReact,
      "react-hooks": {
        rules: {
          "exhaustive-deps": noopRule,
          "rules-of-hooks": noopRule,
        },
      },
    },
    settings: { react: { version: "18" } },
    rules: sharedRules({
      // A component used in JSX but never imported crashes the page at
      // render; core no-undef doesn't look inside JSX, this does.
      "react/jsx-no-undef": "error",
      // Counts JSX usage, so components aren't reported as unused.
      "react/jsx-uses-vars": "error",
    }),
  },
  {
    files: ["backend/**/*.js"],
    languageOptions: {
      globals: globals.node,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    rules: sharedRules(),
  },
  {
    // Vitest runs with `globals: true` (vitest.config.js), so tests may
    // use describe/it/expect/vi without importing them.
    files: ["src/**/*.test.{js,jsx}", "backend/**/*.test.js", "src/test/**/*.{js,jsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.vitest },
    },
  },
];

/**
 * The recommended rules plus our own. They used to be REPLACED rather than
 * extended: the block spread pluginJs.configs.recommended and then set its
 * own `rules`, which overwrote them — so no-undef never ran, and a missing
 * import (`cn`) and a shadowed one (`rangeLabel`) both shipped as crashes.
 *
 * @param {Record<string, unknown>} [extra]
 */
function sharedRules(extra = {}) {
  return {
    ...pluginJs.configs.recommended.rules,
    // A local that hides an import or outer variable — the rangeLabel crash.
    "no-shadow": ["error", { hoist: "functions" }],
    // `catch {}` is how this codebase says "ignore, it's optional".
    "no-empty": ["error", { allowEmptyCatch: true }],
    "no-unused-vars": [
      "warn",
      {
        vars: "all",
        varsIgnorePattern: "^_",
        args: "after-used",
        argsIgnorePattern: "^_",
        caughtErrors: "none",
      },
    ],
    ...extra,
  };
}
