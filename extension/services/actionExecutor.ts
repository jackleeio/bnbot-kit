/**
 * Action Executor
 * 统一的 Action 执行器，负责调度和执行所有 Actions
 */

import {
  ActionDefinition,
  ActionContext,
  ActionStatus,
  ActionExecutorCallbacks,
  ActionHandler,
  ActionResult
} from '../types/action';

// AI 操作指示器的 ID
const AI_INDICATOR_STYLE_ID = 'bnbot-ai-indicator-style';
const AI_INDICATOR_OVERLAY_ID = 'bnbot-ai-overlay';

// 不需要显示蓝色遮挡层的 action 列表（这些 action 不操作 Twitter DOM）
const NO_INDICATOR_ACTIONS = [
  'fetch_wechat_article',
  'fetch_xiaohongshu_note',
  'scrape_bookmarks',
  'post_tweet',
  'post_thread',
  'submit_reply',
  'open_tweet_composer',
];

// 存储 resize 事件处理器的引用
let resizeHandler: (() => void) | null = null;

/**
 * 显示 AI 操作指示器 - 蓝色呼吸发光效果
 * 覆盖 header 和 primaryColumn
 */
function showAIOperatingIndicator(): void {
  // 如果已经存在，不重复创建
  if (document.getElementById(AI_INDICATOR_OVERLAY_ID)) {
    return;
  }

  const header = document.querySelector('header[role="banner"]');
  const col = document.querySelector('[data-testid="primaryColumn"]');

  if (!header || !col) {
    console.log('[ActionExecutor] Cannot show AI indicator - elements not found');
    return;
  }

  const left = header.getBoundingClientRect().left;
  const right = col.getBoundingClientRect().right;
  const width = right - left;

  const overlay = document.createElement('div');
  overlay.id = AI_INDICATOR_OVERLAY_ID;
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: ${left}px;
    width: ${width}px;
    height: 100vh;
    pointer-events: none;
    z-index: 9999;
  `;
  document.body.appendChild(overlay);

  resizeHandler = () => {
    const newLeft = header.getBoundingClientRect().left;
    const newRight = col.getBoundingClientRect().right;
    overlay.style.left = newLeft + 'px';
    overlay.style.width = (newRight - newLeft) + 'px';
  };
  window.addEventListener('resize', resizeHandler);

  const style = document.createElement('style');
  style.id = AI_INDICATOR_STYLE_ID;
  style.textContent = `
    @keyframes bnbot-breathe {
      0%, 100% {
        box-shadow:
          inset 0 40px 40px -30px rgba(29,155,240,0.25),
          inset 0 -40px 40px -30px rgba(29,155,240,0.25),
          inset 80px 0 60px -40px rgba(29,155,240,0.25),
          inset -80px 0 60px -40px rgba(29,155,240,0.25);
      }
      50% {
        box-shadow:
          inset 0 40px 40px -30px rgba(29,155,240,0.6),
          inset 0 -40px 40px -30px rgba(29,155,240,0.6),
          inset 80px 0 60px -40px rgba(29,155,240,0.6),
          inset -80px 0 60px -40px rgba(29,155,240,0.6);
      }
    }
    #${AI_INDICATOR_OVERLAY_ID} {
      animation: bnbot-breathe 1.5s ease-in-out infinite !important;
    }
  `;
  document.head.appendChild(style);

  console.log('[ActionExecutor] AI indicator shown');
}

/**
 * 隐藏 AI 操作指示器
 */
function hideAIOperatingIndicator(): void {
  const style = document.getElementById(AI_INDICATOR_STYLE_ID);
  if (style) style.remove();

  const overlay = document.getElementById(AI_INDICATOR_OVERLAY_ID);
  if (overlay) overlay.remove();

  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }

  console.log('[ActionExecutor] AI indicator hidden');
}

/**
 * Action 执行器 - 单例模式
 */
class ActionExecutor {
  private static instance: ActionExecutor;
  private handlers: Map<string, ActionHandler> = new Map();
  private activeContexts: Map<string, ActionContext> = new Map();

  // Global mutex lock - only one action can execute at a time (across all sources)
  private executionLock: boolean = false;
  private lockSource: string | null = null;

  private constructor() {}

  static getInstance(): ActionExecutor {
    if (!ActionExecutor.instance) {
      ActionExecutor.instance = new ActionExecutor();
    }
    return ActionExecutor.instance;
  }

  /**
   * 注册 Action Handler
   */
  register(actionId: string, handler: ActionHandler): void {
    this.handlers.set(actionId, handler);
    console.log(`[ActionExecutor] Registered handler: ${actionId}`);
  }

  /**
   * 批量注册 Handlers
   */
  registerAll(handlers: Record<string, ActionHandler>): void {
    Object.entries(handlers).forEach(([id, handler]) => {
      this.register(id, handler);
    });
  }

  /**
   * 获取已注册的 Action IDs
   */
  getRegisteredActions(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * 检查 Action 是否已注册
   */
  hasAction(actionId: string): boolean {
    return this.handlers.has(actionId);
  }

  /**
   * Check if an action is currently executing (busy)
   */
  isBusy(): boolean {
    return this.executionLock;
  }

  /**
   * 执行 Action
   * @param source - 来源标识 ('frontend' | 'remote' | 'local'), 用于日志追踪
   */
  async execute(
    action: ActionDefinition,
    params: Record<string, unknown>,
    callbacks: ActionExecutorCallbacks = {},
    source: string = 'frontend'
  ): Promise<ActionResult> {
    // Global mutex: only one action at a time
    if (this.executionLock) {
      console.warn(`[ActionExecutor] Busy (locked by ${this.lockSource}), rejecting ${action.id} from ${source}`);
      return {
        success: false,
        error: 'extension_busy',
        data: { retryAfter: 3000 },
      };
    }

    this.executionLock = true;
    this.lockSource = source;

    const executionId = crypto.randomUUID();
    const abortController = new AbortController();

    const context: ActionContext = {
      executionId,
      action,
      params: this.applyDefaults(action, params),
      status: 'pending',
      progress: 0,
      stepResults: new Map(),
      startTime: Date.now(),
      abortController
    };

    this.activeContexts.set(executionId, context);

    try {
      context.status = 'running';
      callbacks.onStart?.(context);

      // 显示 AI 操作指示器（仅对需要操作 DOM 的 action）
      const shouldShowIndicator = !NO_INDICATOR_ACTIONS.includes(action.id);
      if (shouldShowIndicator) {
        showAIOperatingIndicator();
      }

      let result: ActionResult;

      // 复合 Action 还是原子 Action？
      if (action.steps && action.steps.length > 0) {
        result = await this.executeComposite(context, callbacks);
      } else {
        result = await this.executeAtomic(context, callbacks);
      }

      context.status = 'completed';
      context.progress = 100;
      context.result = result.data;
      callbacks.onComplete?.(context, result.data);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      context.status = 'failed';
      context.error = errorMessage;
      callbacks.onError?.(context, error instanceof Error ? error : new Error(errorMessage));

      return { success: false, error: errorMessage };
    } finally {
      // 释放互斥锁
      this.executionLock = false;
      this.lockSource = null;
      // 隐藏 AI 操作指示器
      hideAIOperatingIndicator();
      this.activeContexts.delete(executionId);
    }
  }

  /**
   * 执行原子 Action
   */
  private async executeAtomic(
    context: ActionContext,
    callbacks: ActionExecutorCallbacks
  ): Promise<ActionResult> {
    const handler = this.handlers.get(context.action.id);
    if (!handler) {
      throw new Error(`No handler registered for action: ${context.action.id}`);
    }

    // 检查超时
    const timeout = context.action.timeout || 60000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Action timeout: ${context.action.id}`)), timeout);
    });

    // 执行 handler
    const result = await Promise.race([
      handler(context.params, callbacks, context),
      timeoutPromise
    ]);

    return result;
  }

  /**
   * 执行复合 Action
   */
  private async executeComposite(
    context: ActionContext,
    callbacks: ActionExecutorCallbacks
  ): Promise<ActionResult> {
    const steps = context.action.steps!;
    const totalSteps = steps.length;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // 检查是否被取消
      if (context.abortController.signal.aborted) {
        context.status = 'cancelled';
        return { success: false, error: 'Action cancelled' };
      }

      // 检查依赖
      if (step.dependsOn) {
        for (const depId of step.dependsOn) {
          if (!context.stepResults.has(depId)) {
            throw new Error(`Dependency ${depId} not satisfied for step ${step.id}`);
          }
        }
      }

      // 更新进度
      context.currentStep = step.id;
      context.progress = Math.round((i / totalSteps) * 100);
      callbacks.onProgress?.(context, `Step ${i + 1}/${totalSteps}: ${step.id}`);

      // 获取步骤的 handler
      const handler = this.handlers.get(step.actionId);
      if (!handler) {
        throw new Error(`No handler for step action: ${step.actionId}`);
      }

      // 合并参数：context.params + step.params + 上一步的结果
      const stepParams = {
        ...context.params,
        ...step.params,
        _previousResults: Object.fromEntries(context.stepResults)
      };

      // 执行步骤
      const stepResult = await handler(stepParams, callbacks, context);

      if (!stepResult.success) {
        throw new Error(`Step ${step.id} failed: ${stepResult.error}`);
      }

      // 保存步骤结果
      context.stepResults.set(step.id, stepResult.data);
      callbacks.onStepComplete?.(context, step.id, stepResult.data);
    }

    // 返回所有步骤的结果
    return {
      success: true,
      data: Object.fromEntries(context.stepResults)
    };
  }

  /**
   * 取消正在执行的 Action
   */
  cancel(executionId: string): boolean {
    const context = this.activeContexts.get(executionId);
    if (context) {
      context.abortController.abort();
      context.status = 'cancelled';
      console.log(`[ActionExecutor] Cancelled: ${executionId}`);
      return true;
    }
    return false;
  }

  /**
   * 取消所有正在执行的 Actions
   */
  cancelAll(): void {
    this.activeContexts.forEach((context, id) => {
      this.cancel(id);
    });
  }

  /**
   * 获取活动的执行上下文
   */
  getActiveContexts(): ActionContext[] {
    return Array.from(this.activeContexts.values());
  }

  /**
   * 应用默认参数值
   */
  private applyDefaults(
    action: ActionDefinition,
    params: Record<string, unknown>
  ): Record<string, unknown> {
    const result = { ...params };

    for (const param of action.parameters) {
      if (result[param.name] === undefined && param.default !== undefined) {
        result[param.name] = param.default;
      }
    }

    return result;
  }
}

// 导出单例
export const actionExecutor = ActionExecutor.getInstance();
