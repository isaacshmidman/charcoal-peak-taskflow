export type TaskStatus = "todo" | "done" | string;
export type TaskType = "one_time" | "recurring" | string;
export type RecurrenceType =
  | "none"
  | "daily"
  | "weekdays"
  | "custom_days"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | string;

export interface TaskRecord {
  id?: string;
  parent_id?: string;
  title?: string;
  description?: string;
  priority_id?: string;
  status?: TaskStatus;
  task_type?: TaskType;
  recurrence?: RecurrenceType;
  recurrence_days?: number[];
  recurrence_end_date?: string;
  due_date?: string;
  task_time?: string;
  task_end_time?: string;
  tags?: string[];
  completed_at?: string;
  order?: number | null;
  created_date?: string;
  updated_date?: string;
}

export interface DeletedTaskSubtaskSnapshot {
  id?: string;
  title: string;
  status?: TaskStatus;
  due_date?: string;
  task_time?: string;
  completed_at?: string;
}

export interface DeletedTaskRecord {
  id?: string;
  task_id: string;
  title: string;
  description?: string;
  priority_id?: string;
  priority_color?: string;
  status?: TaskStatus;
  task_type?: TaskType;
  recurrence?: RecurrenceType;
  recurrence_days?: number[];
  recurrence_end_date?: string;
  due_date?: string;
  task_time?: string;
  tags?: string[];
  completed_at?: string;
  deleted_at: string;
  expires_at: string;
  was_completed: boolean;
  subtasks: DeletedTaskSubtaskSnapshot[];
}

export interface TaskCreateInput extends Omit<TaskRecord, "id" | "created_date" | "updated_date"> {
  title: string;
}

export interface DeleteSnapshot {
  task?: TaskRecord | null;
  subtasks?: TaskRecord[];
  deletedRecordId?: string | null;
}

export interface FilterState {
  search: string;
  priority: string;
  taskType: string;
  sort: string;
}

export interface PriorityOption {
  id: string;
  name: string;
  color?: string;
  level?: number;
}

export interface SortOption {
  value: string;
  label: string;
  group?: string;
}
