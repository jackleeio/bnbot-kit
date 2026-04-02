/**
 * Task Alarm Scheduler
 * Runs in the background service worker.
 * Uses chrome.alarms to schedule periodic task executions locally,
 * eliminating the need for backend Celery Beat + WebSocket triggers.
 */

import { computeNextExecutionTime } from '../utils/taskAlarmTimeCalculator';

const TASK_ALARM_PREFIX = 'task:';
const DRAFT_ALARM_PREFIX = 'draft:';
const SYNC_ALARM_NAME = 'sync:tasks';
const SYNC_INTERVAL_MINUTES = 30;
const STORAGE_KEY = 'cached_scheduled_tasks';
const DRAFT_STORAGE_KEY = 'cached_scheduled_drafts';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';
const EXECUTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (default)
const LONG_EXECUTION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes (for long-running tasks)
const LONG_RUNNING_TASK_TYPES = new Set(['auto_reply', 'handle_notification']);

// Track pending executions for timeout handling
const pendingExecutions = new Map<string, { taskId: string; executionId: string; timer: ReturnType<typeof setTimeout> }>();

interface CachedTask {
  id: string;
  name: string;
  task_type: string;
  frequency: string;
  execution_time: string;
  interval_hours: number | null;
  day_of_week: number | null;
  day_of_month: number | null;
  month_of_year: number | null;
  timezone: string;
  next_execution_at: string | null;
  status: string;
  notification_type?: string;
}

interface CachedDraft {
  id: string;
  draft_type: 'tweet' | 'thread' | 'article';
  content: any;
  scheduled_at: string;
  publish_status: string;
}

// ===================== Public API =====================

/**
 * Initialize the alarm scheduler: register listeners + start sync.
 * Call once from background.ts on startup.
 */
export function initTaskAlarmScheduler(): void {
  // Register alarm listener (wrap async handler to catch errors)
  chrome.alarms.onAlarm.addListener((alarm) => {
    console.log(`[TaskAlarmScheduler] onAlarm fired: ${alarm.name}`);
    handleAlarm(alarm).catch(err => {
      console.error('[TaskAlarmScheduler] handleAlarm error:', err);
    });
  });

  // Create the periodic sync alarm (survives SW restarts)
  chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: SYNC_INTERVAL_MINUTES });

  // Run initial sync after a short delay (allow SW to finish init)
  setTimeout(() => {
    syncTaskAlarms().catch(err => {
      console.error('[TaskAlarmScheduler] Initial sync failed:', err);
    });
  }, 3000);

  console.log('[TaskAlarmScheduler] Initialized');
}

/**
 * Sync all task alarms with the backend.
 * Pulls active tasks → compares with existing alarms → creates/removes as needed.
 */
export async function syncTaskAlarms(): Promise<void> {
  const token = await getAccessToken();
  if (!token) {
    console.log('[TaskAlarmScheduler] No token, skipping sync');
    return;
  }

  try {
    const response = await bgFetchWithAuth(`${API_BASE_URL}/api/v1/scheduled-tasks/?status=active`);
    if (!response.ok) {
      console.error('[TaskAlarmScheduler] Failed to fetch tasks:', response.status);
      return;
    }

    const { data: tasks } = await response.json() as { data: CachedTask[] };
    console.log(`[TaskAlarmScheduler] Fetched ${tasks.length} active tasks`);

    // Cache tasks to storage
    await chrome.storage.local.set({ [STORAGE_KEY]: tasks });

    // Get existing task alarms
    const allAlarms = await chrome.alarms.getAll();
    const existingTaskAlarms = new Map<string, chrome.alarms.Alarm>();
    for (const alarm of allAlarms) {
      if (alarm.name.startsWith(TASK_ALARM_PREFIX)) {
        existingTaskAlarms.set(alarm.name, alarm);
      }
    }

    // Build desired alarm set
    const desiredAlarms = new Set<string>();

    for (const task of tasks) {
      const alarmName = `${TASK_ALARM_PREFIX}${task.id}`;
      desiredAlarms.add(alarmName);

      const nextTime = computeNextExecutionTime(task);
      if (nextTime === null) {
        // Task shouldn't be scheduled (e.g., expired 'once' task)
        continue;
      }

      const existing = existingTaskAlarms.get(alarmName);
      if (existing && Math.abs(existing.scheduledTime - nextTime) < 60_000) {
        // Alarm exists and is close enough — no change needed
        continue;
      }

      // Create or update alarm
      chrome.alarms.create(alarmName, { when: nextTime });
      console.log(`[TaskAlarmScheduler] Scheduled alarm ${alarmName} at ${new Date(nextTime).toISOString()}`);
    }

    // Remove alarms for tasks no longer active
    for (const [alarmName] of existingTaskAlarms) {
      if (!desiredAlarms.has(alarmName)) {
        await chrome.alarms.clear(alarmName);
        console.log(`[TaskAlarmScheduler] Removed stale alarm ${alarmName}`);
      }
    }

    console.log('[TaskAlarmScheduler] Task sync complete');

    // Clean up stale RUNNING executions (older than 10 minutes)
    await cleanupStaleExecutions(tasks);
  } catch (err) {
    console.error('[TaskAlarmScheduler] Sync error:', err);
  }

  // Also sync draft alarms in the same cycle
  await syncDraftAlarms();
}

