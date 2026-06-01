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
 *   notifications: {
 *     getSettings: () => Promise<any>,
 *     updateSettings: (settings: any) => Promise<any>,
 *     subscribe: (subscription: any) => Promise<any>,
 *     unsubscribe: (endpoint: string) => Promise<any>,
 *     sendTest: () => Promise<any>,
 *   },
 *   integrations: {
 *     list: () => Promise<any[]>,
 *     connectApple: (creds: { email: string, password: string }) => Promise<any>,
 *     connectGoogle: (fromUrl?: string) => void,
 *     disconnect: (id: string) => Promise<any>,
 *     sync: (id: string) => Promise<any>,
 *     listCalendars: (id: string) => Promise<any[]>,
 *     setCalendars: (id: string, updates: Record<string, boolean>) => Promise<any[]>,
 *     setDefault: (id: string) => Promise<any>,
 *     setPrimaryCalendar: (id: string, externalCalendarId: string) => Promise<any>,
 *     setCalendarColor: (id: string, externalCalendarId: string, colorHex: string) => Promise<any>,
 *   },
 *   attachments: {
 *     list: (taskId: string) => Promise<any[]>,
 *     upload: (taskId: string, file: File, opts?: { onProgress?: (percent: number) => void }) => Promise<any>,
 *     delete: (id: string) => Promise<any>,
 *     urlFor: (id: string, opts?: { download?: boolean, thumb?: boolean }) => string,
 *     usage: () => Promise<{ used_bytes: number, max_bytes: number, biggest_tasks: any[] }>,
 *     search: (q: string) => Promise<any[]>,
 *   },
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
const INTEGRATIONS_CACHE_KEY = "integrations";
const INTEGRATION_CALENDARS_CACHE_KEY = "integrationCalendars";
const NOTIFICATION_SETTINGS_CACHE_KEY = "notificationSettings";
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

