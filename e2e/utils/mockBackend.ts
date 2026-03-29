import type { Page } from "@playwright/test";

type EntityRecord = Record<string, any>;
const STORAGE_KEY = "__taskflow_e2e_backend__";

export interface MockState {
  tasks?: EntityRecord[];
  priorities?: EntityRecord[];
  deletedTasks?: EntityRecord[];
  savedTags?: EntityRecord[];
  currentUser?: EntityRecord | null;
}

export interface MockController {
  getState: () => Promise<{
    tasks: EntityRecord[];
    priorities: EntityRecord[];
    deletedTasks: EntityRecord[];
    savedTags: EntityRecord[];
    currentUser: EntityRecord | null;
  }>;
  getMeta: () => Promise<{
    lastLoginProvider: string | null;
    lastLoginFromUrl: string | null;
    lastRedirectToLogin: string | boolean | null;
    lastLogout: string | boolean | null;
    lastToken: string | null;
  }>;
  getCounters: () => Promise<{
    taskCreates: number;
    taskUpdates: number;
    taskDeletes: number;
    deletedTaskCreates: number;
    deletedTaskUpdates: number;
    deletedTaskDeletes: number;
    savedTagCreates: number;
  }>;
}

export async function installMockBackend(page: Page, initialState: MockState = {}): Promise<MockController> {
  await page.route("**/api/apps/*/analytics/**", async (route) => {
    await route.fulfill({
      status: 204,
      contentType: "application/json",
      body: "{}",
    });
  });

  await page.addInitScript(({ state, storageKey }) => {
    const defaultUser = {
      id: "mock-user",
      email: "demo@example.com",
      role: "user",
    };

    const stored = window.localStorage.getItem(storageKey);
    const backend = stored
      ? JSON.parse(stored)
      : {
          publicSettings: {
            id: "public-settings",
            name: "Taskflow E2E",
            app_id: "e2e-app",
          },
          state: {
            tasks: state.tasks ?? [],
            priorities: state.priorities ?? [],
            deletedTasks: state.deletedTasks ?? [],
            savedTags: state.savedTags ?? [],
            currentUser: state.currentUser === undefined ? defaultUser : state.currentUser,
          },
          counters: {
            taskCreates: 0,
            taskUpdates: 0,
            taskDeletes: 0,
            deletedTaskCreates: 0,
            deletedTaskUpdates: 0,
            deletedTaskDeletes: 0,
            savedTagCreates: 0,
          },
        };

    window.__TASKFLOW_E2E_BACKEND__ = backend;
    window.localStorage.setItem(storageKey, JSON.stringify(backend));
  }, { state: initialState, storageKey: STORAGE_KEY });

  return {
    getState: () =>
      page.evaluate(() => ({
        ...window.__TASKFLOW_E2E_BACKEND__.state,
      })),
    getMeta: () =>
      page.evaluate(() => ({
        lastLoginProvider: window.__TASKFLOW_E2E_BACKEND__.lastLoginProvider ?? null,
        lastLoginFromUrl: window.__TASKFLOW_E2E_BACKEND__.lastLoginFromUrl ?? null,
        lastRedirectToLogin: window.__TASKFLOW_E2E_BACKEND__.lastRedirectToLogin ?? null,
        lastLogout: window.__TASKFLOW_E2E_BACKEND__.lastLogout ?? null,
        lastToken: window.__TASKFLOW_E2E_BACKEND__.lastToken ?? null,
      })),
    getCounters: () =>
      page.evaluate(() => ({
        ...window.__TASKFLOW_E2E_BACKEND__.counters,
      })),
  };
}
