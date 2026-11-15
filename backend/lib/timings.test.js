// @ts-nocheck
/* @vitest-environment node */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createTimings, routeName } from "./timings.js";

function setup(how = {}) {
  const lines = [];
  let time = Date.parse("2026-11-15T10:00:00Z");
  const timings = createTimings({
    now: () => time,
    log: { info: (line) => lines.push(line), warn: (line) => lines.push(line) },
    ...how,
  });
  return { timings, lines, pass: (ms) => { time += ms; } };
}

describe("routeName", () => {
  it("takes out everything particular to a person or a record", () => {
    expect(routeName("get", "/api/apps/69b71a4b57ba76a74090fc6e/entities/Task")).toBe("GET /api/apps/:app/entities/Task");
    expect(routeName("PUT", "/api/apps/69b71a4b57ba76a74090fc6e/entities/Task/task_3f9a2c")).toBe("PUT /api/apps/:app/entities/Task/:id");
    expect(routeName("GET", "/api/apps/app/tasks/7c1e/attachments/att_91/file")).toBe("GET /api/apps/:app/tasks/:id/attachments/:id/file");
    expect(routeName("GET", "/api/apps/public/prod/public-settings/by-id/69b71a4b57ba76a74090fc6e")).toBe("GET /api/apps/public/prod/public-settings/by-id/:id");
  });

  it("never carries a query string", () => {
    expect(routeName("GET", "/api/apps/a1/entities/Task?q=dentist")).toBe("GET /api/apps/:app/entities/Task");
  });

  it("counts the app's own pages and files as one thing", () => {
    expect(routeName("GET", "/assets/index-abc123.js")).toBe("GET (app files)");
    expect(routeName("GET", "/Today")).toBe("GET (app files)");
    expect(routeName("GET", "/health")).toBe("GET /health");
    expect(routeName("GET", "/api/health")).toBe("GET /health");
  });
});

describe("timings", () => {
  it("says so at once when an answer is slow, and nothing when it isn't", () => {
    const { timings, lines } = setup();
    timings.record("GET", "/api/apps/a1/entities/Task", 12, 200);
    expect(lines).toEqual([]);
    timings.record("GET", "/api/apps/a1/entities/Task", 812.4, 200);
    expect(lines).toEqual(["[slow] 812 ms · GET /api/apps/:app/entities/Task · 200"]);
  });

  it("gives a file on its way ten times as long", () => {
    const { timings, lines } = setup();
    timings.record("POST", "/api/apps/a1/tasks/t1/attachments", 3000, 201);
    timings.record("GET", "/assets/index-abc.js", 900, 200);
    expect(lines).toEqual([]);
    timings.record("POST", "/api/apps/a1/tasks/t1/attachments", 6200, 201);
    expect(lines).toEqual(["[slow] 6.2 s · POST /api/apps/:app/tasks/:id/attachments · 201"]);
  });

  it("uses the limit it is given", () => {
    const { timings, lines } = setup({ slowMs: 50 });
    timings.record("GET", "/api/apps/a1/entities/Note", 60, 200);
    expect(lines).toHaveLength(1);
  });

  it("a storm of slow answers is said a few times, and counted in full", () => {
    const { timings, lines, pass } = setup();
    for (let i = 0; i < 100; i += 1) timings.record("GET", "/api/apps/a1/entities/Task", 700, 200);
    expect(lines).toHaveLength(21);
    expect(lines[20]).toContain("more slow answers this minute");
    expect(timings.summary()[0]).toContain("100 slow");
    // The next minute speaks again.
    pass(61_000);
    timings.record("GET", "/api/apps/a1/entities/Task", 700, 200);
    expect(lines).toHaveLength(22);
  });

  it("writes the hour's summary when the hour is up, then starts afresh", () => {
    const { timings, lines, pass } = setup();
    for (let i = 1; i <= 100; i += 1) timings.record("GET", "/api/apps/a1/entities/Task", i, 200);
    timings.record("PUT", "/api/apps/a1/entities/Task/task_1", 40, 500);
    timings.record("GET", "/health", 2, 200);
    expect(lines).toEqual([]);

    pass(60 * 60 * 1000);
    timings.record("GET", "/health", 3, 200);

    expect(lines[0]).toBe("[timings] last 60 min: 102 requests · half under 49 ms · 95% under 95 ms · slowest 100 ms · 0 slow · 1 failed");
    // The routes that took the most time in all, first.
    expect(lines[1]).toBe("[timings]   GET /api/apps/:app/entities/Task · 100× · 95% under 95 ms · slowest 100 ms");
    expect(lines[2]).toBe("[timings]   PUT /api/apps/:app/entities/Task/:id · 1× · 95% under 40 ms · slowest 40 ms");
    expect(lines).toHaveLength(4);
    // Only the request that came after is in the new hour.
    expect(timings.summary()[0]).toContain("1 request ·");
  });

  it("a quiet hour writes nothing", () => {
    const { timings, lines } = setup();
    timings.flush();
    expect(lines).toEqual([]);
  });

  it("keeps a bounded number of times however busy the hour", () => {
    const { timings } = setup();
    for (let i = 0; i < 5000; i += 1) timings.record("GET", "/api/apps/a1/entities/Task", 5, 200);
    expect(timings.summary()[0]).toContain("5000 requests · half under 5 ms");
  });

  it("times an answer from arriving to sent, and skips one nobody waited for", () => {
    const { timings } = setup();
    const answer = (finished) => {
      const response = Object.assign(new EventEmitter(), { writableFinished: finished, statusCode: 200 });
      timings.watch({ method: "GET", url: "/api/apps/a1/entities/Task?limit=5" }, response);
      response.emit("close");
    };
    answer(true);
    answer(false);
    const [total, route] = timings.summary();
    expect(total).toContain("1 request ·");
    expect(route).toContain("GET /api/apps/:app/entities/Task ·");
  });
});