/**
 * Sync a single task's alarm (called after UI creates/modifies a task).
 */
export async function syncSingleTaskAlarm(taskId: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) return;

  try {
    const response = await bgFetchWithAuth(`${API_BASE_URL}/api/v1/scheduled-tasks/${taskId}`);
    if (!response.ok) {
      console.error(`[TaskAlarmScheduler] Failed to fetch task ${taskId}:`, response.status);
      return;
    }

    const task = await response.json() as CachedTask;
    const alarmName = `${TASK_ALARM_PREFIX}${taskId}`;

    // Update cache
    await updateTaskInCache(task);

    if (task.status !== 'active') {
      await chrome.alarms.clear(alarmName);
      console.log(`[TaskAlarmScheduler] Cleared alarm for non-active task ${taskId}`);
      return;
    }

    // Ignore backend's next_execution_at — compute fresh from schedule config.
    // This is called after UI creates/modifies a task, so the backend's
    // next_execution_at may still reflect the OLD schedule.
    const nextTime = computeNextExecutionTime({
      ...task,
      next_execution_at: null,
    });
    if (nextTime === null) {
      await chrome.alarms.clear(alarmName);
      return;
    }

    // Clear dedup guard so the new schedule's first execution isn't blocked
    // by timestamps from previous (possibly failed/repeated) executions
    await chrome.storage.local.remove(`last_exec_${taskId}`);

    // If today's scheduled time has already passed (next computed time is far away),
    // schedule a catch-up execution soon so the user sees it work today.
    // After catch-up, scheduleNextAlarm will set the regular next-day alarm.
    const now = Date.now();
    const CATCH_UP_DELAY = 30_000; // 30 seconds
    let effectiveTime = nextTime;
    if (nextTime - now > 3600_000) { // Next time > 1 hour away → today's time missed
      effectiveTime = now + CATCH_UP_DELAY;
      console.log(`[TaskAlarmScheduler] Today's time passed for ${taskId}, catch-up in 30s (next regular: ${new Date(nextTime).toISOString()})`);
    }

    chrome.alarms.create(alarmName, { when: effectiveTime });
    console.log(`[TaskAlarmScheduler] Scheduled alarm ${alarmName} at ${new Date(effectiveTime).toISOString()}`);
  } catch (err) {
    console.error(`[TaskAlarmScheduler] syncSingleTaskAlarm error:`, err);
  }
}

/**
 * Remove a task's alarm (called after UI pauses/deletes a task).
 */
export async function removeTaskAlarm(taskId: string): Promise<void> {
  const alarmName = `${TASK_ALARM_PREFIX}${taskId}`;
  await chrome.alarms.clear(alarmName);
  await removeTaskFromCache(taskId);
  console.log(`[TaskAlarmScheduler] Removed alarm ${alarmName}`);
}

