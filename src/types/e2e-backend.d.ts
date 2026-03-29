export {};

declare global {
  interface Window {
    __TASKFLOW_E2E_BACKEND__?: {
      publicSettings?: Record<string, any>;
      state: {
        tasks: Record<string, any>[];
        priorities: Record<string, any>[];
        deletedTasks: Record<string, any>[];
        savedTags: Record<string, any>[];
        currentUser: Record<string, any> | null;
      };
      counters: {
        taskCreates: number;
        taskUpdates: number;
        taskDeletes: number;
        deletedTaskCreates: number;
        deletedTaskUpdates: number;
        deletedTaskDeletes: number;
        savedTagCreates: number;
      };
      lastRedirectToLogin?: string | boolean;
      lastLogout?: string | boolean;
      lastToken?: string;
    };
  }
}
