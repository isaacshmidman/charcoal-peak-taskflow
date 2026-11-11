describe("apiClient offline fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
    localStorage.setItem("taskflow_app_id", "test-app");
    localStorage.setItem(
      "taskflow_local_session",
      JSON.stringify({ id: "user-1", email: "isaac@example.com" })
    );
  });

  it("returns cached entity lists when the network request fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network down"));
    vi.stubGlobal("fetch", fetchMock);

    const { saveToCache } = await import("@/lib/offlineCache");
    saveToCache("tasks", [{ id: "task-1", title: "Cached task" }]);

    const { apiClient } = await import("./apiClient");
    const tasks = await apiClient.entities.Task.list("-created_date", 500);

    expect(tasks).toEqual([{ id: "task-1", title: "Cached task" }]);
  });

  it("returns cached public settings when offline", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network down"));
    vi.stubGlobal("fetch", fetchMock);

    const { saveToCache } = await import("@/lib/offlineCache");
    saveToCache("publicSettings", { app_id: "test-app", name: "Taskflow Offline" });

    const { apiClient } = await import("./apiClient");
    const publicSettings = await apiClient.getPublicSettings();

    expect(publicSettings).toEqual({ app_id: "test-app", name: "Taskflow Offline" });
  });

  it("returns cached integrations when offline", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network down"));
    vi.stubGlobal("fetch", fetchMock);

    const { saveToCache } = await import("@/lib/offlineCache");
    saveToCache("integrations", [{ id: "int-1", provider: "google", status: "active" }]);

    const { apiClient } = await import("./apiClient");
    const integrations = await apiClient.integrations.list();

    expect(integrations).toEqual([{ id: "int-1", provider: "google", status: "active" }]);
  });

  it("returns cached integration calendars when offline", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network down"));
    vi.stubGlobal("fetch", fetchMock);

    const { saveToCache } = await import("@/lib/offlineCache");
    saveToCache("integrationCalendars", {
      "int-1": [{ external_calendar_id: "cal-1", summary: "Cached calendar" }],
    });

    const { apiClient } = await import("./apiClient");
    const calendars = await apiClient.integrations.listCalendars("int-1");

    expect(calendars).toEqual([{ external_calendar_id: "cal-1", summary: "Cached calendar" }]);
  });

  it("returns cached notification settings when offline", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network down"));
    vi.stubGlobal("fetch", fetchMock);

    const { saveToCache } = await import("@/lib/offlineCache");
    saveToCache("notificationSettings", {
      available: true,
      vapidPublicKey: "public-key",
      settings: { enabled: true, allDayTime: "9:00AM" },
      defaulted: false,
    });

    const { apiClient } = await import("./apiClient");
    const settings = await apiClient.notifications.getSettings();

    expect(settings).toEqual({
      available: true,
      vapidPublicKey: "public-key",
      settings: { enabled: true, allDayTime: "9:00AM" },
      defaulted: false,
    });
  });
});

describe("apiClient: an answer that hasn't changed", () => {
  const TASKS = [{ id: "task-1", title: "One" }];
  /** A fetch answer: JSON with an ETag, or a bodiless 304. */
  const answer = (body, etag) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...(etag ? { ETag: etag } : {}) } });
  const notModified = (etag) => new Response(null, { status: 304, headers: { ETag: etag } });
  const sentHeaders = (fetchMock, call) => fetchMock.mock.calls[call][1].headers;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
    localStorage.setItem("taskflow_app_id", "test-app");
    localStorage.setItem("taskflow_local_session", JSON.stringify({ id: "user-1", email: "isaac@example.com" }));
  });

  it("asks \"has it changed?\" the second time, and hands back the very same list when it hasn't", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(answer(TASKS, 'W/"v1"'))
      .mockResolvedValueOnce(notModified('W/"v1"'))
      .mockResolvedValueOnce(answer([...TASKS, { id: "task-2", title: "Two" }], 'W/"v2"'))
      .mockResolvedValueOnce(notModified('W/"v2"'));
    vi.stubGlobal("fetch", fetchMock);
    const { apiClient } = await import("./apiClient");

    const first = await apiClient.entities.Task.list("-created_date", 5000);
    expect(first).toEqual(TASKS);
    expect(sentHeaders(fetchMock, 0)["If-None-Match"]).toBeUndefined();

    const second = await apiClient.entities.Task.list("-created_date", 5000);
    expect(sentHeaders(fetchMock, 1)["If-None-Match"]).toBe('W/"v1"');
    // Not an equal list: the same one, so nothing downstream sees a change.
    expect(second).toBe(first);

    const third = await apiClient.entities.Task.list("-created_date", 5000);
    expect(third).toHaveLength(2);
    const fourth = await apiClient.entities.Task.list("-created_date", 5000);
    expect(sentHeaders(fetchMock, 3)["If-None-Match"]).toBe('W/"v2"');
    expect(fourth).toBe(third);
  });

  it("keeps answers apart by address, and only for reads", async () => {
    const fetchMock = vi.fn(async () => answer(TASKS, 'W/"v1"'));
    vi.stubGlobal("fetch", fetchMock);
    const { apiClient } = await import("./apiClient");

    await apiClient.entities.Task.list("-created_date", 5000);
    await apiClient.entities.Task.list("-created_date", 100);
    expect(sentHeaders(fetchMock, 1)["If-None-Match"]).toBeUndefined();
    await apiClient.entities.Task.create({ title: "New" });
    expect(sentHeaders(fetchMock, 2)["If-None-Match"]).toBeUndefined();
    await apiClient.entities.Task.update("task-1", { title: "Renamed" });
    expect(sentHeaders(fetchMock, 3)["If-None-Match"]).toBeUndefined();
  });

  it("forgets every answer when the person signing in changes", async () => {
    const fetchMock = vi.fn(async () => answer(TASKS, 'W/"v1"'));
    vi.stubGlobal("fetch", fetchMock);
    const { apiClient } = await import("./apiClient");

    await apiClient.entities.Task.list("-created_date", 5000);
    apiClient.setToken("someone-else", false);
    await apiClient.entities.Task.list("-created_date", 5000);
    expect(sentHeaders(fetchMock, 1)["If-None-Match"]).toBeUndefined();
  });

  it("an answer with no fingerprint is never reused", async () => {
    const fetchMock = vi.fn(async () => answer(TASKS));
    vi.stubGlobal("fetch", fetchMock);
    const { apiClient } = await import("./apiClient");

    const first = await apiClient.entities.Task.list("-created_date", 5000);
    const second = await apiClient.entities.Task.list("-created_date", 5000);
    expect(sentHeaders(fetchMock, 1)["If-None-Match"]).toBeUndefined();
    expect(second).not.toBe(first);
  });

  it("a create carries its name, so the server can tell a retry from a second task", async () => {
    const fetchMock = vi.fn(async () => answer({ id: "task-9" }));
    vi.stubGlobal("fetch", fetchMock);
    const { apiClient } = await import("./apiClient");

    await apiClient.entities.Task.create({ title: "Named" }, { createKey: "offline_1_abc" });
    expect(sentHeaders(fetchMock, 0)["Idempotency-Key"]).toBe("offline_1_abc");
    await apiClient.entities.Task.create({ title: "Unnamed" });
    expect(sentHeaders(fetchMock, 1)["Idempotency-Key"]).toBeUndefined();
  });
});
