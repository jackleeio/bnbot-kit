/**
 * Local task management — no backend dependency.
 * Two fixed tasks: Auto Reply & Handle Notification.
 * All state stored in chrome.storage.local.
 */

export interface LocalTask {
  id: string;
  task_type: 'auto_reply' | 'handle_notification';
  name: string;
  status: 'active' | 'paused';
  frequency: string;
  execution_time: string;
  last_execution_at: string | null;
  execution_count: number;
}

export interface LocalExecution {
  id: string;
  task_id: string;
  status: 'completed' | 'failed' | 'running';
  started_at: string;
  completed_at: string | null;
  summary: string | null;
}

const STORAGE_KEY = 'localTasks';
const EXEC_KEY = 'localTaskExecutions';

const DEFAULT_TASKS: LocalTask[] = [
  {
    id: 'local-auto-reply',
    task_type: 'auto_reply',
    name: 'Auto Reply',
    status: 'paused',
    frequency: 'hourly',
    execution_time: '09:00',
    last_execution_at: null,
    execution_count: 0,
  },
  {
    id: 'local-handle-notification',
    task_type: 'handle_notification',
    name: 'Handle Notification',
    status: 'paused',
    frequency: 'daily',
    execution_time: '22:00',
    last_execution_at: null,
    execution_count: 0,
  },
];

class LocalTaskService {
  /** Get all tasks (always returns 2 fixed tasks). */
  async getTasks(): Promise<LocalTask[]> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    if (stored[STORAGE_KEY]) return stored[STORAGE_KEY];
    // First time: initialize defaults
    await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_TASKS });
    return DEFAULT_TASKS;
  }

  /** Get a single task by id. */
  async getTask(taskId: string): Promise<LocalTask | null> {
    const tasks = await this.getTasks();
    return tasks.find(t => t.id === taskId) || null;
  }

  /** Update a task's fields. */
  async updateTask(taskId: string, updates: Partial<LocalTask>): Promise<LocalTask | null> {
    const tasks = await this.getTasks();
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return null;
    tasks[idx] = { ...tasks[idx], ...updates };
    await chrome.storage.local.set({ [STORAGE_KEY]: tasks });
    return tasks[idx];
  }

  /** Pause a task. */
  async pause(taskId: string): Promise<LocalTask | null> {
    return this.updateTask(taskId, { status: 'paused' });
  }

  /** Resume a task. */
  async resume(taskId: string): Promise<LocalTask | null> {
    return this.updateTask(taskId, { status: 'active' });
  }

  /** Record an execution start. */
  async startExecution(taskId: string): Promise<LocalExecution> {
    const exec: LocalExecution = {
      id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      task_id: taskId,
      status: 'running',
      started_at: new Date().toISOString(),
      completed_at: null,
      summary: null,
    };
    const stored = await chrome.storage.local.get(EXEC_KEY);
    const execs: LocalExecution[] = stored[EXEC_KEY] || [];
    execs.unshift(exec);
    // Keep only last 50 executions per task
    const filtered = execs.filter(e => e.task_id === taskId).slice(0, 50);
    const others = execs.filter(e => e.task_id !== taskId);
    await chrome.storage.local.set({ [EXEC_KEY]: [...filtered, ...others] });
    return exec;
  }

  /** Complete an execution. */
  async completeExecution(
    execId: string,
    taskId: string,
    status: 'completed' | 'failed',
    summary?: string
  ): Promise<void> {
    const stored = await chrome.storage.local.get(EXEC_KEY);
    const execs: LocalExecution[] = stored[EXEC_KEY] || [];
    const idx = execs.findIndex(e => e.id === execId);
    if (idx !== -1) {
      execs[idx].status = status;
      execs[idx].completed_at = new Date().toISOString();
      execs[idx].summary = summary || null;
    }
    await chrome.storage.local.set({ [EXEC_KEY]: execs });

    // Update task stats
    const tasks = await this.getTasks();
    const taskIdx = tasks.findIndex(t => t.id === taskId);
    if (taskIdx !== -1) {
      tasks[taskIdx].last_execution_at = new Date().toISOString();
      tasks[taskIdx].execution_count += 1;
      await chrome.storage.local.set({ [STORAGE_KEY]: tasks });
    }
  }

  /** Get recent executions for a task. */
  async getExecutions(taskId: string, limit = 10): Promise<LocalExecution[]> {
    const stored = await chrome.storage.local.get(EXEC_KEY);
    const execs: LocalExecution[] = stored[EXEC_KEY] || [];
    return execs.filter(e => e.task_id === taskId).slice(0, limit);
  }
}

export const localTaskService = new LocalTaskService();
