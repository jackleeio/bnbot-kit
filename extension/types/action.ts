/**
 * Action System Type Definitions
 * 定义前端与后端 AI 模型交互的 Action 系统类型
 */

// Action 类别
export type ActionCategory =
  | 'navigation'    // 导航类
  | 'reply'         // 回复类
  | 'tweet'         // 发推类
  | 'article'       // 文章类
  | 'scrape'        // 抓取类
  | 'notification'  // 通知类
  | 'search'        // 搜索类
  | 'scroll'        // 刷推类
  | 'composite';    // 复合类

// 触发方式
export type ActionTrigger = 'backend' | 'frontend' | 'both';

// Action 状态
export type ActionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

// Action 参数定义
export interface ActionParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'blob';
  required: boolean;
  default?: unknown;
  description: string;
}

// Action 步骤（用于复合 Action）
export interface ActionStep {
  id: string;
  actionId: string;          // 引用的 action ID
  params?: Record<string, unknown>;
  dependsOn?: string[];      // 依赖的步骤 ID
}

// Action 定义
export interface ActionDefinition {
  id: string;
  name: string;
  nameKey: string;           // 本地化 key
  category: ActionCategory;
  trigger: ActionTrigger;
  parameters: ActionParameter[];
  steps?: ActionStep[];      // 复合 action 的步骤
  timeout?: number;          // 超时时间（毫秒）
}

// Action 执行上下文
export interface ActionContext {
  executionId: string;
  action: ActionDefinition;
  params: Record<string, unknown>;
  status: ActionStatus;
  progress: number;          // 0-100
  currentStep?: string;
  stepResults: Map<string, unknown>;
  result?: unknown;
  error?: string;
  startTime: number;
  abortController: AbortController;
}

// Action 执行回调
export interface ActionExecutorCallbacks {
  onStart?: (context: ActionContext) => void;
  onProgress?: (context: ActionContext, message: string) => void;
  onStepComplete?: (context: ActionContext, stepId: string, result: unknown) => void;
  onComplete?: (context: ActionContext, result: unknown) => void;
  onError?: (context: ActionContext, error: Error) => void;
}

// Action Handler 函数类型
export type ActionHandler = (
  params: Record<string, unknown>,
  callbacks: ActionExecutorCallbacks,
  context: ActionContext
) => Promise<ActionResult>;

// Action 执行结果
export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// 搜索过滤器
export interface SearchFilters {
  from?: string;        // 来自特定用户
  to?: string;          // @提及特定用户
  since?: string;       // 起始日期 YYYY-MM-DD
  until?: string;       // 结束日期 YYYY-MM-DD
  minReplies?: number;  // 最少回复数
  minLikes?: number;    // 最少点赞数
  minRetweets?: number; // 最少转发数
  hasMedia?: boolean;   // 包含媒体
  hasLinks?: boolean;   // 包含链接
  lang?: string;        // 语言
}

// 书签数据结构
export interface ScrapedBookmark {
  tweetId: string;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  timestamp: string;
  metrics: {
    replies: number;
    retweets: number;
    likes: number;
    views: number;
  };
  media: Array<{ type: 'photo' | 'video'; url: string }>;
  bookmarkedAt?: string;
}

// Action 事件（用于 SSE 集成）
export interface ActionEvent {
  type: 'action_start' | 'action_progress' | 'action_step' | 'action_result' | 'action_error';
  actionId: string;
  executionId: string;
  data?: unknown;
  progress?: number;
  step?: string;
  message?: string;
  error?: string;
}

// 长推数据结构
export interface ThreadTweet {
  text: string;
  media?: Array<{
    type: 'photo' | 'video';
    url?: string;
    base64?: string;
  }>;
}

// 文章数据结构
export interface ArticleData {
  title: string;
  content: string;
  format?: 'plain' | 'markdown' | 'html';
  headerImage?: string;  // base64 或 URL
  bodyImages?: string[]; // base64 或 URL 数组
}

// Actions that use the interrupt/resume flow (data collection actions)
// These require SSE to close while frontend executes DOM operations
export const INTERRUPT_ACTIONS = [
  'scrape_bookmarks',
  'scrape_timeline',
  'scrape_search_results',
  'advanced_search',
  'process_notifications',
  'scroll_and_collect',
  'bookmark_summary',
  'search_and_analyze',
  'timeline_analysis',
  'fetch_wechat_article',
  'fetch_xiaohongshu_note',
] as const;

export type InterruptAction = typeof INTERRUPT_ACTIONS[number];
