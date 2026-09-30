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
  backend.state.attachments ||= [];
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

  // Files, as the server keeps them (backend/attachments.js): a deleted
  // task's are held — on no task, still counted — until a Task create
  // names it in restores_task_id, or it leaves Recently Deleted.
  const attachments = () => backend.state.attachments;
  const liveFiles = (taskId) => attachments().filter((a) => a.task_id === taskId && !a.task_deleted_at);
  const taskStore = createEntityStore("tasks", "taskCreates", "taskUpdates", "taskDeletes");
  const deletedTaskStore = createEntityStore("deletedTasks", "deletedTaskCreates", "deletedTaskUpdates", "deletedTaskDeletes");
  const idsOfDeletedTask = (record) => [record?.task_id, ...(record?.subtasks || []).map((s) => s?.id)].filter(Boolean).map(String);
  const Task = {
    ...taskStore,
    async create(data) {
      const { restores_task_id: restores, ...fields } = data;
      const created = await taskStore.create(fields);
      const held = attachments().filter((a) => a.task_deleted_at && restores && a.task_id === String(restores));
      if (!held.length) return created;
      held.forEach((a) => Object.assign(a, { task_id: created.id, task_deleted_at: null }));
      const stored = backend.state.tasks.find((t) => t.id === created.id);
      stored.attachment_count = liveFiles(created.id).length;
      persistBackend(backend);
      return clone(stored);
    },
    async delete(id) {
      const ids = [String(id), ...backend.state.tasks.filter((t) => String(t.parent_id) === String(id)).map((t) => String(t.id))];
      const now = new Date().toISOString();
      attachments().forEach((a) => {
        if (!a.task_deleted_at && ids.includes(a.task_id)) a.task_deleted_at = now;
      });
      return taskStore.delete(id);
    },
  };
  const DeletedTask = {
    ...deletedTaskStore,
    async delete(id) {
      const record = backend.state.deletedTasks.find((r) => String(r.id) === String(id));
      const result = await deletedTaskStore.delete(id);
      const stillThere = new Set(backend.state.deletedTasks.flatMap(idsOfDeletedTask));
      const gone = idsOfDeletedTask(record).filter((taskId) => !stillThere.has(taskId));
      backend.state.attachments = attachments().filter((a) => !(a.task_deleted_at && gone.includes(a.task_id)));
      persistBackend(backend);
      return result;
    },
  };

  return {
    entities: {
      Task,
      Priority: createEntityStore("priorities", null, null, null),
      DeletedTask,
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
    scheduleDefaults: {
      async get() {
        return clone(/** @type {any} */ (backend.state).scheduleDefaults || {});
      },
      async set(defaults) {
        const state = /** @type {any} */ (backend.state);
        state.scheduleDefaults = { ...defaults };
        persistBackend(backend);
        return clone(state.scheduleDefaults);
      },
      async getSimilarTasks() {
        return /** @type {any} */ (backend.state).scheduleSimilarTasks || "ask";
      },
      async setSimilarTasks(choice) {
        const state = /** @type {any} */ (backend.state);
        state.scheduleSimilarTasks = choice === "merge" || choice === "keep" ? choice : "ask";
        persistBackend(backend);
        return state.scheduleSimilarTasks;
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
      // E2E mock: no real file uploads happen here (the file pipeline is
      // covered by the backend tests). Files seeded into state.attachments
      // list on their task and count in storage, held and released the way
      // the server does it (Task and DeletedTask above).
      async list(taskId) {
        return clone(liveFiles(taskId));
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
        const lines = new Map();
        for (const file of attachments()) {
          const item = file.task_deleted_at
            ? backend.state.deletedTasks.find((r) => idsOfDeletedTask(r).includes(file.task_id))
            : null;
          const task = backend.state.tasks.find((t) => t.id === file.task_id);
          const key = item ? `deleted:${item.id}` : `task:${file.task_id}`;
          const line = lines.get(key) || {
            task_id: item ? item.task_id : file.task_id,
            task_title: (item ? item.title : task?.title) || "(deleted task)",
            total_bytes: 0,
            file_count: 0,
            in_recently_deleted: Boolean(item),
          };
          line.total_bytes += file.size_bytes || 0;
          line.file_count += 1;
          lines.set(key, line);
        }
        const biggest = [...lines.values()].sort((a, b) => b.total_bytes - a.total_bytes);
        return {
          used_bytes: biggest.reduce((sum, line) => sum + line.total_bytes, 0),
          max_bytes: 1_000_000_000,
          biggest_tasks: biggest.slice(0, 10),
        };
      },
      async search(_q) {
        return [];
      },
    },
    // AI connections, kept in the mock's state so e2e can walk the
    // Settings page: make a token, toggle changes, revoke, undo.
    // Test accounts have Plus unless a test sets state.billing (see e2e/notes.spec.ts).
    billing: {
      async status() {
        const state = /** @type {any} */ (backend.state);
        return clone(
          state.billing || {
            plan: "plus",
            source: "founding",
            since: "2026-09-30T00:00:00.000Z",
            limits: { storage_bytes: 1_000_000_000, active_schedules: null, calendar_sync: true, ai_apps: true },
            buy: { available: false, price: null },
          }
        );
      },
      async checkout() {
        return { url: "https://checkout.stripe.com/c/pay/cs_test_mock" };
      },
      // Back from Checkout: a session id starting cs_test_paid is one Stripe says was paid.
      async confirm(sessionId) {
        const state = /** @type {any} */ (backend.state);
        if (String(sessionId).startsWith("cs_test_paid")) {
          state.billing = {
            plan: "plus",
            source: "stripe",
            since: new Date().toISOString(),
            limits: { storage_bytes: 1_000_000_000, active_schedules: null, calendar_sync: true, ai_apps: true },
            buy: { available: false, price: null },
          };
          persistBackend(backend);
        }
        return clone(state.billing || {});
      },
    },
    sessions: {
      async list() {
        const state = /** @type {any} */ (backend.state);
        return clone(
          state.sessions || [
            { id: "session-here", device: "Chrome on Mac", ip_address: "127.0.0.1", signed_in_with: "google", signed_in_at: new Date().toISOString(), last_active_at: new Date().toISOString(), current: true },
          ]
        );
      },
      async signOut(id) {
        const state = /** @type {any} */ (backend.state);
        state.sessions = (state.sessions || []).filter((s) => s.id !== id);
        persistBackend(backend);
        return { success: true };
      },
      async signOutOthers() {
        const state = /** @type {any} */ (backend.state);
        const before = (state.sessions || []).length;
        state.sessions = (state.sessions || []).filter((s) => s.current);
        persistBackend(backend);
        return { signed_out: Math.max(0, before - state.sessions.length) };
      },
    },
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
