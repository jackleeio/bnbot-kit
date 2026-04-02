/**
 * Action Integration
 * 将 Action 系统集成到 ChatPanel 的辅助模块
 */

import { actionExecutor } from './actionExecutor';
import { actionRegistry } from './actionRegistry';
import { allHandlers } from './actions';
import { ActionContext, ActionExecutorCallbacks } from '../types/action';

// 标记是否已初始化
let initialized = false;

/**
 * 初始化 Action 系统
 * 注册所有 handlers 到执行器
 */
export function initializeActionSystem(): void {
  if (initialized) {
    console.log('[ActionIntegration] Already initialized');
    return;
  }

  console.log('[ActionIntegration] Initializing action system...');
  actionExecutor.registerAll(allHandlers);
  initialized = true;
  console.log('[ActionIntegration] Registered', Object.keys(allHandlers).length, 'handlers');
}

/**
 * 检查是否是 Action 调用
 */
export function isActionCall(toolName: string): boolean {
  // Action 调用以 action_ 前缀开始
  if (toolName.startsWith('action_')) {
    const actionId = toolName.replace('action_', '');
    return actionRegistry.has(actionId);
  }
  return false;
}

/**
 * 从工具名称提取 Action ID
 */
export function extractActionId(toolName: string): string {
  return toolName.replace('action_', '');
}

/**
 * 执行 Action
 */
export async function executeAction(
  toolName: string,
  args: Record<string, unknown>,
  callbacks: {
    onProgress?: (message: string) => void;
    onComplete?: (result: unknown) => void;
    onError?: (error: string) => void;
  } = {}
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  // 确保已初始化
  initializeActionSystem();

  const actionId = extractActionId(toolName);
  const actionDef = actionRegistry.get(actionId);

  if (!actionDef) {
    const error = `Unknown action: ${actionId}`;
    console.error('[ActionIntegration]', error);
    callbacks.onError?.(error);
    return { success: false, error };
  }

  console.log('[ActionIntegration] Executing action:', actionId, args);

  const executorCallbacks: ActionExecutorCallbacks = {
    onStart: (context) => {
      console.log('[ActionIntegration] Action started:', context.action.id);
    },
    onProgress: (context, message) => {
      console.log('[ActionIntegration] Progress:', message);
      callbacks.onProgress?.(message);
    },
    onStepComplete: (context, stepId, result) => {
      console.log('[ActionIntegration] Step complete:', stepId);
    },
    onComplete: (context, result) => {
      console.log('[ActionIntegration] Action complete:', context.action.id);
      callbacks.onComplete?.(result);
    },
    onError: (context, error) => {
      console.error('[ActionIntegration] Action error:', error.message);
      callbacks.onError?.(error.message);
    },
  };

  try {
    const result = await actionExecutor.execute(actionDef, args, executorCallbacks);
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[ActionIntegration] Execution failed:', error);
    callbacks.onError?.(error);
    return { success: false, error };
  }
}

/**
 * 获取所有可用的 Action 定义（用于显示）
 */
export function getAvailableActions() {
  return actionRegistry.getAll();
}

/**
 * 获取指定类别的 Actions
 */
export function getActionsByCategory(category: string) {
  return actionRegistry.getByCategory(category);
}

/**
 * 取消正在执行的 Action
 */
export function cancelAction(executionId: string): boolean {
  return actionExecutor.cancel(executionId);
}

/**
 * 取消所有正在执行的 Actions
 */
export function cancelAllActions(): void {
  actionExecutor.cancelAll();
}

/**
 * 获取活动的 Action 上下文
 */
export function getActiveActions(): ActionContext[] {
  return actionExecutor.getActiveContexts();
}
