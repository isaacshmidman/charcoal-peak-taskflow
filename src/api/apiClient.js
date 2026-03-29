import { appConfig, getStoredAccessToken, removeAccessToken, saveAccessToken } from "@/lib/app-config";
import { createE2EApiClient } from "@/lib/mockBackend";
import { loadFromCache, saveToCache } from "@/lib/offlineCache";

/**
 * @typedef {{
 *   status?: number,
 *   code?: string,
 *   data?: any,
 *   originalError?: unknown,
 * }} ApiErrorOptions
 */

/**
 * @typedef {{
 *   list: (sort?: string, limit?: number, skip?: number, fields?: string[] | string) => Promise<any>,
 *   filter?: (query: Record<string, unknown>, sort?: string, limit?: number, skip?: number, fields?: string[] | string) => Promise<any>,
 *   get: (id: string) => Promise<any>,
 *   create: (data: any) => Promise<any>,
 *   update: (id: string, data: any) => Promise<any>,
 *   delete: (id: string) => Promise<any>,
 * }} EntityStore
 */

/**
 * @typedef {Record<string, EntityStore>} EntitiesModule
 */

/**
 * @typedef {{
 *   entities: EntitiesModule,
 *   auth: {
 *     me: () => Promise<any>,
 *     redirectToLogin: (nextUrl?: string) => void,
 *     loginWithEmailPassword: (email: string, password: string) => Promise<any>,
 *     loginWithProvider: (provider: string, fromUrl?: string) => void,
 *     logout: (redirectUrl?: string | false) => Promise<void>,
 *     setToken: (token: string, saveToStorage?: boolean) => void,
 *   },
  *   setToken: (token: string, saveToStorage?: boolean) => void,
  *   getPublicSettings: () => Promise<any>,
 *   cleanup: () => void,
 * }} ApiClient
 */

export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {ApiErrorOptions} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.data = options.data;
    this.originalError = options.originalError;
  }
}

let currentToken = appConfig.token || getStoredAccessToken();
const PUBLIC_SETTINGS_CACHE_KEY = "publicSettings";
const ENTITY_CACHE_KEYS = {
  Task: "tasks",
  Priority: "priorities",
  SavedTag: "savedTags",
  DeletedTask: "deletedTasks",
};

const isRecoverableReadError = (error) =>
  error instanceof ApiError && (error.status == null || error.status >= 500);

const readCachedEntityList = (entityName) => {
  const cacheKey = ENTITY_CACHE_KEYS[entityName];
  return cacheKey ? loadFromCache(cacheKey) : null;
};

const writeCachedEntityList = (entityName, value) => {
  const cacheKey = ENTITY_CACHE_KEYS[entityName];
  if (!cacheKey) return;
  saveToCache(cacheKey, value);
};

const normalizeBaseUrl = (value) => (value || "").replace(/\/$/, "");

const resolveAppOrigin = () => {
  const configuredBaseUrl = normalizeBaseUrl(appConfig.apiBaseUrl);
  if (configuredBaseUrl) return configuredBaseUrl;
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost";
};

const resolveApiOrigin = () => {
  if (typeof window !== "undefined") return window.location.origin;
  return resolveAppOrigin();
};

const buildApiUrl = (path, query = undefined) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`/api${normalizedPath}`, resolveApiOrigin());

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value == null || value === "") return;
      url.searchParams.set(key, String(value));
    });
  }

  return url.toString();
};

const parseResponseBody = async (response) => {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }

  const text = await response.text().catch(() => "");
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * @param {string} path
 * @param {{
 *   method?: string,
 *   body?: any,
 *   headers?: Record<string, string>,
 *   query?: Record<string, string | number | boolean | undefined>,
 *   raw?: boolean,
 * }} [options]
 */
