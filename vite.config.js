import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";
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
    plugins: [
      react(),
      ...(useEmbeddedApi ? [createEmbeddedBackendPlugin({ appId: env.VITE_APP_ID || backendConfig.appId })] : []),
      VitePWA({
        registerType: "autoUpdate",
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
          navigateFallbackDenylist: [/^\/api\//],
        },
        manifest: false,
      }),
    ],
  };
});
