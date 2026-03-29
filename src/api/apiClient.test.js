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
});