// ===================== Alarm Handler =====================

async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name === SYNC_ALARM_NAME) {
    console.log('[TaskAlarmScheduler] Sync alarm triggered');
    await syncTaskAlarms();
    return;
  }

  if (alarm.name.startsWith(DRAFT_ALARM_PREFIX)) {
    const draftId = alarm.name.slice(DRAFT_ALARM_PREFIX.length);
    console.log(`[TaskAlarmScheduler] Draft alarm triggered: ${draftId}`);
    await handleDraftAlarm(draftId);
    return;
  }

  if (!alarm.name.startsWith(TASK_ALARM_PREFIX)) {
    return; // Not our alarm
  }

  const taskId = alarm.name.slice(TASK_ALARM_PREFIX.length);
  console.log(`[TaskAlarmScheduler] Task alarm triggered: ${taskId}`);

  await handleTaskAlarm(taskId);
}

async function handleTaskAlarm(taskId: string): Promise<void> {
  // 1. Read task config from cache (needed for scheduleNextAlarm)
  console.log(`[TaskAlarmScheduler] Reading task ${taskId} from cache...`);
  const task = await getTaskFromCache(taskId);
  if (!task) {
    console.warn(`[TaskAlarmScheduler] Task ${taskId} not found in cache, removing alarm`);
    await chrome.alarms.clear(`${TASK_ALARM_PREFIX}${taskId}`);
    return;
  }
  console.log(`[TaskAlarmScheduler] Task found: "${task.name}" (${task.task_type})`);

  // 0. Deduplication guard: prevent re-execution within minimum interval
  const lastExecKey = `last_exec_${taskId}`;
  const lastExecResult = await chrome.storage.local.get(lastExecKey);
  const lastExecTime = lastExecResult[lastExecKey] as number | undefined;
  const now = Date.now();
  const MIN_EXEC_INTERVAL_MS = 3 * 60_000; // 3 minutes minimum between executions

  if (lastExecTime && (now - lastExecTime) < MIN_EXEC_INTERVAL_MS) {
    const secAgo = Math.round((now - lastExecTime) / 1000);
    console.log(`[TaskAlarmScheduler] Skipping task ${taskId}: executed ${secAgo}s ago (min interval: ${MIN_EXEC_INTERVAL_MS / 1000}s)`);
    // Still schedule next alarm so the task doesn't become "dead"
    scheduleNextAlarm(task);
    return;
  }

  // Record this execution time
  await chrome.storage.local.set({ [lastExecKey]: now });

  try {
    // 2. Start execution on backend
    console.log(`[TaskAlarmScheduler] Calling start-execution for ${taskId}...`);
    const startResponse = await bgFetchWithAuth(
      `${API_BASE_URL}/api/v1/scheduled-tasks/${taskId}/start-execution`,
      { method: 'POST' }
    );

    if (!startResponse.ok) {
      const errText = await startResponse.text().catch(() => '');
      if (startResponse.status === 404) {
        // Task may have been paused/deleted — remove alarm
        console.warn(`[TaskAlarmScheduler] Task ${taskId} not found (404), removing alarm`);
        await chrome.alarms.clear(`${TASK_ALARM_PREFIX}${taskId}`);
      } else {
        console.error(`[TaskAlarmScheduler] start-execution failed for ${taskId}:`, startResponse.status, errText);
        scheduleNextAlarm(task);
      }
      return;
    }

    const { execution_id: executionId } = await startResponse.json();
    console.log(`[TaskAlarmScheduler] Execution started: ${executionId}`);

    // 3. Register execution timeout (auto-fail if no result within timeout)
    const taskTypeLower = (task.task_type || '').toLowerCase();
    const timeoutMs = LONG_RUNNING_TASK_TYPES.has(taskTypeLower) ? LONG_EXECUTION_TIMEOUT_MS : EXECUTION_TIMEOUT_MS;
    console.log(`[TaskAlarmScheduler] Setting ${timeoutMs / 60000}min timeout for ${taskTypeLower} task`);
    const timeoutTimer = setTimeout(() => {
      console.warn(`[TaskAlarmScheduler] Execution timeout for task=${taskId}, exec=${executionId} (${timeoutMs / 60000}min)`);
      pendingExecutions.delete(executionId);
      // Auto-report as cancelled to backend
      bgFetchWithAuth(
        `${API_BASE_URL}/api/v1/scheduled-tasks/${taskId}/complete-execution`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            execution_id: executionId,
            status: 'cancelled',
            error_message: `Execution cancelled: no result received within ${timeoutMs / 60000} minutes`,
          }),
        }
      ).catch(err => console.error('[TaskAlarmScheduler] Timeout report error:', err));
    }, timeoutMs);

    pendingExecutions.set(executionId, { taskId, executionId, timer: timeoutTimer });

    // 4. Send to content script for execution
    console.log(`[TaskAlarmScheduler] Dispatching to content script: ${task.task_type}`);
    const sent = await sendToOneXTab({
      type: 'EXECUTE_SCHEDULED_TASK',
      taskId,
      executionId,
      taskType: task.task_type,
      taskName: task.name,
      notificationType: task.notification_type,
    });

    if (!sent) {
      // No tab available — immediately report failure instead of waiting for timeout
      clearTimeout(timeoutTimer);
      pendingExecutions.delete(executionId);
      console.warn(`[TaskAlarmScheduler] No X tab to execute task ${taskId}, reporting failure`);
      await bgFetchWithAuth(
        `${API_BASE_URL}/api/v1/scheduled-tasks/${taskId}/complete-execution`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            execution_id: executionId,
            status: 'cancelled',
            error_message: 'No X/Twitter tab available to execute task',
          }),
        }
      ).catch(err => console.error('[TaskAlarmScheduler] Failed to report no-tab error:', err));
    }

    // 5. Schedule next alarm
    scheduleNextAlarm(task);
  } catch (err) {
    console.error(`[TaskAlarmScheduler] handleTaskAlarm error for ${taskId}:`, err);
    scheduleNextAlarm(task);
  }
}

