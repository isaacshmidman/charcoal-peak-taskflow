const isServer = typeof window === "undefined";
const fallbackStorage = {
  /** @type {Map<string, string>} */
  values: new Map(),
  /** @param {string} key */
  getItem(key) { return this.values.get(key) ?? null; },
  /** @param {string} key @param {string} value */
  setItem(key, value) { this.values.set(key, value); },
  /** @param {string} key */
  removeItem(key) { this.values.delete(key); },
};
const storage = isServer ? fallbackStorage : window.localStorage;

/**
 * @typedef {{
 *   accessToken: string,
 *   appId: string,
 *   apiBaseUrl: string,
 *   fromUrl: string,
 *   localSession: string,
 * }} StorageKeys
 */

/** @type {StorageKeys} */
export const APP_STORAGE_KEYS = {
  accessToken: "taskflow_access_token",
  appId: "taskflow_app_id",
  apiBaseUrl: "taskflow_api_base_url",
  fromUrl: "taskflow_from_url",
  localSession: "taskflow_local_session",
};

const TOKEN_FALLBACK_STORAGE_KEYS = ["token"];
const CLEAR_TOKEN_STORAGE_KEY = "__taskflow_clear_token__";

/**
 * @param {string} key
 * @returns {string | null}
 */
function getStorageValue(key) {
  if (!storage?.getItem) return null;

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {string} value
 * @returns {void}
 */
function setStorageValue(key, value) {
  if (!storage?.setItem || value == null || value === "") return;

  try {
    storage.setItem(key, value);
  } catch {}
}

/**
 * @param {string} key
 * @returns {void}
 */
function removeStorageValue(key) {
  if (!storage?.removeItem) return;

  try {
    storage.removeItem(key);
  } catch {}
}

/**
 * @param {Array<string | null | undefined>} values
 * @returns {string | null}
 */
function getFirstDefined(values) {
  return values.find((value) => value != null && value !== "") ?? null;
}

/**
 * @param {string} primaryKey
 * @param {string[]} [legacyKeys]
 * @returns {string | null}
 */
function readStoredValue(primaryKey, legacyKeys = []) {
  const primaryValue = getStorageValue(primaryKey);
  if (primaryValue) return primaryValue;

  const legacyValue = getFirstDefined(legacyKeys.map(getStorageValue));
  if (legacyValue) {
    setStorageValue(primaryKey, legacyValue);
    return legacyValue;
  }

  return null;
}

/**
 * @param {{
 *   paramNames?: string[],
 *   storageKey: string,
 *   legacyStorageKeys?: string[],
 *   defaultValues?: Array<string | null | undefined>,
 *   removeFromUrl?: boolean,
 * }} options
 * @returns {string | null}
 */
function readConfigValue({
  paramNames = [],
  storageKey,
  legacyStorageKeys = [],
  defaultValues = [],
  removeFromUrl = false,
}) {
  if (isServer) {
    return getFirstDefined(defaultValues);
  }

  const searchParams = new URLSearchParams(window.location.search);
  const searchValue = getFirstDefined(paramNames.map((paramName) => searchParams.get(paramName)));

  if (removeFromUrl) {
    let didChange = false;
    paramNames.forEach((paramName) => {
      if (searchParams.has(paramName)) {
        searchParams.delete(paramName);
        didChange = true;
      }
    });
    if (didChange) {
      const newUrl = `${window.location.pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}${window.location.hash}`;
      window.history.replaceState({}, document.title, newUrl);
    }
  }

  if (searchValue) {
    setStorageValue(storageKey, searchValue);
    return searchValue;
  }

  const defaultValue = getFirstDefined(defaultValues);
  if (defaultValue) {
    setStorageValue(storageKey, defaultValue);
    return defaultValue;
  }

  return readStoredValue(storageKey, legacyStorageKeys);
}

/** @returns {void} */
function clearStoredToken() {
  removeStorageValue(APP_STORAGE_KEYS.accessToken);
  TOKEN_FALLBACK_STORAGE_KEYS.forEach(removeStorageValue);
}

/** @returns {string} */
function getWindowUrl() {
  if (isServer) return "";
  return window.location.href;
}

/**
 * @returns {{
 *   appId: string | null,
 *   token: string | null,
 *   fromUrl: string | null,
 *   apiBaseUrl: string | null,
 * }}
 */
function getAppConfig() {
  if (
    readConfigValue({
      paramNames: ["clear_access_token", "clear_token"],
      storageKey: CLEAR_TOKEN_STORAGE_KEY,
      removeFromUrl: true,
    }) === "true"
  ) {
    clearStoredToken();
    removeStorageValue(CLEAR_TOKEN_STORAGE_KEY);
  }

  return {
    appId: readConfigValue({
      paramNames: ["app_id"],
      storageKey: APP_STORAGE_KEYS.appId,
      defaultValues: [import.meta.env.VITE_APP_ID],
    }),
    token: readConfigValue({
      paramNames: ["access_token"],
      storageKey: APP_STORAGE_KEYS.accessToken,
      legacyStorageKeys: TOKEN_FALLBACK_STORAGE_KEYS,
      removeFromUrl: true,
    }),
    fromUrl: readConfigValue({
      paramNames: ["from_url"],
      storageKey: APP_STORAGE_KEYS.fromUrl,
      defaultValues: [getWindowUrl()],
    }),
    apiBaseUrl: readConfigValue({
      paramNames: ["api_base_url", "app_base_url"],
      storageKey: APP_STORAGE_KEYS.apiBaseUrl,
      defaultValues: [import.meta.env.VITE_API_BASE_URL],
    }),
  };
}

/**
 * @type {{
 *   appId: string | null,
 *   apiBaseUrl: string | null,
 *   token: string | null,
 *   fromUrl: string | null,
 * }}
 */
export const appConfig = {
  ...getAppConfig(),
};

/** @returns {string | null} */
export function getStoredAccessToken() {
  return readStoredValue(APP_STORAGE_KEYS.accessToken, TOKEN_FALLBACK_STORAGE_KEYS);
}

/** @param {string | null | undefined} token */
export function saveAccessToken(token) {
  if (!token) return;
  setStorageValue(APP_STORAGE_KEYS.accessToken, token);
  setStorageValue("token", token);
}

/** @returns {void} */
export function removeAccessToken() {
  clearStoredToken();
}

/** @returns {any | null} */
export function getStoredLocalSession() {
  const rawValue = getStorageValue(APP_STORAGE_KEYS.localSession);
  if (!rawValue) return null;

  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

/** @param {any} session */
export function saveLocalSession(session) {
  if (!session) return;
  setStorageValue(APP_STORAGE_KEYS.localSession, JSON.stringify(session));
}

/** @returns {void} */
export function removeLocalSession() {
  removeStorageValue(APP_STORAGE_KEYS.localSession);
}
