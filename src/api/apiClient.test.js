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
