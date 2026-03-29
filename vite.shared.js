import { fileURLToPath, URL } from "node:url";

export function createViteConfig({ apiBaseUrl = "", useEmbeddedApi = false } = {}) {
  return {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    logLevel: process.env.CI ? "error" : "info",
    server: {
      host: "127.0.0.1",
      proxy: apiBaseUrl && !useEmbeddedApi
        ? {
            "/api": {
              target: apiBaseUrl,
              changeOrigin: true,
              secure: true,
            },
          }
        : undefined,
    },
  };
}
