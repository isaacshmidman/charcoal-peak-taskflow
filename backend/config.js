// @ts-check
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(__dirname, "..");

const ENV_FILES = [".env.backend.local", ".env.local", ".env.backend", ".env"];

function loadEnvFiles() {
  for (const relativePath of ENV_FILES) {
    const absolutePath = resolve(projectRoot, relativePath);
    if (!existsSync(absolutePath)) continue;

    const source = readFileSync(absolutePath, "utf8");
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex <= 0) continue;

      const key = trimmed.slice(0, equalsIndex).trim();
      if (!key || process.env[key] != null) continue;

      let value = trimmed.slice(equalsIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  }
}

loadEnvFiles();

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const isProduction = process.env.NODE_ENV === "production";
const host = process.env.TASKFLOW_BACKEND_HOST || process.env.HOST || (isProduction ? "0.0.0.0" : "127.0.0.1");
const port = parseInteger(process.env.TASKFLOW_BACKEND_PORT || process.env.PORT, 8787);
const appId = process.env.TASKFLOW_APP_ID || process.env.VITE_APP_ID || "taskflow-local";

const googleClientId = process.env.TASKFLOW_GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.TASKFLOW_GOOGLE_CLIENT_SECRET || "";
const hasGoogleCredentials = Boolean(googleClientId && googleClientSecret);

export const backendConfig = {
  host,
  port,
  appId,
  appName: process.env.TASKFLOW_APP_NAME || "Charcoal Peak Taskflow",
  publicAppUrl:
    process.env.TASKFLOW_PUBLIC_APP_URL ||
    "http://127.0.0.1:5173",
  dbFile:
    process.env.TASKFLOW_DB_FILE || resolve(projectRoot, "backend", "data", "taskflow.sqlite"),
  sessionCookieName: process.env.TASKFLOW_SESSION_COOKIE_NAME || "taskflow_session",
  sessionTtlDays: parseInteger(process.env.TASKFLOW_SESSION_TTL_DAYS, 30),
  deletedTaskRetentionDays: parseInteger(
    process.env.TASKFLOW_DELETED_TASK_RETENTION_DAYS,
    7
  ),
  allowAnyPassword: parseBoolean(process.env.TASKFLOW_ALLOW_ANY_PASSWORD, false),
  googleClientId,
  googleClientSecret,
  googleMode:
    process.env.TASKFLOW_GOOGLE_MODE ||
    (hasGoogleCredentials ? "oauth" : process.env.NODE_ENV === "production" ? "disabled" : "disabled"),
};

export function getGoogleRedirectUrl(config = backendConfig) {
  return (
    process.env.TASKFLOW_GOOGLE_REDIRECT_URL ||
    `http://${config.host}:${config.port}/api/apps/auth/google/callback`
  );
}

export function getDeletedTaskRetentionMs(config = backendConfig) {
  return config.deletedTaskRetentionDays * 24 * 60 * 60 * 1000;
}