const resolveApiOrigin = () => {
  const configuredBaseUrl = normalizeBaseUrl(appConfig.apiBaseUrl);
  if (configuredBaseUrl) return configuredBaseUrl;
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost";
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
    async loginWithProvider(provider, fromUrl = "/") {
      if (typeof window === "undefined") return;

      const authPath =
        provider === "sso"
          ? `/apps/${appConfig.appId}/auth/sso/login`
          : `/apps/auth${provider && provider !== "google" ? `/${provider}` : ""}/login`;

      const loginUrl = buildApiUrl(authPath, {
        app_id: appConfig.appId,
        from_url: new URL(fromUrl, window.location.origin).toString(),
      });

      // Fetch the OAuth redirect URL as JSON instead of navigating to /api.
      // This completely bypasses service worker navigation interception —
      // older cached service workers intercept navigation requests to /api
      // and serve index.html instead of letting the 302 reach Google.
      // By using fetch() + Accept: application/json, the SW's fetch handler
      // passes the request through to the network, and we navigate directly
      // to the Google URL returned in the JSON response.
      try {
        const response = await fetch(loginUrl, {
          headers: { Accept: "application/json" },
          credentials: "include",
        });
        if (response.ok) {
          const data = await response.json();
          if (data.redirect_url) {
            window.location.href = data.redirect_url;
            return;
          }
        }
      } catch {
        // Network error or SW interference — fall through to direct navigation
      }

      // Fallback: direct navigation (works once the fixed SW is active)
      window.location.href = loginUrl;
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
  integrations: {
    async list() {
      try {
        const data = await apiRequest(`/apps/${appConfig.appId}/integrations`);
        const integrations = Array.isArray(data?.integrations) ? data.integrations : [];
        saveToCache(INTEGRATIONS_CACHE_KEY, integrations);
        return integrations;
      } catch (error) {
        if (isRecoverableReadError(error)) {
          const cached = loadFromCache(INTEGRATIONS_CACHE_KEY);
          if (Array.isArray(cached)) return cached;
        }
        throw error;
      }
    },
    async connectApple({ email, password }) {
      return apiRequest(`/apps/${appConfig.appId}/integrations/apple/connect`, {
        method: "POST",
        body: { email, password },
      });
    },
    connectGoogle(fromUrl) {
      if (typeof window === "undefined") return;
      const fromAbs = new URL(fromUrl || "/Settings", window.location.origin).toString();
      const url = buildApiUrl(`/apps/${appConfig.appId}/integrations/google/connect`, {
        from_url: fromAbs,
      });
      window.location.href = url;
    },
    async disconnect(id) {
      return apiRequest(`/apps/${appConfig.appId}/integrations/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
    async sync(id) {
      return apiRequest(
        `/apps/${appConfig.appId}/integrations/${encodeURIComponent(id)}/sync`,
        { method: "POST" }
      );
    },
    async listCalendars(id) {
      const cacheId = String(id);
      try {
        const data = await apiRequest(
          `/apps/${appConfig.appId}/integrations/${encodeURIComponent(id)}/calendars`
        );
        const calendars = Array.isArray(data?.calendars) ? data.calendars : [];
        const cachedByIntegration = loadFromCache(INTEGRATION_CALENDARS_CACHE_KEY) || {};
        saveToCache(INTEGRATION_CALENDARS_CACHE_KEY, {
          ...cachedByIntegration,
          [cacheId]: calendars,
        });
        return calendars;
      } catch (error) {
        if (isRecoverableReadError(error)) {
          const cachedByIntegration = loadFromCache(INTEGRATION_CALENDARS_CACHE_KEY) || {};
          const cached = cachedByIntegration[cacheId];
          if (Array.isArray(cached)) return cached;
        }
        throw error;
      }
    },
    async setCalendars(id, updates) {
      const data = await apiRequest(
        `/apps/${appConfig.appId}/integrations/${encodeURIComponent(id)}/calendars`,
        { method: "PUT", body: { updates } }
      );
      const calendars = Array.isArray(data?.calendars) ? data.calendars : [];
      const cachedByIntegration = loadFromCache(INTEGRATION_CALENDARS_CACHE_KEY) || {};
      saveToCache(INTEGRATION_CALENDARS_CACHE_KEY, {
        ...cachedByIntegration,
        [String(id)]: calendars,
      });
      return calendars;
    },
    async setDefault(id) {
      return apiRequest(
        `/apps/${appConfig.appId}/integrations/${encodeURIComponent(id)}/set-default`,
        { method: "POST" }
      );
    },
    async setPrimaryCalendar(id, externalCalendarId) {
      const data = await apiRequest(
        `/apps/${appConfig.appId}/integrations/${encodeURIComponent(id)}/primary-calendar`,
        { method: "POST", body: { external_calendar_id: externalCalendarId } }
      );
      if (Array.isArray(data?.calendars)) {
        const cachedByIntegration = loadFromCache(INTEGRATION_CALENDARS_CACHE_KEY) || {};
        saveToCache(INTEGRATION_CALENDARS_CACHE_KEY, {
          ...cachedByIntegration,
          [String(id)]: data.calendars,
        });
      }
      return data;
    },
    async setCalendarColor(id, externalCalendarId, colorHex) {
      const data = await apiRequest(
        `/apps/${appConfig.appId}/integrations/${encodeURIComponent(id)}/calendar-color`,
        { method: "POST", body: { external_calendar_id: externalCalendarId, color_hex: colorHex } }
      );
      if (Array.isArray(data?.calendars)) {
        const cachedByIntegration = loadFromCache(INTEGRATION_CALENDARS_CACHE_KEY) || {};
        saveToCache(INTEGRATION_CALENDARS_CACHE_KEY, {
          ...cachedByIntegration,
          [String(id)]: data.calendars,
        });
      }
      return data;
    },
  },
  notifications: {
    async getSettings() {
      try {
        const result = await apiRequest(`/apps/${appConfig.appId}/notifications/settings`);
        saveToCache(NOTIFICATION_SETTINGS_CACHE_KEY, result);
        return result;
      } catch (error) {
        if (isRecoverableReadError(error)) {
          const cached = loadFromCache(NOTIFICATION_SETTINGS_CACHE_KEY);
          if (cached) return cached;
        }
        throw error;
      }
    },
    async updateSettings(settings) {
      const result = await apiRequest(`/apps/${appConfig.appId}/notifications/settings`, {
        method: "PUT",
        body: { settings },
      });
      saveToCache(NOTIFICATION_SETTINGS_CACHE_KEY, result);
      return result;
    },
    async subscribe(subscription) {
      return apiRequest(`/apps/${appConfig.appId}/notifications/subscribe`, {
        method: "POST",
        body: { subscription },
      });
    },
    async unsubscribe(endpoint) {
      return apiRequest(`/apps/${appConfig.appId}/notifications/unsubscribe`, {
        method: "POST",
        body: { endpoint },
      });
    },
    async sendTest() {
      return apiRequest(`/apps/${appConfig.appId}/notifications/test`, {
        method: "POST",
      });
    },
  },
  attachments: {
    async list(taskId) {
      const result = await apiRequest(`/apps/${appConfig.appId}/tasks/${taskId}/attachments`);
      return result?.attachments || [];
    },
    /**
     * Upload a single file (multipart/form-data). Returns the created
     * attachment metadata row.
     *
     * Uses XMLHttpRequest rather than fetch so we get upload-progress
     * events (fetch has none). `onProgress(percent)` is called with an
     * integer 0–100 as bytes go out; it's a no-op-safe optional arg.
     *
     * @param {string} taskId
     * @param {File} file
     * @param {{ onProgress?: (percent: number) => void }} [opts]
     * @returns {Promise<any>}
     */
    upload(taskId, file, { onProgress } = {}) {
      return new Promise((resolve, reject) => {
        const url = buildApiUrl(`/apps/${appConfig.appId}/tasks/${taskId}/attachments`);
        const formData = new FormData();
        formData.append("file", file, file.name);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);
        xhr.withCredentials = true;
        xhr.responseType = "text";
        xhr.setRequestHeader("Accept", "application/json");
        // Intentionally NOT setting Content-Type — the browser sets it
        // to "multipart/form-data; boundary=..." automatically from the
        // FormData body, with the correct boundary.
        if (appConfig.appId) xhr.setRequestHeader("X-App-Id", String(appConfig.appId));
        if (currentToken) xhr.setRequestHeader("Authorization", `Bearer ${currentToken}`);

        if (xhr.upload && typeof onProgress === "function") {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && e.total > 0) {
              onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
            }
          };
        }

        const parse = (text) => {
          if (!text) return null;
          try { return JSON.parse(text); } catch { return text; }
        };

        xhr.onload = () => {
          const payload = parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            // Signal "done" so a determinate bar can snap to 100%.
            if (typeof onProgress === "function") onProgress(100);
            resolve(payload);
            return;
          }
          const err = new Error(
            (payload && (payload.message || payload.error)) ||
              `Upload failed (${xhr.status})`
          );
          // @ts-ignore — non-standard properties for callers
          err.code = payload?.code;
          // @ts-ignore
          err.status = xhr.status;
          reject(err);
        };
        xhr.onerror = () => reject(new Error("Network error during upload."));
        xhr.onabort = () => reject(new Error("Upload cancelled."));
        xhr.send(formData);
      });
    },
    async delete(id) {
      return apiRequest(`/apps/${appConfig.appId}/attachments/${id}`, {
        method: "DELETE",
      });
    },
    /**
     * Build the same-origin URL for downloading or previewing an
     * attachment. Used as the src= for <img> tags (browser sends the
     * session cookie automatically) and as the href= for download links.
     *
     * Pass `{ thumb: true }` to ask for the server-generated thumbnail
     * (small WebP). The backend falls back to the original if no thumb
     * exists, so it's safe to set thumb=true even for pre-Pri-2 rows.
     *
     * @param {string} id
     * @param {{ download?: boolean, thumb?: boolean }} [opts]
     */
    urlFor(id, { download = false, thumb = false } = {}) {
      const query = {};
      if (download) query.download = "1";
      if (thumb) query.thumb = "1";
      return buildApiUrl(
        `/apps/${appConfig.appId}/attachments/${id}`,
        Object.keys(query).length ? query : undefined
      );
    },
    async usage() {
      return apiRequest(`/apps/${appConfig.appId}/attachments/usage`);
    },
    /**
     * Search the user's attachments by filename.
     * @param {string} q
     * @returns {Promise<any[]>}
     */
    async search(q) {
      const result = await apiRequest(`/apps/${appConfig.appId}/attachments`, {
        query: { q: q || "", limit: 50 },
      });
      return result?.attachments || [];
    },
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