function scheduleNextAlarm(task: CachedTask): void {
  // Clear next_execution_at so computeNextExecutionTime computes from scratch
  const nextTime = computeNextExecutionTime({
    ...task,
    next_execution_at: null,
  });

  if (nextTime !== null) {
    const alarmName = `${TASK_ALARM_PREFIX}${task.id}`;
    // Always create the alarm — the dedup guard in handleTaskAlarm
    // prevents repeated execution even if the alarm fires slightly early
    chrome.alarms.create(alarmName, { when: nextTime });
    console.log(`[TaskAlarmScheduler] Next alarm for ${task.id} at ${new Date(nextTime).toISOString()}`);
  }
}

// ===================== Execution Result Handler =====================

/**
 * Handle task execution result from content script.
 * Reports to backend and optionally reschedules.
 */
export async function handleTaskExecutionResult(
  taskId: string,
  executionId: string,
  success: boolean,
  data?: unknown,
  error?: string
): Promise<void> {
  // Clear timeout timer if exists
  const pending = pendingExecutions.get(executionId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingExecutions.delete(executionId);
    console.log(`[TaskAlarmScheduler] Cleared timeout for execution ${executionId}`);
  }
  console.log(`[TaskAlarmScheduler] Execution result: task=${taskId}, exec=${executionId}, success=${success}`);

  try {
    const response = await bgFetchWithAuth(
      `${API_BASE_URL}/api/v1/scheduled-tasks/${taskId}/complete-execution`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          execution_id: executionId,
          status: success ? 'success' : 'failed',
          result: data ? (typeof data === 'object' ? data : { message: String(data) }) : undefined,
          error_message: error,
        }),
      }
    );

    if (response.ok) {
      console.log(`[TaskAlarmScheduler] Execution result reported successfully`);
    } else {
      console.error(`[TaskAlarmScheduler] Failed to report result:`, response.status);
    }
  } catch (err) {
    console.error('[TaskAlarmScheduler] Error reporting execution result:', err);
  }
}

