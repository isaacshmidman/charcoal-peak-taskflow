import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { backendConfig } from "./backend/config.js";
import { closeDatabase } from "./backend/db.js";
import { createRequestHandler } from "./backend/server.js";
import { createViteConfig } from "./vite.shared.js";

function createEmbeddedBackendPlugin({ appId }) {
  return {
    name: "taskflow-embedded-backend",
    apply: "serve",
    configureServer(server) {
      const configuredPort = Number(server.config.server.port || 5173);
      const handler = createRequestHandler({
        ...backendConfig,
        appId: appId || backendConfig.appId,
        host: "127.0.0.1",
        port: configuredPort,
        publicAppUrl: `http://127.0.0.1:${configuredPort}`,
      });

      server.httpServer?.once("close", () => {
        closeDatabase();
      });

      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/api")) {
          next();
          return;
        }

        try {
          await handler(request, response);
          if (!response.writableEnded) {
            next();
          }
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const useEmbeddedApi = mode !== "e2e" && env.TASKFLOW_USE_EMBEDDED_BACKEND !== "0";

  return {
    ...createViteConfig({ apiBaseUrl: env.VITE_API_BASE_URL || "", useEmbeddedApi }),
    optimizeDeps: { force: true },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            "react-query": ["@tanstack/react-query"],
            radix: [
              "@radix-ui/react-alert-dialog",
              "@radix-ui/react-dialog",
              "@radix-ui/react-dropdown-menu",
              "@radix-ui/react-label",
              "@radix-ui/react-popover",
              "@radix-ui/react-select",
              "@radix-ui/react-slot",
            ],
            motion: ["framer-motion"],
            dnd: ["@dnd-kit/core", "@dnd-kit/modifiers"],
            "date-picker": ["react-day-picker", "date-fns"],
            icons: ["lucide-react"],
          },
        },
      },
    },
    plugins: [
      react(),
      ...(useEmbeddedApi ? [createEmbeddedBackendPlugin({ appId: env.VITE_APP_ID || backendConfig.appId })] : []),
    ],
  };
});
