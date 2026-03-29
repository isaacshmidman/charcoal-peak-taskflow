describe("syncOfflineQueryCache", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem("taskflow_app_id", "test-app");
  });

  it("switches the in-memory query cache to the current scoped user cache", async () => {
    const { saveToCache } = await import("@/lib/offlineCache");

    localStorage.setItem(
      "taskflow_local_session",
      JSON.stringify({ id: "user-a", email: "a@example.com" })
    );
    saveToCache("tasks", [{ id: "task-a", title: "A task" }]);

    localStorage.setItem(
      "taskflow_local_session",
      JSON.stringify({ id: "user-b", email: "b@example.com" })
    );
    saveToCache("tasks", [{ id: "task-b", title: "B task" }]);

    const { queryClientInstance, syncOfflineQueryCache } = await import("./query-client");

    localStorage.setItem(
      "taskflow_local_session",
      JSON.stringify({ id: "user-a", email: "a@example.com" })
    );
    syncOfflineQueryCache();
    expect(queryClientInstance.getQueryData(["tasks"])).toEqual([{ id: "task-a", title: "A task" }]);

    localStorage.setItem(
      "taskflow_local_session",
      JSON.stringify({ id: "user-b", email: "b@example.com" })
    );
    syncOfflineQueryCache();
    expect(queryClientInstance.getQueryData(["tasks"])).toEqual([{ id: "task-b", title: "B task" }]);
  });
});
