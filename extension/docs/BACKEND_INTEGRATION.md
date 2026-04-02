# Action 系统 - 后端接入文档

## 概述

Action 系统允许后端 AI 通过 SSE 事件触发前端插件执行 DOM 操作。

**重要区分**：
- `tool_call` / `tool_start` → 后端工具调用（如 `generate_image`、`search_tweets`）
- `x-action-call` → **前端插件 Action 调用**（如 `scrape_bookmarks`、`navigate_to_tweet`）

---

## SSE 事件格式

### 事件类型：`x-action-call`

后端需要发送以下格式的 SSE 事件：

```json
{
  "type": "x-action-call",
  "action_id": "scrape_bookmarks",
  "action_args": {
    "limit": 20
  }
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | ✅ | 固定为 `x-action-call` |
| `action_id` | string | ✅ | Action 标识符（见下方列表） |
| `action_args` | object | ❌ | Action 参数 |

### 备用字段（兼容性）

前端也支持以下备用字段格式：
- `name` 可替代 `action_id`
- `tool_args` 可替代 `action_args`

---

## 可用的 Action 列表

### 1. 导航类 (Navigation)

| action_id | 描述 | 参数 |
|-----------|------|------|
| `navigate_to_tweet` | 导航到推文详情页 | `tweetUrl: string` (必填) |
| `navigate_to_url` | SPA 导航到任意 URL | `url: string` (必填) |
| `navigate_to_bookmarks` | 导航到书签页 | 无 |
| `navigate_to_notifications` | 导航到通知页 | 无 |
| `navigate_to_search` | 导航到搜索页 | `query?: string` |
| `return_to_timeline` | 返回时间线 | 无 |

**示例**：
```json
{
  "type": "x-action-call",
  "action_id": "navigate_to_tweet",
  "action_args": {
    "tweetUrl": "https://x.com/elonmusk/status/1234567890"
  }
}
```

---

### 2. 回复类 (Reply)

| action_id | 描述 | 参数 |
|-----------|------|------|
| `open_reply_composer` | 打开回复编辑器 | 无 |
| `fill_reply_text` | 填充回复内容 | `content: string` (必填), `highlight?: boolean` |
| `upload_image_to_reply` | 上传图片到回复 | `imageData: string` (必填, base64) |
| `submit_reply` | 提交回复 | `waitForSuccess?: boolean` |

**示例**：
```json
{
  "type": "x-action-call",
  "action_id": "fill_reply_text",
  "action_args": {
    "content": "这是一条自动生成的回复！",
    "highlight": true
  }
}
```

---

### 3. 发推类 (Tweet)

| action_id | 描述 | 参数 |
|-----------|------|------|
| `open_tweet_composer` | 打开推文编辑器 | 无 |
| `post_tweet` | 发布单条推文 | `text: string` (必填), `media?: array` |
| `post_thread` | 发布线程（长推） | `tweets: array` (必填) |

**tweets 数组格式**：
```typescript
{ text: string; media?: Array<{ type: 'photo'|'video'; url?: string; base64?: string }> }
```

**示例**：
```json
{
  "type": "x-action-call",
  "action_id": "post_thread",
  "action_args": {
    "tweets": [
      { "text": "这是第一条推文 🧵" },
      { "text": "这是第二条推文" },
      { "text": "这是最后一条！" }
    ]
  }
}
```

---

### 4. 文章类 (Article)

| action_id | 描述 | 参数 |
|-----------|------|------|
| `open_article_editor` | 打开文章编辑器 | 无 |
| `fill_article_title` | 填充文章标题 | `title: string` (必填) |
| `fill_article_body` | 填充文章正文 | `content: string` (必填), `format?: 'plain'|'markdown'|'html'` |
| `upload_article_header_image` | 上传文章头图 | `imageData: string` (必填, base64) |
| `publish_article` | 发布文章 | `asDraft?: boolean` |

---

### 5. 抓取类 (Scrape)

| action_id | 描述 | 参数 | 返回数据 |
|-----------|------|------|----------|
| `scrape_timeline` | 抓取时间线推文 | `limit?: number` (默认10) | `{ tweets: [], count: number }` |
| `scrape_bookmarks` | 抓取书签 | `limit?: number` (默认20) | `{ bookmarks: [], count: number }` |
| `scrape_current_view` | 抓取当前视图 | 无 | `{ tweets: [], count: number }` |
| `scrape_search_results` | 抓取搜索结果 | `limit?: number` (默认20) | `{ tweets: [], count: number }` |

**示例 - 书签总结场景**：
```json
{
  "type": "x-action-call",
  "action_id": "scrape_bookmarks",
  "action_args": {
    "limit": 30
  }
}
```

**返回的推文数据结构**：
```typescript
interface ScrapedTweet {
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

---

### 6. 通知类 (Notification)

| action_id | 描述 | 参数 |
|-----------|------|------|
| `process_notifications` | 处理通知 | `limit?: number` (默认3), `keywords?: string[]` |
| `click_notification` | 点击特定通知 | `keywords?: string[]`, `highlight?: boolean` |

---

### 7. 搜索类 (Search)

| action_id | 描述 | 参数 |
|-----------|------|------|
| `advanced_search` | 高级搜索 | `query: string` (必填), `filters?: SearchFilters` |

**SearchFilters**：
```typescript
{
  from?: string;        // 来自特定用户
  to?: string;          // @提及特定用户
  since?: string;       // YYYY-MM-DD
  until?: string;       // YYYY-MM-DD
  minReplies?: number;
  minLikes?: number;
  minRetweets?: number;
  hasMedia?: boolean;
  hasLinks?: boolean;
  lang?: string;
}
```

**示例**：
```json
{
  "type": "x-action-call",
  "action_id": "advanced_search",
  "action_args": {
    "query": "AI agent",
    "filters": {
      "from": "elonmusk",
      "minLikes": 1000,
      "since": "2025-01-01"
    }
  }
}
```

---

### 8. 刷推类 (Scroll)

| action_id | 描述 | 参数 |
|-----------|------|------|
| `scroll_and_collect` | 滚动并收集推文 | `count?: number`, `batchSize?: number`, `maxScrolls?: number` |
| `continuous_scroll` | 持续滚动 | `stopCondition: 'count'|'time'|'noNew'`, `targetCount?: number`, `maxDuration?: number` |

---

### 9. 复合类 (Composite)

复合 Action 自动按顺序执行多个步骤：

| action_id | 描述 | 包含步骤 |
|-----------|------|----------|
| `bookmark_summary` | 书签总结 | navigate → scrape → summarize |
| `reply_with_image` | 带图回复 | navigate → open → fill → upload → submit |
| `search_and_analyze` | 搜索并分析 | search → scrape → analyze |
| `timeline_analysis` | 时间线分析 | scroll → analyze |
| `create_thread` | 创建长推 | open → post_thread |
| `create_article` | 创建文章 | open → title → body → header → publish |

---

## 使用场景示例

### 场景 1：书签总结

用户说："总结我的书签"

后端 AI 流程：
1. 发送 `x-action-call` 触发书签抓取
2. 等待前端返回抓取的书签数据
3. AI 分析并总结内容
4. 返回总结给用户

```json
{
  "type": "x-action-call",
  "action_id": "scrape_bookmarks",
  "action_args": { "limit": 20 }
}
```

### 场景 2：自动回复推文

用户说："帮我回复这条推文"

后端 AI 流程：
1. 生成回复内容
2. 发送导航 Action
3. 发送填充回复 Action
4. 发送提交回复 Action

```json
// Step 1
{ "type": "x-action-call", "action_id": "navigate_to_tweet", "action_args": { "tweetUrl": "..." } }

// Step 2
{ "type": "x-action-call", "action_id": "fill_reply_text", "action_args": { "content": "生成的回复内容" } }

// Step 3
{ "type": "x-action-call", "action_id": "submit_reply", "action_args": {} }
```

### 场景 3：高级搜索

用户说："搜索最近关于 AI 的热门推文"

```json
{
  "type": "x-action-call",
  "action_id": "advanced_search",
  "action_args": {
    "query": "AI",
    "filters": {
      "minLikes": 1000,
      "since": "2025-01-01",
      "lang": "zh"
    }
  }
}
```

---

## 注意事项

1. **必须在 Twitter/X 页面上执行**：Action 依赖 Twitter DOM，用户必须在 x.com 页面上
2. **异步执行**：Action 是异步的，结果通过回调返回
3. **超时保护**：每个 Action 有超时限制（5秒-180秒不等）
4. **可取消**：长时间运行的 Action 可以被取消
5. **进度反馈**：前端会实时报告执行进度

---

## 版本

- **v0.3.12** (2025-01-15): 初始实现，包含 34 个 Action
