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
  // Notes arrived after this mock; state saved by an older run won't have them.
  backend.state.notes ||= [];
  backend.state.deletedNotes ||= [];
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
      Note: createEntityStore("notes", null, null, null),
      DeletedNote: createEntityStore("deletedNotes", null, null, null),
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
    // AI connections, kept in the mock's state so e2e can walk the
    // Settings page: make a token, toggle changes, revoke, undo.
    ai: {
      async grants() {
        const state = /** @type {any} */ (backend.state);
        return { grants: clone((state.aiGrants || []).filter((g) => !g.revoked)), mcp_url: `${window.location.origin}/api/mcp` };
      },
      async createToken(input) {
        const state = /** @type {any} */ (backend.state);
        state.aiGrants = state.aiGrants || [];
        const grant = {
          id: `grant-${state.aiGrants.length + 1}`,
          kind: "token",
          label: String(input?.label || "").trim(),
          can_write: input?.can_write === true,
          time_zone: input?.time_zone || "UTC",
          created_date: new Date().toISOString(),
          last_used_at: null,
        };
        state.aiGrants.push(grant);
        persistBackend(backend);
        return { grant: clone(grant), token: `zeph_pat_e2e${state.aiGrants.length}`, mcp_url: `${window.location.origin}/api/mcp` };
      },
      async setCanWrite(id, canWrite) {
        const state = /** @type {any} */ (backend.state);
        const grant = (state.aiGrants || []).find((g) => g.id === id);
        if (grant) grant.can_write = canWrite;
        persistBackend(backend);
        return clone(grant);
      },
      async revoke(id) {
        const state = /** @type {any} */ (backend.state);
        const grant = (state.aiGrants || []).find((g) => g.id === id);
        if (grant) grant.revoked = true;
        persistBackend(backend);
        return { success: true };
      },
      async activity() {
        const state = /** @type {any} */ (backend.state);
        return clone(state.aiActivity || []);
      },
      async undo(id) {
        const state = /** @type {any} */ (backend.state);
        const entry = (state.aiActivity || []).find((a) => a.id === id);
        if (entry) entry.undo = "undone";
        persistBackend(backend);
        return clone(entry);
      },
      // Consent for an AI app signing in: state.aiConnectRequests[id] =
      // { client_name, redirect_uri, wants_changes, state }.
      async connectRequest(id) {
        const request = (/** @type {any} */ (backend.state).aiConnectRequests || {})[id];
        if (!request) {
          const error = new Error("This sign-in has expired or was already used. Start again from the app.");
          /** @type {any} */ (error).status = 404;
          throw error;
        }
        return { client_name: request.client_name, redirect_host: new URL(request.redirect_uri).host, wants_changes: Boolean(request.wants_changes) };
      },
      async decide(id, input) {
        const state = /** @type {any} */ (backend.state);
        const request = (state.aiConnectRequests || {})[id];
        const back = new URL(request.redirect_uri);
        // The mock's code says what was granted, so a test can read it off the URL.
        if (input?.approve) back.searchParams.set("code", input.can_write ? "e2e-code-changes" : "e2e-code-read");
        else back.searchParams.set("error", "access_denied");
        back.searchParams.set("state", request.state || "");
        state.lastAiDecision = { id, ...input };
        delete state.aiConnectRequests[id];
        persistBackend(backend);
        return { redirect_to: back.toString() };
      },
    },
    cleanup() {},
    setToken(token) {
      backend.lastToken = token;
      persistBackend(backend);
    },
  };
}
