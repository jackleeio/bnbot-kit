# Action 系统文档

## 概述

Action 系统是 BNBOT 扩展的前端自动化框架，允许后端 AI 模型通过 `tool_start` 事件（以 `x_action_` 前缀标识）触发前端 DOM 操作。

### 核心特性

- **复用 tool 机制**：通过工具名称前缀 `x_action_` 区分前端 Action
- **双向通信**：前端执行完成后通过 `action_result` 消息返回结果
- **原子 + 复合**：支持单一操作和多步骤组合操作
- **进度报告**：实时反馈执行进度
- **可取消**：支持中途取消正在执行的 Action
- **超时控制**：每个 Action 都有超时保护

---

## 后端 AI 接入指南

### 事件区分

- `tool_start` (name 不含 `x_action_` 前缀) → **后端工具调用**（如 `generate_image`、`search_tweets`）
- `tool_start` (name 以 `x_action_` 开头) → **前端插件 Action 调用**（如 `x_action_scrape_bookmarks`）

### SSE 事件格式

#### tool_start 事件

```json
{
  "type": "tool_start",
  "name": "x_action_scrape_bookmarks",
  "input": { "limit": 20 },
  "id": "call_abc123"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | Y | 固定为 `tool_start` |
| `name` | string | Y | 工具名称，格式：`x_action_{action_id}` |
| `input` | object | N | Action 参数 |
| `id` | string | Y | 工具调用 ID，用于追踪 |

#### tool_end 事件

```json
{
  "type": "tool_end",
  "name": "x_action_scrape_bookmarks",
  "output": "已请求前端抓取书签（最多 20 条），请等待用户提供抓取结果后继续处理。",
  "id": "call_abc123"
}
```

### 前端处理流程

1. 前端 ChatService 接收到 `tool_start` 事件
2. 检测到 `name` 以 `x_action_` 开头，识别为前端 Action
3. 提取 `action_id`（去掉前缀）并触发 `onActionCall` 回调
4. ChatPanel 从 ActionRegistry 获取 Action 定义
5. 调用 ActionExecutor 执行对应的 Handler
6. 执行完成后，前端发送 `action_result` 消息继续对话

### 返回结果机制

对于需要返回数据的 Action（如抓取类），前端执行完成后发送一个新的请求，包含 `action_result` 类型的消息：

```json
{
  "messages": [
    { "role": "user", "content": "帮我总结一下书签" },
    { "role": "assistant", "content": "好的，让我获取您的书签..." },
    {
      "role": "user",
      "content": [
        {
          "type": "action_result",
          "action_id": "scrape_bookmarks",
          "success": true,
          "data": {
            "bookmarks": [...],
            "count": 20
          }
        }
      ]
    }
  ]
}
```

---

## Action 完整列表

### 1. 导航类 (Navigation)

| action_id | tool name | 描述 | 参数 |
|-----------|-----------|------|------|
| `navigate_to_tweet` | `x_action_navigate_to_tweet` | 导航到推文详情页 | `tweet_url: string` (必填) |
| `navigate_to_url` | `x_action_navigate_to_url` | SPA 导航到任意 URL | `url: string` (必填) |
| `navigate_to_bookmarks` | `x_action_navigate_to_bookmarks` | 导航到书签页 | 无 |
| `navigate_to_notifications` | `x_action_navigate_to_notifications` | 导航到通知页 | 无 |
| `navigate_to_search` | `x_action_navigate_to_search` | 导航到搜索页 | `query?: string` |
| `return_to_timeline` | `x_action_return_to_timeline` | 返回时间线 | 无 |

**示例**：
```json
{
  "type": "tool_start",
  "name": "x_action_navigate_to_tweet",
  "input": {
    "tweet_url": "https://x.com/elonmusk/status/1234567890"
  },
  "id": "call_nav_001"
}
```

---

### 2. 回复类 (Reply)

| action_id | tool name | 描述 | 参数 |
|-----------|-----------|------|------|
| `open_reply_composer` | `x_action_open_reply_composer` | 打开回复编辑器 | 无 |
| `fill_reply_text` | `x_action_fill_reply_text` | 填充回复内容 | `content: string` (必填), `highlight?: boolean` |
| `upload_image_to_reply` | `x_action_upload_image_to_reply` | 上传图片到回复 | `image_data: string` (必填, base64) |
| `submit_reply` | `x_action_submit_reply` | 提交回复 | `wait_for_success?: boolean` |

**示例**：
```json
{
  "type": "tool_start",
  "name": "x_action_fill_reply_text",
  "input": {
    "content": "这是一条自动生成的回复！",
    "highlight": true
  },
  "id": "call_reply_001"
}
```

---

### 3. 发推类 (Tweet)

| action_id | tool name | 描述 | 参数 |
|-----------|-----------|------|------|
| `open_tweet_composer` | `x_action_open_tweet_composer` | 打开推文编辑器 | 无 |
| `post_tweet` | `x_action_post_tweet` | 发布单条推文 | `text: string` (必填), `media?: array` |
| `post_thread` | `x_action_post_thread` | 发布线程（长推） | `tweets: array` (必填) |

**tweets 数组格式**：
```typescript
interface ThreadTweet {
  text: string;
  media?: Array<{
    type: 'photo' | 'video';
    url?: string;
    base64?: string;
  }>;
}
```

**示例**：
```json
{
  "type": "tool_start",
  "name": "x_action_post_thread",
  "input": {
    "tweets": [
      { "text": "这是第一条推文" },
      { "text": "这是第二条推文" },
      { "text": "这是最后一条！" }
    ]
  },
  "id": "call_thread_001"
}
```

---

### 4. 文章类 (Article)

| action_id | tool name | 描述 | 参数 |
|-----------|-----------|------|------|
| `open_article_editor` | `x_action_open_article_editor` | 打开文章编辑器 | 无 |
| `fill_article_title` | `x_action_fill_article_title` | 填充文章标题 | `title: string` (必填) |
| `fill_article_body` | `x_action_fill_article_body` | 填充文章正文 | `content: string` (必填), `format?: 'plain'|'markdown'|'html'` |
| `upload_article_header_image` | `x_action_upload_article_header_image` | 上传文章头图 | `image_data: string` (必填, base64) |
| `publish_article` | `x_action_publish_article` | 发布文章 | `as_draft?: boolean` |

**示例**：
```json
{
  "type": "tool_start",
  "name": "x_action_fill_article_body",
  "input": {
    "content": "# 文章标题\n\n这是正文内容...",
    "format": "markdown"
  },
  "id": "call_article_001"
}
```

---

### 5. 抓取类 (Scrape) - 需要返回结果

| action_id | tool name | 描述 | 参数 | 返回数据 |
|-----------|-----------|------|------|----------|
| `scrape_timeline` | `x_action_scrape_timeline` | 抓取时间线推文 | `limit?: number` (默认10) | `{ tweets: [], count: number }` |
| `scrape_bookmarks` | `x_action_scrape_bookmarks` | 抓取书签 | `limit?: number` (默认20) | `{ bookmarks: [], count: number }` |
| `scrape_current_view` | `x_action_scrape_current_view` | 抓取当前视图 | 无 | `{ tweets: [], count: number }` |
| `scrape_search_results` | `x_action_scrape_search_results` | 抓取搜索结果 | `limit?: number` (默认20) | `{ tweets: [], count: number }` |
| `account_analytics` | `x_action_account_analytics` | 获取账户分析数据 | `fromTime: string` (必填, ISO格式), `toTime: string` (必填, ISO格式), `granularity?: 'Daily'\|'Weekly'\|'Monthly'` (默认Daily) | `{ followers: number, verifiedFollowers: string, timeSeries: [] }` |

**返回的推文数据结构**：
```typescript
interface Tweet {
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
}
```

**示例**：
```json
{
  "type": "tool_start",
  "name": "x_action_scrape_bookmarks",
  "input": {
    "limit": 30
  },
  "id": "call_scrape_001"
}
```

**前端返回结果**：
```json
{
  "role": "user",
  "content": [
    {
      "type": "action_result",
      "action_id": "scrape_bookmarks",
      "success": true,
      "data": {
        "bookmarks": [
          {
            "tweetId": "1234567890",
            "authorHandle": "elonmusk",
            "content": "Example tweet content...",
            "timestamp": "2025-01-15T10:30:00Z"
          }
        ],
        "count": 1
      }
    }
  ]
}
```

---

### 6. 通知类 (Notification)

| action_id | tool name | 描述 | 参数 |
|-----------|-----------|------|------|
| `process_notifications` | `x_action_process_notifications` | 处理通知 | `limit?: number` (默认3), `keywords?: string[]` |
| `click_notification` | `x_action_click_notification` | 点击特定通知 | `keywords?: string[]`, `highlight?: boolean` |

**示例**：
```json
{
  "type": "tool_start",
  "name": "x_action_process_notifications",
  "input": {
    "limit": 5,
    "keywords": ["回复", "提到"]
  },
  "id": "call_notif_001"
}
```

---

### 7. 搜索类 (Search) - 需要返回结果

| action_id | tool name | 描述 | 参数 |
|-----------|-----------|------|------|
| `advanced_search` | `x_action_advanced_search` | 高级搜索 | `query: string` (必填), `filters?: SearchFilters` |

**SearchFilters 结构**：
```typescript
interface SearchFilters {
  from?: string;        // 来自特定用户
  to?: string;          // @提及特定用户
  since?: string;       // 起始日期 YYYY-MM-DD
  until?: string;       // 结束日期 YYYY-MM-DD
  minReplies?: number;  // 最少回复数
  minLikes?: number;    // 最少点赞数
  minRetweets?: number; // 最少转发数
  hasMedia?: boolean;   // 包含媒体
  hasLinks?: boolean;   // 包含链接
  lang?: string;        // 语言代码
}
```

**示例**：
```json
{
  "type": "tool_start",
  "name": "x_action_advanced_search",
  "input": {
    "query": "AI agent",
    "filters": {
      "from": "elonmusk",
      "minLikes": 1000,
      "since": "2025-01-01",
      "hasMedia": true
    }
  },
  "id": "call_search_001"
}
```

生成的 Twitter 搜索语法：`AI agent from:elonmusk min_faves:1000 since:2025-01-01 filter:media`

---

### 8. 刷推类 (Scroll)

| action_id | tool name | 描述 | 参数 |
|-----------|-----------|------|------|
| `scroll_and_collect` | `x_action_scroll_and_collect` | 滚动并收集推文 | `count?: number` (默认10), `batch_size?: number` (默认5), `max_scrolls?: number` (默认20) |
| `continuous_scroll` | `x_action_continuous_scroll` | 持续滚动 | `stop_condition: 'count'|'time'|'noNew'` (必填), `max_duration?: number` (默认60000ms), `target_count?: number` (默认50) |

**示例**：
```json
{
  "type": "tool_start",
  "name": "x_action_continuous_scroll",
  "input": {
    "stop_condition": "count",
    "target_count": 100
  },
  "id": "call_scroll_001"
}
```

---

### 9. 复合类 (Composite)

复合 Action 由多个原子 Action 组成，自动按依赖顺序执行。

| action_id | tool name | 描述 | 包含步骤 |
|-----------|-----------|------|----------|
| `bookmark_summary` | `x_action_bookmark_summary` | 书签总结 | navigate → scrape → summarize |
| `reply_with_image` | `x_action_reply_with_image` | 带图回复 | navigate → open → fill → upload → submit |
| `search_and_analyze` | `x_action_search_and_analyze` | 搜索并分析 | search → scrape → analyze |
| `timeline_analysis` | `x_action_timeline_analysis` | 时间线分析 | scroll → analyze |
| `create_thread` | `x_action_create_thread` | 创建长推 | open → post_thread |
| `create_article` | `x_action_create_article` | 创建文章 | open → title → body → header → publish |

**示例 - 书签总结**：
```json
{
  "type": "tool_start",
  "name": "x_action_bookmark_summary",
  "input": {
    "limit": 20
  },
  "id": "call_composite_001"
}
```

---

## 超时配置

| 类别 | 默认超时 |
|------|----------|
| 导航类 | 10 秒 |
| 回复类 | 5-30 秒 |
| 发推类 | 60-120 秒 |
| 文章类 | 5-30 秒 |
| 抓取类 | 10-60 秒 |
| 通知类 | 10-60 秒 |
| 搜索类 | 15 秒 |
| 刷推类 | 120 秒 |
| 复合类 | 120-180 秒 |

---

## 错误处理

### 常见错误

| 错误信息 | 原因 | 解决方案 |
|----------|------|----------|
| `Unknown action: xxx` | action_id 不存在 | 检查 action_id 是否正确 |
| `缺少 xxx` | 必填参数未提供 | 补充 input 中的必填参数 |
| `xxx 未找到` | DOM 元素不存在 | 确保在正确的页面上 |
| `导航超时` | 页面加载过慢 | 重试或检查网络 |
| `发布按钮不可用` | 内容不符合要求 | 检查内容是否为空或过长 |

### 错误返回格式

前端通过 `action_result` 消息返回错误：
```json
{
  "role": "user",
  "content": [
    {
      "type": "action_result",
      "action_id": "scrape_bookmarks",
      "success": false,
      "data": {
        "error": "Unable to access bookmarks page",
        "reason": "User not logged in"
      }
    }
  ]
}
```

---

## 完整交互示例

### 场景：用户请求总结书签

**1. 用户发送请求**
```json
POST /api/v1/ai/agent-v2
{
  "messages": [
    { "role": "user", "content": "帮我总结最近的书签" }
  ]
}
```

**2. 后端返回 SSE 事件流**
```
data: {"type":"session_start","thread_id":"abc123"}