async function apiRequest(path, { method = "GET", body, headers = {}, query, raw = false } = {}) {
  const response = await fetch(buildApiUrl(path, query), {
    method,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(appConfig.appId ? { "X-App-Id": String(appConfig.appId) } : {}),
      ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
      ...(typeof window !== "undefined" ? { "X-Origin-URL": window.location.href } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).catch((error) => {
    throw new ApiError(error.message || "Network request failed", { originalError: error });
  });

  if (raw) return response;

  const data = await parseResponseBody(response);
  if (!response.ok) {
    throw new ApiError(data?.message || data?.detail || response.statusText || "Request failed", {
      status: response.status,
      code: data?.code,
      data,
    });
  }

  return data;
}

function createEntityStore(entityName) {
  const basePath = `/apps/${appConfig.appId}/entities/${entityName}`;

  return {
    async list(sort, limit, skip, fields) {
      try {
        const result = await apiRequest(basePath, {
          query: {
            sort,
            limit,
            skip,
            fields: Array.isArray(fields) ? fields.join(",") : fields,
          },
        });
        writeCachedEntityList(entityName, result);
        return result;
      } catch (error) {
        if (isRecoverableReadError(error)) {
          const cached = readCachedEntityList(entityName);
          if (cached) return cached;
        }
        throw error;
      }
    },
    async filter(query, sort, limit, skip, fields) {
      try {
        const result = await apiRequest(basePath, {
          query: {
            q: JSON.stringify(query),
            sort,
            limit,
            skip,
            fields: Array.isArray(fields) ? fields.join(",") : fields,
          },
        });
        return result;
      } catch (error) {
        if (isRecoverableReadError(error)) {
          const cached = readCachedEntityList(entityName);
          if (cached) {
            return cached;
          }
        }
        throw error;
      }
    },
    async get(id) {
      try {
        return await apiRequest(`${basePath}/${id}`);
      } catch (error) {
        if (isRecoverableReadError(error)) {
          const cached = readCachedEntityList(entityName);
          const match = Array.isArray(cached) ? cached.find((item) => String(item.id) === String(id)) : null;
          if (match) return match;
        }
        throw error;
      }
    },
    async create(data) {
      return apiRequest(basePath, { method: "POST", body: data });
    },
    async update(id, data) {
      return apiRequest(`${basePath}/${id}`, { method: "PUT", body: data });
    },
    async delete(id) {
      return apiRequest(`${basePath}/${id}`, { method: "DELETE" });
    },
  };
}

const entities = /** @type {EntitiesModule} */ (new Proxy(
  {},
  {
    get(_target, entityName) {
      if (typeof entityName !== "string" || entityName === "then" || entityName.startsWith("_")) {
        return undefined;
      }
      return createEntityStore(entityName);
    },
  }
));

/** @type {ApiClient} */
const liveApiClient = {
  entities,
  auth: {
    async me() {
      return apiRequest(`/apps/${appConfig.appId}/entities/User/me`);
    },
    redirectToLogin(nextUrl) {
      if (typeof window === "undefined") return;
      const loginUrl = new URL("/login", window.location.origin);
      loginUrl.searchParams.set("next", nextUrl || window.location.href);
      window.location.href = loginUrl.toString();
    },
    async loginWithEmailPassword(email, password) {
      const response = await apiRequest(`/apps/${appConfig.appId}/auth/login`, {
        method: "POST",
        body: {
          email,
          password,
        },
      });

      if (response?.access_token) {
        liveApiClient.auth.setToken(response.access_token);
      }

      return response;
    },
    loginWithProvider(provider, fromUrl = "/") {
      if (typeof window === "undefined") return;

      const authPath =
        provider === "sso"
          ? `/apps/${appConfig.appId}/auth/sso/login`
          : `/apps/auth${provider && provider !== "google" ? `/${provider}` : ""}/login`;

      // Start auth from the current app origin so local dev uses the Vite /api proxy
      // and production stays on the same deployed origin.
      window.location.href = buildApiUrl(authPath, {
        app_id: appConfig.appId,
        from_url: new URL(fromUrl, window.location.origin).toString(),
      });
    },
    async logout(redirectUrl) {
      currentToken = null;
      removeAccessToken();

      if (typeof window === "undefined") return;
      const loginUrl = new URL("/login", window.location.origin).toString();
      const nextUrl = redirectUrl === false ? false : redirectUrl || loginUrl;

      try {
        await fetch(buildApiUrl("/apps/auth/logout", nextUrl === false ? undefined : { from_url: nextUrl }), {
          method: "GET",
          credentials: "include",
        });
      } catch {}

      if (nextUrl !== false) {
        window.location.href = nextUrl;
      }
    },
    setToken(token, saveToStorage = true) {
      currentToken = token || null;
      if (!token) {
        if (saveToStorage) {
          removeAccessToken();
        }
        return;
      }
      if (saveToStorage) {
        saveAccessToken(token);
      }
    },
  },
  setToken(token, saveToStorage = true) {
    liveApiClient.auth.setToken(token, saveToStorage);
  },
  async getPublicSettings() {
    try {
      const result = await apiRequest(`/apps/public/prod/public-settings/by-id/${appConfig.appId}`);
      saveToCache(PUBLIC_SETTINGS_CACHE_KEY, result);
      return result;
    } catch (error) {
      if (isRecoverableReadError(error)) {
        const cached = loadFromCache(PUBLIC_SETTINGS_CACHE_KEY);
        if (cached) return cached;
      }
      throw error;
    }
  },
  cleanup() {},
};

/** @type {ApiClient} */
export const apiClient = createE2EApiClient() || liveApiClient;