// ===================== Stale Execution Cleanup =====================

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes (default)
const LONG_STALE_THRESHOLD_MS = 35 * 60 * 1000; // 35 minutes (for long-running tasks)

/**
 * Clean up stale RUNNING executions.
 * Fetches recent executions for each task, cancels any that have been
 * RUNNING for longer than the threshold (task-type aware).
 */
async function cleanupStaleExecutions(tasks: CachedTask[]): Promise<void> {
  console.log(`[TaskAlarmScheduler] Checking ${tasks.length} tasks for stale executions...`);
  const now = Date.now();
  let cleaned = 0;

  for (const task of tasks) {
    try {
      const url = `${API_BASE_URL}/api/v1/scheduled-tasks/${task.id}/executions?limit=10`;
      const response = await bgFetchWithAuth(url);
      if (!response.ok) {
        console.warn(`[TaskAlarmScheduler] Executions fetch failed for ${task.id}: ${response.status}`);
        continue;
      }

      const resJson = await response.json();
      const executions = (resJson?.data || []) as Array<{ id: string; status: string; started_at: string | null }>;

      const taskTypeLower = (task.task_type || '').toLowerCase();
      const threshold = LONG_RUNNING_TASK_TYPES.has(taskTypeLower) ? LONG_STALE_THRESHOLD_MS : STALE_THRESHOLD_MS;

      for (const exec of executions) {
        if (exec.status !== 'running') continue;
        if (!exec.started_at) continue;

        const startedAt = new Date(exec.started_at).getTime();
        const ageMinutes = Math.round((now - startedAt) / 60000);
        if (now - startedAt < threshold) continue;

        // This execution is stale — cancel it
        console.log(`[TaskAlarmScheduler] Cancelling stale execution ${exec.id} for task ${task.id} (running for ${ageMinutes}m)`);
        try {
          const cancelResponse = await bgFetchWithAuth(
            `${API_BASE_URL}/api/v1/scheduled-tasks/${task.id}/complete-execution`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                execution_id: exec.id,
                status: 'cancelled',
                error_message: 'Auto-cancelled: execution stale (no result received)',
              }),
            }
          );
          if (cancelResponse.ok) {
            cleaned++;
            console.log(`[TaskAlarmScheduler] Stale execution ${exec.id} cancelled successfully`);
          } else {
            const errText = await cancelResponse.text().catch(() => '');
            console.error(`[TaskAlarmScheduler] Failed to cancel stale execution ${exec.id}: ${cancelResponse.status} ${errText}`);
          }
        } catch (err) {
          console.error('[TaskAlarmScheduler] Stale cleanup error:', err);
        }
      }
    } catch (err) {
      console.warn(`[TaskAlarmScheduler] Failed to check executions for task ${task.id}:`, err);
    }
  }

  console.log(`[TaskAlarmScheduler] Stale cleanup done: ${cleaned} executions cancelled`);
}

// ===================== Helpers =====================

/**
 * Send a message to one X/Twitter tab.
 * Returns true if message was sent successfully, false otherwise.
 */
async function sendToOneXTab(message: object): Promise<boolean> {
  // Helper: try sending to a specific tab
  const trySend = async (tabId: number): Promise<boolean> => {
    try {
      await chrome.tabs.sendMessage(tabId, message);
      console.log(`[TaskAlarmScheduler] Message sent to tab ${tabId} successfully`);
      return true;
    } catch {
      return false;
    }
  };

  // Helper: try all existing X tabs
  const tryExistingTabs = async (): Promise<boolean> => {
    // Try active tab first
    const activeTabs = await chrome.tabs.query({
      url: ['*://twitter.com/*', '*://x.com/*'],
      active: true,
      currentWindow: true,
    });
    for (const tab of activeTabs) {
      if (tab.id && await trySend(tab.id)) return true;
    }

    // Fallback: any X tab
    const allXTabs = await chrome.tabs.query({
      url: ['*://twitter.com/*', '*://x.com/*'],
    });
    for (const tab of allXTabs) {
      if (tab.id && await trySend(tab.id)) return true;
    }
    return false;
  };

  // First attempt
  if (await tryExistingTabs()) return true;

  // No responsive tab — open one and wait for content script to load
  console.log('[TaskAlarmScheduler] No responsive X tab, opening one and waiting...');
  const newTab = await chrome.tabs.create({ url: 'https://x.com/home', active: false });

  // Wait for the tab to finish loading and content script to inject
  if (newTab.id) {
    await new Promise<void>(resolve => {
      const onUpdated = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
        if (tabId === newTab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      // Safety timeout: 15 seconds max wait
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }, 15000);
    });

    // Extra wait for content script initialization
    await new Promise(r => setTimeout(r, 3000));

    // Retry sending to all tabs (including the new one)
    if (await tryExistingTabs()) return true;
  }

  console.warn('[TaskAlarmScheduler] Failed to send message after opening new tab');
  return false;
}