data: {"type":"content","content":"好的，让我获取您的书签..."}

data: {"type":"tool_start","name":"x_action_scrape_bookmarks","input":{"limit":20},"id":"call_xyz"}

data: {"type":"tool_end","name":"x_action_scrape_bookmarks","output":"已请求前端抓取书签...","id":"call_xyz"}

data: {"type":"content","content":"请稍等，正在等待浏览器插件获取您的书签数据..."}

data: {"type":"complete","usage":{"total_tokens":150}}
```

**3. 前端执行 DOM 操作并返回结果**
```json
POST /api/v1/ai/agent-v2
{
  "messages": [
    { "role": "user", "content": "帮我总结最近的书签" },
    { "role": "assistant", "content": "好的，让我获取您的书签...请稍等，正在等待浏览器插件获取您的书签数据..." },
    {
      "role": "user",
      "content": [
        {
          "type": "action_result",
          "action_id": "scrape_bookmarks",
          "success": true,
          "data": {
            "bookmarks": [...],
            "count": 20
          }
        }
      ]
    }
  ]
}
```

**4. 后端继续处理并返回总结**
```
data: {"type":"content","content":"根据您的 20 条书签，我发现以下主题..."}

data: {"type":"content","content":"\n\n1. **AI 技术**: 5 条相关推文...\n2. **加密货币**: 3 条相关推文..."}

