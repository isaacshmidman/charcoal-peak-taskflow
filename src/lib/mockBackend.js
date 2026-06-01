const isE2EMode = import.meta.env.MODE === "e2e";
const STORAGE_KEY = "__taskflow_e2e_backend__";

const clone = (value) => JSON.parse(JSON.stringify(value));

const persistBackend = (backend) => {
  if (typeof window === "undefined" || !backend) return;

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        publicSettings: backend.publicSettings,
        state: backend.state,
        counters: backend.counters,
        lastRedirectToLogin: backend.lastRedirectToLogin,
        lastLoginProvider: backend.lastLoginProvider,
        lastLoginFromUrl: backend.lastLoginFromUrl,
        lastLogout: backend.lastLogout,
        lastToken: backend.lastToken,
        lastNotificationTest: /** @type {any} */ (backend).lastNotificationTest,
      })
    );
  } catch {}
};

const toComparableValue = (value) => {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value.toLowerCase() : parsed;
  }
  return value ?? "";
};

const sortRecords = (records, sortParam) => {
  if (!sortParam) return [...records];

  const isDescending = sortParam.startsWith("-");
  const field = isDescending ? sortParam.slice(1) : sortParam;

  return [...records].sort((leftRecord, rightRecord) => {
    const left = toComparableValue(leftRecord[field]);
    const right = toComparableValue(rightRecord[field]);

    if (left < right) return isDescending ? 1 : -1;
    if (left > right) return isDescending ? -1 : 1;
    return 0;
  });
};

const createIdFactory = () => {
  let current = 1;
  return (prefix) => `${prefix}-${current++}`;
};

export function getE2EBackend() {
  if (!isE2EMode || typeof window === "undefined") return null;
  const backend = window.__TASKFLOW_E2E_BACKEND__ || null;

  if (!backend) return null;
  persistBackend(backend);
  return backend;
}