/**
 * Get access token from storage. Returns null if not logged in.
 */
async function getAccessToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(['accessToken.bnbot', 'refreshToken.bnbot']);
  const accessToken = result['accessToken.bnbot'] as string | undefined;
  return accessToken || null;
}

/**
 * Make authenticated fetch requests from background service worker.
 * Reads token from storage, refreshes on 401.
 */
async function bgFetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const result = await chrome.storage.local.get(['accessToken.bnbot', 'refreshToken.bnbot']);
  let accessToken = result['accessToken.bnbot'] as string | undefined;
  const refreshToken = result['refreshToken.bnbot'] as string | undefined;

  if (!accessToken) {
    throw new Error('No access token');
  }

  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  let response = await fetch(url, { ...options, headers });

  // Refresh token on 401
  if (response.status === 401 && refreshToken) {
    console.log('[TaskAlarmScheduler] Token expired, refreshing...');
    const refreshResponse = await fetch(`${API_BASE_URL}/api/v1/refresh`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${refreshToken}` },
    });

    if (refreshResponse.ok) {
      const data = await refreshResponse.json();
      if (data.access_token) {
        await chrome.storage.local.set({
          'accessToken.bnbot': data.access_token,
          'refreshToken.bnbot': data.refresh_token || refreshToken,
        });
        accessToken = data.access_token;

        const retryHeaders = new Headers(options.headers);
        retryHeaders.set('Authorization', `Bearer ${accessToken}`);
        if (!retryHeaders.has('Content-Type') && options.body) {
          retryHeaders.set('Content-Type', 'application/json');
        }

        response = await fetch(url, { ...options, headers: retryHeaders });
      }
    }
  }

  return response;
}

// ===================== Cache Helpers =====================

async function getTaskFromCache(taskId: string): Promise<CachedTask | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const tasks = (result[STORAGE_KEY] || []) as CachedTask[];
  return tasks.find(t => t.id === taskId) || null;
}

async function updateTaskInCache(task: CachedTask): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const tasks = (result[STORAGE_KEY] || []) as CachedTask[];
  const idx = tasks.findIndex(t => t.id === task.id);
  if (idx >= 0) {
    tasks[idx] = task;
  } else {
    tasks.push(task);
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: tasks });
}

async function removeTaskFromCache(taskId: string): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const tasks = (result[STORAGE_KEY] || []) as CachedTask[];
  const filtered = tasks.filter(t => t.id !== taskId);
  await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
}

// ===================== Draft Alarm Scheduling =====================

/**
 * Sync all draft alarms with the backend.
 * Fetches drafts → filters scheduled ones → creates/removes alarms.
 */
async function syncDraftAlarms(): Promise<void> {
  const token = await getAccessToken();
  if (!token) {
    console.log('[DraftAlarm] No token, skipping draft sync');
    return;
  }

  try {
    const response = await bgFetchWithAuth(`${API_BASE_URL}/api/v1/drafts?limit=100`);
    if (!response.ok) {
      console.error('[DraftAlarm] Failed to fetch drafts:', response.status);
      return;
    }

    const resData = await response.json();
    const allDrafts = (resData?.data || []) as CachedDraft[];

    // Filter to scheduled drafts with a future (or recent past) scheduled_at
    const scheduledDrafts = allDrafts.filter(
      d => d.publish_status === 'scheduled' && d.scheduled_at
    );
    console.log(`[DraftAlarm] Fetched ${allDrafts.length} drafts, ${scheduledDrafts.length} scheduled`);

    // Cache scheduled drafts
    await chrome.storage.local.set({ [DRAFT_STORAGE_KEY]: scheduledDrafts });

    // Get existing draft alarms
    const allAlarms = await chrome.alarms.getAll();
    const existingDraftAlarms = new Map<string, chrome.alarms.Alarm>();
    for (const alarm of allAlarms) {
      if (alarm.name.startsWith(DRAFT_ALARM_PREFIX)) {
        existingDraftAlarms.set(alarm.name, alarm);
      }
    }

    // Build desired alarm set
    const desiredAlarms = new Set<string>();
    const now = Date.now();

    for (const draft of scheduledDrafts) {
      const alarmName = `${DRAFT_ALARM_PREFIX}${draft.id}`;
      desiredAlarms.add(alarmName);

      const scheduledTime = new Date(draft.scheduled_at).getTime();

      // Skip past schedules
      if (scheduledTime <= now) {
        console.log(`[DraftAlarm] Draft ${draft.id} scheduled_at is in the past, skipping`);
        continue;
      }

      const existing = existingDraftAlarms.get(alarmName);
      if (existing && Math.abs(existing.scheduledTime - scheduledTime) < 60_000) {
        continue; // Alarm already set close enough
      }

      chrome.alarms.create(alarmName, { when: scheduledTime });
      console.log(`[DraftAlarm] Scheduled alarm ${alarmName} at ${new Date(scheduledTime).toISOString()}`);
    }

    // Remove alarms for drafts no longer scheduled
    for (const [alarmName] of existingDraftAlarms) {
      if (!desiredAlarms.has(alarmName)) {
        await chrome.alarms.clear(alarmName);
        console.log(`[DraftAlarm] Removed stale alarm ${alarmName}`);
      }
    }

    console.log('[DraftAlarm] Sync complete');
  } catch (err) {
    console.error('[DraftAlarm] Sync error:', err);
  }
}

/**
 * Sync a single draft's alarm (called after UI schedules a draft).
 */
export async function syncSingleDraftAlarm(draftId: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) return;

  try {
    const response = await bgFetchWithAuth(`${API_BASE_URL}/api/v1/drafts?limit=100`);
    if (!response.ok) {
      console.error(`[DraftAlarm] Failed to fetch drafts for ${draftId}:`, response.status);
      return;
    }

    const resData = await response.json();
    const allDrafts = (resData?.data || []) as CachedDraft[];
    const draft = allDrafts.find(d => d.id === draftId);

    const alarmName = `${DRAFT_ALARM_PREFIX}${draftId}`;

    if (!draft || draft.publish_status !== 'scheduled' || !draft.scheduled_at) {
      await chrome.alarms.clear(alarmName);
      await removeDraftFromCache(draftId);
      console.log(`[DraftAlarm] Cleared alarm for non-scheduled draft ${draftId}`);
      return;
    }

    // Update cache
    await updateDraftInCache(draft);

    const scheduledTime = new Date(draft.scheduled_at).getTime();

    // If scheduled time is in the past, skip (don't auto-trigger)
    if (scheduledTime <= Date.now()) {
      console.log(`[DraftAlarm] Draft ${draftId} scheduled_at is in the past (${draft.scheduled_at}), skipping alarm`);
      return;
    }

    chrome.alarms.create(alarmName, { when: scheduledTime });
    console.log(`[DraftAlarm] Scheduled alarm ${alarmName} at ${new Date(scheduledTime).toISOString()}`);
  } catch (err) {
    console.error(`[DraftAlarm] syncSingleDraftAlarm error:`, err);
  }
}

/**
 * Remove a draft's alarm (called after UI unschedules a draft).
 */
export async function removeDraftAlarm(draftId: string): Promise<void> {
  const alarmName = `${DRAFT_ALARM_PREFIX}${draftId}`;
  await chrome.alarms.clear(alarmName);
  await removeDraftFromCache(draftId);
  console.log(`[DraftAlarm] Removed alarm ${alarmName}`);
}

/**
 * Handle draft alarm trigger: publish the scheduled draft.
 */
async function handleDraftAlarm(draftId: string): Promise<void> {
  const draft = await getDraftFromCache(draftId);
  if (!draft) {
    console.warn(`[DraftAlarm] Draft ${draftId} not found in cache, removing alarm`);
    await chrome.alarms.clear(`${DRAFT_ALARM_PREFIX}${draftId}`);
    return;
  }

  // Double-check it's still scheduled (prevent duplicate triggers)
  if (draft.publish_status !== 'scheduled') {
    console.log(`[DraftAlarm] Draft ${draftId} status is ${draft.publish_status}, skipping`);
    await chrome.alarms.clear(`${DRAFT_ALARM_PREFIX}${draftId}`);
    return;
  }

  console.log(`[DraftAlarm] Publishing draft ${draftId} (${draft.draft_type})`);

  const sent = await sendToOneXTab({
    type: 'PUBLISH_SCHEDULED_DRAFT',
    draftId,
    draftType: draft.draft_type,
    content: draft.content,
  });

  if (!sent) {
    console.warn(`[DraftAlarm] No X tab to publish draft ${draftId}, reporting failure`);
    await handleDraftPublishResult(draftId, false, 'No X/Twitter tab available to publish draft');
  }
}

/**
 * Handle draft publish result from content script.
 * Reports to backend and removes from cache.
 */
export async function handleDraftPublishResult(
  draftId: string, success: boolean, error?: string
): Promise<void> {
  console.log(`[DraftAlarm] Publish result: draft=${draftId}, success=${success}`);

  if (!success) {
    chrome.notifications.create(`draft-fail-${draftId}`, {
      type: 'basic',
      iconUrl: 'assets/images/icon-128.png',
      title: '推文发布失败',
      message: error || '未知错误',
    });
  }

  try {
    const endpoint = success ? 'publish' : 'fail';
    const url = `${API_BASE_URL}/api/v1/drafts/${draftId}/${endpoint}`;

    const options: RequestInit = { method: 'PUT' };
    if (!success && error) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify({ error_message: error });
    }

    const response = await bgFetchWithAuth(url, options);

    if (response.ok) {
      console.log(`[DraftAlarm] Draft ${draftId} marked as ${success ? 'published' : 'failed'}`);
    } else {
      console.error(`[DraftAlarm] Failed to update draft status:`, response.status);
    }
  } catch (err) {
    console.error('[DraftAlarm] Error reporting draft result:', err);
  }

  // Remove from cache regardless of API result
  await removeDraftFromCache(draftId);
}

// ===================== Draft Cache Helpers =====================

async function getDraftFromCache(draftId: string): Promise<CachedDraft | null> {
  const result = await chrome.storage.local.get(DRAFT_STORAGE_KEY);
  const drafts = (result[DRAFT_STORAGE_KEY] || []) as CachedDraft[];
  return drafts.find(d => d.id === draftId) || null;
}

async function updateDraftInCache(draft: CachedDraft): Promise<void> {
  const result = await chrome.storage.local.get(DRAFT_STORAGE_KEY);
  const drafts = (result[DRAFT_STORAGE_KEY] || []) as CachedDraft[];
  const idx = drafts.findIndex(d => d.id === draft.id);
  if (idx >= 0) {
    drafts[idx] = draft;
  } else {
    drafts.push(draft);
  }
  await chrome.storage.local.set({ [DRAFT_STORAGE_KEY]: drafts });
}

async function removeDraftFromCache(draftId: string): Promise<void> {
  const result = await chrome.storage.local.get(DRAFT_STORAGE_KEY);
  const drafts = (result[DRAFT_STORAGE_KEY] || []) as CachedDraft[];
  const filtered = drafts.filter(d => d.id !== draftId);
  await chrome.storage.local.set({ [DRAFT_STORAGE_KEY]: filtered });
}