data: {"type":"complete","usage":{"total_tokens":500}}
```

---

## 最佳实践

### 1. 组合使用 Action

对于复杂任务，推荐按顺序调用多个 Action：

```
1. x_action_navigate_to_bookmarks  # 先导航
2. x_action_scrape_bookmarks       # 再抓取（返回结果）
3. (后端处理数据)                   # AI 分析
4. x_action_navigate_to_tweet      # 导航到目标推文
5. x_action_fill_reply_text        # 填充回复
6. x_action_submit_reply           # 提交
```

### 2. 区分需要返回结果的 Action

- **需要返回结果**：抓取类、搜索类 - 前端必须发送 `action_result` 消息
- **无需返回结果**：导航类、回复类、发推类 - 前端只需执行，无需额外响应

### 3. 超时处理

建议为每个 Action 设置超时：

```typescript
async function executeWithTimeout(
  action: () => Promise<any>,
  timeoutMs: number = 30000
): Promise<any> {
  return Promise.race([
    action(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Action timeout')), timeoutMs)
    )
  ]);
}
```

---

## 文件结构

```
types/
└── action.ts                    # 类型定义

utils/
└── BookmarkScraper.ts           # 书签爬虫

services/
├── chatService.ts               # SSE 事件处理 + sendActionResult
├── actionExecutor.ts            # 执行器
├── actionRegistry.ts            # 注册表
├── actionIntegration.ts         # ChatPanel 集成
└── actions/
    ├── index.ts                 # 统一导出
    ├── navigationActions.ts     # 导航 handlers
    ├── replyActions.ts          # 回复 handlers
    ├── tweetActions.ts          # 发推 handlers
    ├── articleActions.ts        # 文章 handlers
    ├── scrapeActions.ts         # 抓取 handlers
    ├── notificationActions.ts   # 通知 handlers
    ├── searchActions.ts         # 搜索 handlers
    └── scrollActions.ts         # 刷推 handlers
```

---

## 版本历史

- **v0.3.13** (2025-01-15): 改用 tool_start + x_action_ 前缀机制，添加 action_result 返回
- **v0.3.12** (2025-01-15): 初始实现，包含 34 个 Action 定义
