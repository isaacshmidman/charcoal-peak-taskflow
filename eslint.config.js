import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";

export default [
  {
    files: [
      "src/components/**/*.{js,mjs,cjs,jsx}",
      "src/pages/**/*.{js,mjs,cjs,jsx}",
      "src/Layout.jsx",
    ],
    ignores: [
      "src/lib/**/*",
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
    ...pluginJs.configs.recommended,
    ...pluginReact.configs.flat.recommended,
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
    settings: {
      react: {
        version: "detect",
      },
    },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      "no-unused-vars": "off",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": [
        "error",
        { ignore: ["cmdk-input-wrapper", "toast-close"] },
      ],
      "react-hooks/rules-of-hooks": "error",
    },
  },
];
