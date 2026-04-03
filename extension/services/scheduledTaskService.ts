/**
 * Scheduled Task Service - API calls for scheduled tasks
 */

import { authService } from './authService';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';

// Helper function for authenticated API requests
async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}/api/v1${endpoint}`;

  console.log('[ScheduledTaskService] API request:', url, options.method || 'GET');

  const response = await authService.fetchWithAuth(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  console.log('[ScheduledTaskService] API response status:', response.status);

  if (!response.ok) {
    let errorMessage = `HTTP error! status: ${response.status}`;
    try {
      const errorData = await response.json();
      console.error('[ScheduledTaskService] API error:', errorData);
      if (errorData && errorData.detail) {
        errorMessage = typeof errorData.detail === 'string'
          ? errorData.detail
          : JSON.stringify(errorData.detail);
      }
    } catch {
      // JSON parsing failed, use default error message
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  console.log('[ScheduledTaskService] API response data:', data);
  return data;
}

// Enums matching backend
export enum TaskFrequency {
  ONCE = 'once',
  HOURLY = 'hourly',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  YEARLY = 'yearly'
}

export enum TaskType {
  AUTO_REPLY = 'auto_reply',
  CUSTOM_TASK = 'custom_task',
  FOLLOW_DIGEST = 'follow_digest',
  GENERATE_TWEET = 'generate_tweet',
  HANDLE_NOTIFICATION = 'handle_notification'
}

export enum TaskStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export enum ExecutionStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed'
}

export enum NotificationType {
  EMAIL_ONLY = 'email_only',
  TELEGRAM_ONLY = 'telegram_only',
  BOTH = 'both',
  NONE = 'none'
}

// Types
export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  task_type: TaskType;
  graph_name: string;
  frequency: TaskFrequency;
  execution_time: string; // "HH:MM"
  interval_hours: number | null; // 每N小时执行一次 (HOURLY)
  day_of_week: number | null; // 0-6, Monday=0
  day_of_month: number | null; // 1-31
  month_of_year: number | null; // 1-12
  timezone: string;
  notification_type: NotificationType;
  agent_id: string | null;
  status: TaskStatus;
  next_execution_at: string | null;
  last_execution_at: string | null;
  execution_count: number;
  created_at: string;
  updated_at: string;
}

export interface TaskExecution {
  id: string;
  task_id: string;
  status: ExecutionStatus;
  started_at: string | null;
  completed_at: string | null;
  result: Record<string, any> | null;
  error_message: string | null;
  credits_used: number;
  created_at: string;
}

export interface TaskQuota {
  subscription_tier: string;
  max_tasks: number;
  used_tasks: number;
  remaining_tasks: number;
}

export interface ScheduledTaskCreate {
  name: string;
  prompt: string;
  task_type: TaskType;
  graph_name?: string;
  frequency: TaskFrequency;
  execution_time: string;
  interval_hours?: number;  // 每N小时执行一次 (HOURLY 时必填)
  day_of_week?: number;
  day_of_month?: number;
  month_of_year?: number;
  timezone?: string;
  notification_type?: NotificationType;
  agent_id?: string;
}

export interface ScheduledTaskUpdate {
  name?: string;
  prompt?: string;
  frequency?: TaskFrequency;
  execution_time?: string;
  day_of_week?: number;
  day_of_month?: number;
  month_of_year?: number;
  timezone?: string;
  notification_type?: NotificationType;
  agent_id?: string;
}

export interface ScheduledTasksListResponse {
  data: ScheduledTask[];
  count: number;
}

export interface TaskExecutionsListResponse {
  data: TaskExecution[];
  count: number;
}

// Task type icons mapping
export const TASK_TYPE_ICONS: Record<TaskType, string> = {
  [TaskType.AUTO_REPLY]: '💬',
  [TaskType.CUSTOM_TASK]: '⚡',
  [TaskType.FOLLOW_DIGEST]: '👥',
  [TaskType.GENERATE_TWEET]: '🤖',
  [TaskType.HANDLE_NOTIFICATION]: '🔔'
};

// Task type labels
export const TASK_TYPE_LABELS: Record<TaskType, { en: string; zh: string }> = {
  [TaskType.AUTO_REPLY]: { en: 'Auto Reply', zh: '自动回复' },
  [TaskType.CUSTOM_TASK]: { en: 'Custom Task', zh: '自定义任务' },
  [TaskType.FOLLOW_DIGEST]: { en: 'Follow Digest', zh: '关注摘要' },
  [TaskType.GENERATE_TWEET]: { en: 'Generate Tweet', zh: '生成推文' },
  [TaskType.HANDLE_NOTIFICATION]: { en: 'Handle Notification', zh: '处理通知' }
};

// Frequency labels
export const FREQUENCY_LABELS: Record<TaskFrequency, { en: string; zh: string }> = {
  [TaskFrequency.ONCE]: { en: 'Once', zh: '一次' },
  [TaskFrequency.HOURLY]: { en: 'Hourly', zh: '每小时' },
  [TaskFrequency.DAILY]: { en: 'Daily', zh: '每天' },
  [TaskFrequency.WEEKLY]: { en: 'Weekly', zh: '每周' },
  [TaskFrequency.MONTHLY]: { en: 'Monthly', zh: '每月' },
  [TaskFrequency.YEARLY]: { en: 'Yearly', zh: '每年' }
};

// Day of week labels
export const DAY_OF_WEEK_LABELS = {
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  zh: ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
};

class ScheduledTaskService {
  private baseUrl = '/scheduled-tasks';

  /**
   * Get list of scheduled tasks
   */
  async listTasks(params?: {
    skip?: number;
    limit?: number;
    status?: TaskStatus;
  }): Promise<ScheduledTasksListResponse> {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.set('skip', String(params.skip));
    if (params?.limit !== undefined) queryParams.set('limit', String(params.limit));
    if (params?.status) queryParams.set('status', params.status);

    const url = queryParams.toString()
      ? `${this.baseUrl}/?${queryParams.toString()}`
      : `${this.baseUrl}/`;

    return apiRequest<ScheduledTasksListResponse>(url, { method: 'GET' });
  }

  /**
   * Get a single task by ID
   */
  async getTask(taskId: string): Promise<ScheduledTask> {
    return apiRequest<ScheduledTask>(`${this.baseUrl}/${taskId}`, { method: 'GET' });
  }

  /**
   * Create a new scheduled task
   */
  async createTask(task: ScheduledTaskCreate): Promise<ScheduledTask> {
    return apiRequest<ScheduledTask>(`${this.baseUrl}/`, {
      method: 'POST',
      body: JSON.stringify(task)
    });
  }

  /**
   * Update a scheduled task
   */
  async updateTask(taskId: string, update: ScheduledTaskUpdate): Promise<ScheduledTask> {
    return apiRequest<ScheduledTask>(`${this.baseUrl}/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(update)
    });
  }

  /**
   * Delete a scheduled task
   */
  async deleteTask(taskId: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`${this.baseUrl}/${taskId}`, {
      method: 'DELETE'
    });
  }

  /**
   * Pause a task
   */
  async pauseTask(taskId: string): Promise<ScheduledTask> {
    return apiRequest<ScheduledTask>(`${this.baseUrl}/${taskId}/pause`, {
      method: 'POST'
    });
  }

  /**
   * Resume a paused task
   */
  async resumeTask(taskId: string): Promise<ScheduledTask> {
    return apiRequest<ScheduledTask>(`${this.baseUrl}/${taskId}/resume`, {
      method: 'POST'
    });
  }

  /**
   * Execute a task immediately (for backend-only tasks)
   */
  async executeTask(taskId: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`${this.baseUrl}/${taskId}/execute`, {
      method: 'POST'
    });
  }

  /**
   * Start a task execution (creates RUNNING execution record)
   * Used for frontend-executed tasks like AUTO_REPLY
   */
  async startExecution(taskId: string): Promise<{ execution_id: string }> {
    return apiRequest<{ execution_id: string }>(`${this.baseUrl}/${taskId}/start-execution`, {
      method: 'POST'
    });
  }

  /**
   * Complete a task execution (updates execution record with result)
   * Used for frontend-executed tasks like AUTO_REPLY
   */
  async completeExecution(
    taskId: string,
    executionId: string,
    result: {
      status: 'success' | 'failed';
      result?: Record<string, any>;
      error_message?: string;
    }
  ): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`${this.baseUrl}/${taskId}/complete-execution`, {
      method: 'POST',
      body: JSON.stringify({
        execution_id: executionId,
        ...result
      })
    });
  }

  /**
   * Get task execution history
   */
  async getExecutions(
    taskId: string,
    params?: { skip?: number; limit?: number }
  ): Promise<TaskExecutionsListResponse> {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.set('skip', String(params.skip));
    if (params?.limit !== undefined) queryParams.set('limit', String(params.limit));

    const url = queryParams.toString()
      ? `${this.baseUrl}/${taskId}/executions?${queryParams.toString()}`
      : `${this.baseUrl}/${taskId}/executions`;

    return apiRequest<TaskExecutionsListResponse>(url, { method: 'GET' });
  }

  /**
   * Get task quota info
   */
  async getQuota(): Promise<TaskQuota> {
    return apiRequest<TaskQuota>(`${this.baseUrl}/stats/quota`, { method: 'GET' });
  }

  /**
   * Ensure default singleton tasks exist (created as paused).
   * Returns any newly created tasks.
   */
  async ensureDefaultTasks(existingTypes: TaskType[]): Promise<ScheduledTask[]> {
    const defaults: { type: TaskType; name: string; frequency: TaskFrequency; execution_time: string; interval_hours?: number }[] = [
      { type: TaskType.AUTO_REPLY, name: 'Auto Reply', frequency: TaskFrequency.HOURLY, execution_time: '09:00', interval_hours: 2 },
      { type: TaskType.HANDLE_NOTIFICATION, name: 'Handle Notification', frequency: TaskFrequency.DAILY, execution_time: '22:00' },
    ];

    const missing = defaults.filter(d => !existingTypes.includes(d.type));
    const created: ScheduledTask[] = [];

    for (const d of missing) {
      try {
        const task = await this.createTask({
          name: d.name,
          prompt: '',
          task_type: d.type,
          frequency: d.frequency,
          execution_time: d.execution_time,
          interval_hours: d.interval_hours,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        // Immediately pause — default tasks start inactive
        const paused = await this.pauseTask(task.id);
        created.push(paused);
      } catch (err) {
        console.error(`[ScheduledTaskService] Failed to create default task ${d.type}:`, err);
      }
    }

    return created;
  }

  /**
   * Notify background to sync a task's alarm (after create/resume/update).
   */
  async notifyAlarmSync(taskId: string): Promise<void> {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'TASK_ALARM_SYNC', taskId }, () => resolve());
    });
  }

  /**
   * Notify background to remove a task's alarm (after pause/delete).
   */
  async notifyAlarmRemove(taskId: string): Promise<void> {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'TASK_ALARM_REMOVE', taskId }, () => resolve());
    });
  }
}

export const scheduledTaskService = new ScheduledTaskService();
