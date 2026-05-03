// @ts-nocheck
const isServer = typeof window === "undefined";
const fallbackStorage = new Map();
const storage = isServer ? fallbackStorage : window.localStorage;

export const APP_STORAGE_KEYS = {
  accessToken: "taskflow_access_token",
  appId: "taskflow_app_id",
  apiBaseUrl: "taskflow_api_base_url",
  fromUrl: "taskflow_from_url",
  localSession: "taskflow_local_session",
};

const TOKEN_FALLBACK_STORAGE_KEYS = ["token"];
const CLEAR_TOKEN_STORAGE_KEY = "__taskflow_clear_token__";

function getStorageValue(key) {
  if (!storage?.getItem) return null;

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function setStorageValue(key, value) {
  if (!storage?.setItem || value == null || value === "") return;

  try {
    storage.setItem(key, value);
  } catch {}
}

function removeStorageValue(key) {
  if (!storage?.removeItem) return;

  try {
    storage.removeItem(key);
  } catch {}
}

function getFirstDefined(values) {
  return values.find((value) => value != null && value !== "") ?? null;
}

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

function clearStoredToken() {
  removeStorageValue(APP_STORAGE_KEYS.accessToken);
  TOKEN_FALLBACK_STORAGE_KEYS.forEach(removeStorageValue);
}

function getWindowUrl() {
  if (isServer) return "";
  return window.location.href;
}

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

export const appConfig = {
  ...getAppConfig(),
};

export function getStoredAccessToken() {
  return readStoredValue(APP_STORAGE_KEYS.accessToken, TOKEN_FALLBACK_STORAGE_KEYS);
}

export function saveAccessToken(token) {
  if (!token) return;
  setStorageValue(APP_STORAGE_KEYS.accessToken, token);
  setStorageValue("token", token);
}

export function removeAccessToken() {
  clearStoredToken();
}

export function getStoredLocalSession() {
  const rawValue = getStorageValue(APP_STORAGE_KEYS.localSession);
  if (!rawValue) return null;

  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

export function saveLocalSession(session) {
  if (!session) return;
  setStorageValue(APP_STORAGE_KEYS.localSession, JSON.stringify(session));
}

export function removeLocalSession() {
  removeStorageValue(APP_STORAGE_KEYS.localSession);
}
