import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { createViteConfig } from "./vite.shared.js";

function createEmbeddedBackendPlugin({ appId }) {
  return {
    name: "taskflow-embedded-backend",
    apply: "serve",
    async configureServer(server) {
      const { backendConfig } = await import("./backend/config.js");
      const { closeDatabase, getDatabase } = await import("./backend/db.js");
      const { createRequestHandler } = await import("./backend/server.js");
      const { startSyncLoop } = await import("./backend/sync.js");
      const { startNotificationLoop } = await import("./backend/notifications.js");
      const configuredPort = Number(server.config.server.port || 5173);
      const embeddedConfig = {
        ...backendConfig,
        appId: appId || backendConfig.appId,
        host: "127.0.0.1",
        port: configuredPort,
        publicAppUrl: `http://127.0.0.1:${configuredPort}`,
      };
      const db = getDatabase(embeddedConfig);
      const handler = createRequestHandler(embeddedConfig, db);
      const syncHandle = startSyncLoop(db, embeddedConfig);
      const notificationHandle = startNotificationLoop(db, embeddedConfig);

      server.httpServer?.once("close", () => {
        syncHandle.stop();
        notificationHandle.stop();
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
            dnd: ["@dnd-kit/core"],
            "date-picker": ["react-day-picker", "date-fns"],
            icons: ["lucide-react"],
          },
        },
      },
    },
    plugins: [
      react(),
      ...(useEmbeddedApi ? [createEmbeddedBackendPlugin({ appId: env.VITE_APP_ID })] : []),
    ],
  };
});