export function createE2EApiClient() {
  const backend = getE2EBackend();
  if (!backend) return null;

  const nextId = createIdFactory();
  const createEntityStore = (key, createCounter, updateCounter, deleteCounter) => ({
    async list(sort) {
      return clone(sortRecords(backend.state[key], sort));
    },
    async get(id) {
      return clone(backend.state[key].find((record) => String(record.id) === String(id)) || null);
    },
    async create(data) {
      const now = new Date().toISOString();
      const created = {
        ...data,
        id: data.id || nextId(key.slice(0, -1)),
        created_date: data.created_date || now,
        updated_date: data.updated_date || now,
      };
      backend.state[key].unshift(created);
      if (createCounter) backend.counters[createCounter] += 1;
      persistBackend(backend);
      return clone(created);
    },
    async update(id, data) {
      const index = backend.state[key].findIndex((record) => String(record.id) === String(id));
      if (index === -1) {
        throw Object.assign(new Error("Not found"), { status: 404 });
      }

      backend.state[key][index] = {
        ...backend.state[key][index],
        ...data,
        updated_date: new Date().toISOString(),
      };
      if (updateCounter) backend.counters[updateCounter] += 1;
      persistBackend(backend);
      return clone(backend.state[key][index]);
    },
    async delete(id) {
      const index = backend.state[key].findIndex((record) => String(record.id) === String(id));
      if (index !== -1) {
        backend.state[key].splice(index, 1);
      }
      if (deleteCounter) backend.counters[deleteCounter] += 1;
      persistBackend(backend);
      return { success: true };
    },
  });

  return {
    entities: {
      Task: createEntityStore("tasks", "taskCreates", "taskUpdates", "taskDeletes"),
      Priority: createEntityStore("priorities", null, null, null),
      DeletedTask: createEntityStore("deletedTasks", "deletedTaskCreates", "deletedTaskUpdates", "deletedTaskDeletes"),
      SavedTag: createEntityStore("savedTags", "savedTagCreates", null, null),
    },
    auth: {
      async me() {
        if (!backend.state.currentUser) {
          throw Object.assign(new Error("Unauthorized"), { status: 401 });
        }
        return clone(backend.state.currentUser);
      },
      async loginWithEmailPassword(email, _password) {
        const token = `mock-token-${Date.now()}`;
        const user = {
          id: backend.state.currentUser?.id || "mock-user",
          email,
          role: "user",
        };
        backend.state.currentUser = user;
        backend.lastToken = token;
        persistBackend(backend);
        return { access_token: token, user: clone(user) };
      },
      loginWithProvider(provider, fromUrl = "/") {
        backend.lastLoginProvider = provider;
        backend.lastLoginFromUrl = fromUrl;
        persistBackend(backend);
      },
      redirectToLogin(nextUrl) {
        backend.lastRedirectToLogin = nextUrl || true;
        persistBackend(backend);
      },
      async logout(redirectUrl) {
        backend.state.currentUser = null;
        backend.lastToken = null;
        backend.lastLogout = redirectUrl || true;
        persistBackend(backend);
      },
      setToken(token) {
        backend.lastToken = token;
        persistBackend(backend);
      },
    },
    async getPublicSettings() {
      return clone(backend.publicSettings);
    },
    integrations: {
      async list() {
        return [];
      },
      connectGoogle() {},
      async connectApple() {
        return { success: true };
      },
      async disconnect() {
        return { success: true };
      },
      async sync() {
        return { success: true };
      },
      async listCalendars() {
        return [];
      },
      async setCalendars() {
        return [];
      },
      async setDefault() {
        return { success: true };
      },
      async setPrimaryCalendar() {
        return { success: true };
      },
      async setCalendarColor() {
        return { success: true, calendars: [] };
      },
    },
    notifications: {
      async getSettings() {
        const state = /** @type {any} */ (backend.state);
        const settings = state.notificationSettings || {
          enabled: false,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          timedOffsetMinutes: 0,
          allDayEnabled: true,
          allDayTime: "9:00AM",
          includeExternalEvents: false,
          missedGraceMinutes: 120,
        };
        return {
          available: true,
          vapidPublicKey: "BMockNotificationPublicKey",
          reason: "",
          settings: clone(settings),
          defaulted: !state.notificationSettings,
        };
      },
      async updateSettings(settings) {
        const state = /** @type {any} */ (backend.state);
        state.notificationSettings = { ...settings };
        persistBackend(backend);
        return {
          available: true,
          vapidPublicKey: "BMockNotificationPublicKey",
          reason: "",
          settings: clone(state.notificationSettings),
          defaulted: false,
        };
      },
      async subscribe(subscription) {
        const state = /** @type {any} */ (backend.state);
        state.notificationSubscriptions = state.notificationSubscriptions || [];
        state.notificationSubscriptions.push(subscription);
        persistBackend(backend);
        return { success: true, subscription_id: `mock-sub-${state.notificationSubscriptions.length}` };
      },
      async unsubscribe(endpoint) {
        const state = /** @type {any} */ (backend.state);
        state.notificationSubscriptions = (state.notificationSubscriptions || [])
          .filter((subscription) => subscription?.endpoint !== endpoint);
        persistBackend(backend);
        return { success: true };
      },
      async sendTest() {
        /** @type {any} */ (backend).lastNotificationTest = Date.now();
        persistBackend(backend);
        return { sent: 1, failed: 0 };
      },
    },
    attachments: {
      // E2E mock keeps attachments in-memory only; no real file uploads
      // happen here. Returning empty lists keeps the UI usable in tests
      // without exercising the file pipeline (which is covered by real
      // backend tests on the server side).
      async list(_taskId) {
        return [];
      },
      async upload(_taskId, _file, opts) {
        if (opts && typeof opts.onProgress === "function") opts.onProgress(100);
        return null;
      },
      async delete(_id) {
        return { success: true };
      },
      urlFor(id, _opts) {
        return `#mock-attachment-${id}`;
      },
      async usage() {
        return { used_bytes: 0, max_bytes: 1_000_000_000, biggest_tasks: [] };
      },
      async search(_q) {
        return [];
      },
    },
    cleanup() {},
    setToken(token) {
      backend.lastToken = token;
      persistBackend(backend);
    },
  };
}
