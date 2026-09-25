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

/**
 * Remove query parameters from the address bar without reloading.
 * @param {string[]} names
 * @returns {void}
 */
function stripUrlParams(names) {
  if (isServer) return;
  const searchParams = new URLSearchParams(window.location.search);
  const present = names.filter((name) => searchParams.has(name));
  if (!present.length) return;
  present.forEach((name) => searchParams.delete(name));
  const query = searchParams.toString();
  window.history.replaceState({}, document.title, `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}

/**
 * Link parameters that used to reconfigure the app (inherited from Base44)
 * and are now stripped and ignored. Nothing in Zephyrly generates them, and
 * each let a crafted link take over a browser:
 *   - api_base_url / app_base_url pointed every request — and so every task
 *     and note typed afterwards — at whatever server the link named, and
 *     saved that choice so it outlived the visit;
 *   - access_token quietly signed the visitor into the link-maker's
 *     account, so whatever they typed next went to that account;
 *   - app_id could leave the app failing every request until site data
 *     was cleared.
 */
export const IGNORED_URL_PARAMS = ["api_base_url", "app_base_url", "access_token", "app_id"];

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

  stripUrlParams(IGNORED_URL_PARAMS);
  // An API address saved by an earlier ?api_base_url link must not keep
  // redirecting requests now that the parameter is ignored.
  removeStorageValue(APP_STORAGE_KEYS.apiBaseUrl);

  return {
    appId: readConfigValue({
      storageKey: APP_STORAGE_KEYS.appId,
      defaultValues: [import.meta.env.VITE_APP_ID],
    }),
    token: readConfigValue({
      storageKey: APP_STORAGE_KEYS.accessToken,
      legacyStorageKeys: TOKEN_FALLBACK_STORAGE_KEYS,
    }),
    fromUrl: readConfigValue({
      paramNames: ["from_url"],
      storageKey: APP_STORAGE_KEYS.fromUrl,
      defaultValues: [getWindowUrl()],
    }),
    // Build-time only: never from a link, never from storage.
    apiBaseUrl: import.meta.env.VITE_API_BASE_URL || null,
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
