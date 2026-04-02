# 书签总结功能实现文档

> 关于 Content Script 如何获取 Twitter cookie 和调用 API 的原理，请参阅 [Extension 架构文档](./EXTENSION_ARCHITECTURE.md)

## 概述

书签总结功能允许用户通过自然语言请求（如"总结我的书签，10条"）让 AI 分析并总结其 Twitter 书签内容。该功能使用 **interrupt/resume** 流程，后端触发前端执行书签抓取操作，然后将数据返回给后端进行 AI 分析。

## 架构设计

### 整体流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                           用户请求                                   │
│                    "总结我的书签，10条"                               │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     后端 Orchestrator                                │
│              识别意图 → 调用 x_action_scrape_bookmarks               │
│                    → interrupt() 暂停 LangGraph                      │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ SSE: interrupt 事件
┌─────────────────────────────────────────────────────────────────────┐
│                     前端 ChatPanel                                   │
│              onInterrupt() → executeAction()                         │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   scrapeBookmarksHandler                             │
│              TwitterClient.getAllBookmarks()                         │
│                    ↓ GraphQL API 请求                                │
│              解析数据 → 返回结构化结果                                │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   chatService.resumeGraph()                          │
│              POST /api/v1/ai/resume                                  │
│                    返回书签数据给后端                                 │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     后端 AI 分析                                     │
│              分析书签内容 → 生成总结                                  │
│                    → SSE 返回结果给前端                              │
└─────────────────────────────────────────────────────────────────────┘
```

## 核心实现

### 1. Twitter GraphQL API 调用

文件：`utils/TwitterClient.ts`

#### 1.1 API 端点

```
GET https://x.com/i/api/graphql/{queryId}/Bookmarks
```

#### 1.2 请求参数

```typescript
// variables
{
  count: 20,                    // 每页数量
  cursor: "HBaK1vC394SwujMAAA==", // 分页游标（可选）
  includePromotedContent: true
}

// features - 功能标志
{
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  // ... 更多功能标志
}
```

#### 1.3 请求头

```typescript
{
  'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D...',
  'x-csrf-token': '{从 cookie ct0 获取}',
  'x-twitter-active-user': 'yes',
  'x-twitter-auth-type': 'OAuth2Session',
  'x-twitter-client-language': 'en',
  'content-type': 'application/json'
}
```

#### 1.4 QueryID 动态提取

QueryID 会随 Twitter 版本更新而变化，因此需要动态提取：

```typescript
public static async extractConfigs(): Promise<void> {
    // 扫描页面上的 Twitter 脚本
    const scripts = Array.from(document.querySelectorAll('script[src]'));

    for (const script of scripts) {
        const src = (script as HTMLScriptElement).src;

        // 只检查 Twitter CDN 的脚本
        if (!src.includes('abs.twimg.com')) continue;

        const response = await fetch(src);
        const code = await response.text();

        // 使用正则提取 Bookmarks QueryID
        const matchBookmarks = code.match(/queryId:"([^"]+)",operationName:"Bookmarks"/);
        if (matchBookmarks && matchBookmarks[1]) {
            this.BOOKMARKS_QUERY_ID = matchBookmarks[1];
        }
    }
}
```

### 2. 数据结构

#### 2.1 API 响应结构

```json
{
  "data": {
    "bookmark_timeline_v2": {
      "timeline": {
        "instructions": [
          {
            "type": "TimelineAddEntries",
            "entries": [
              {
                "entryId": "tweet-2015296897410617609",
                "content": {
                  "itemContent": {
                    "tweet_results": {
                      "result": {
                        "rest_id": "2015296897410617609",
                        "core": {
                          "user_results": {
                            "result": {
                              "rest_id": "2940321003",
                              "core": {
                                "screen_name": "shiri_shh",
                                "name": "shirish"
                              },
                              "is_blue_verified": true
                            }
                          }
                        },
                        "legacy": {
                          "full_text": "推文内容...",
                          "favorite_count": 1992,
                          "retweet_count": 82,
                          "reply_count": 63,
                          "bookmark_count": 2605,
                          "created_at": "Sun Jan 25 05:33:17 +0000 2026"
                        },
                        "views": {
                          "count": "207242"
                        }
                      }
                    }
                  }
                }
              },
              {
                "entryId": "cursor-bottom-1853899834482627972",
                "content": {
                  "value": "HBaK1vC394SwujMAAA==",
                  "cursorType": "Bottom"
                }
              }
            ]
          }
        ]
      }
    }
  }
}
```

#### 2.2 前端输出结构

```typescript
interface BookmarksResult {
    tweets: Array<{
        id: string;
        text: string;
        author: {
            id: string;
            username: string;
            display_name: string;
            avatar: string;
            verified: boolean;
        };
        created_at: string;
        stats: {
            likes: number;
            retweets: number;
            replies: number;
            quotes: number;
            views: number;
            bookmarks: number;
        };
        media: Array<{
            type: 'image' | 'video' | 'gif';
            url: string;
            thumbnail?: string;
        }>;
        url: string;
    }>;
    nextCursor: string | null;
}
```

### 3. 分页处理

```typescript
public static async getAllBookmarks(
    limit: number = 20,
    onProgress?: (fetched: number, total: number) => void
): Promise<BookmarksResult['tweets']> {
    const allTweets: BookmarksResult['tweets'] = [];
    let cursor: string | undefined = undefined;
    let pageCount = 0;
    const maxPages = Math.ceil(limit / 20) + 1;

    while (allTweets.length < limit && pageCount < maxPages) {
        // 请求频率控制：分页请求间隔 1-1.5 秒
        if (pageCount > 0) {
            await new Promise(resolve =>
                setTimeout(resolve, 1000 + Math.random() * 500)
            );
        }

        const result = await this.getBookmarks(20, cursor);

        if (result.tweets.length === 0) break;

        allTweets.push(...result.tweets);
        onProgress?.(allTweets.length, limit);

        if (!result.nextCursor) break;

        cursor = result.nextCursor;
        pageCount++;
    }

    return allTweets.slice(0, limit);
}
```

### 4. Action Handler 实现

文件：`services/actions/scrapeActions.ts`

```typescript
export const scrapeBookmarksHandler: ActionHandler = async (params, callbacks, context) => {
  const { limit = 20 } = params as { limit?: number };
  callbacks.onProgress?.({} as any, '正在获取书签...');

  try {
    const tweets = await TwitterClient.getAllBookmarks(limit, (fetched, total) => {
      callbacks.onProgress?.({} as any, `已获取 ${fetched}/${total} 个书签`);
    });

    if (tweets.length === 0) {
      return { success: false, error: '未获取到书签数据，请确保已登录 Twitter' };
    }

    return {
      success: true,
      data: {
        tweets,
        count: tweets.length
      }
    };
  } catch (e) {
    console.error('[scrapeBookmarks] 获取失败:', e);
    return { success: false, error: e instanceof Error ? e.message : '获取书签失败' };
  }
};
```

### 5. Interrupt/Resume 流程

文件：`components/panels/ChatPanel.tsx`

```typescript
// SSE 事件处理
onInterrupt: (actionType, actionInput, threadId) => {
  console.log("[ChatPanel] Interrupt received:", actionType, threadId);

  // 执行 action
  executeAction(`action_${actionType}`, actionInput, {
    onProgress: (message) => {
      setMessages(prev => prev.map(msg =>
        msg.id === botMsgId ? { ...msg, actionStatus: message } : msg
      ));
    },
    onComplete: async (result) => {
      // 将结果发送回后端
      await chatService.resumeGraph(
        threadId,
        true,      // success
        result,    // data
        null,      // error
        callbacks,
        signal
      );
    },
    onError: async (error) => {
      // 错误时也需要 resume
      await chatService.resumeGraph(
        threadId,
        false,
        null,
        String(error),
        callbacks,
        signal
      );
    }
  });
}
```

### 6. Resume API 调用

文件：`services/chatService.ts`

```typescript
async resumeGraph(
    threadId: string,
    success: boolean,
    data: any,
    error: string | null,
    callbacks: ChatStreamCallback,
    signal?: AbortSignal
): Promise<void> {
    const requestBody = {
        thread_id: threadId,
        success,
        data,
        error,
    };

    const response = await authService.fetchStreamWithAuth(
        `${API_BASE_URL}/api/v1/ai/resume`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal,
        }
    );

    // 处理 SSE 响应流...
}
```

## 文件结构

```
├── utils/
│   └── TwitterClient.ts          # Twitter GraphQL API 客户端
│       ├── getBookmarks()        # 单页获取书签
│       ├── getAllBookmarks()     # 分页获取所有书签
│       ├── parseTweetResult()    # 解析推文数据
│       └── extractConfigs()      # 动态提取 QueryID
│
├── services/
│   ├── actions/
│   │   └── scrapeActions.ts      # 抓取类 Action 处理器
│   │       └── scrapeBookmarksHandler  # 书签抓取处理器
│   │
│   └── chatService.ts            # Chat 服务
│       ├── onInterrupt()         # 处理 interrupt 事件
│       └── resumeGraph()         # 发送结果回后端
│
├── components/panels/
│   └── ChatPanel.tsx             # Chat UI 组件
│       └── onInterrupt 回调处理
│
└── types/
    └── action.ts                 # Action 类型定义
        └── INTERRUPT_ACTIONS     # 包含 'scrape_bookmarks'
```

## 注意事项

### 1. 认证要求

- 书签 API 需要用户已登录 Twitter
- 使用当前 session 的 `ct0` cookie 作为 CSRF token
- 使用 `credentials: 'include'` 发送 cookie

### 2. 请求频率限制

- 分页请求间隔 1-1.5 秒随机延迟
- 避免触发 Twitter 的速率限制
- 最大页数限制防止无限循环

### 3. QueryID 更新

- QueryID 可能随 Twitter 版本更新而变化
- 使用动态提取机制自动获取最新 QueryID
- 提供静态默认值作为降级方案

### 4. 错误处理

- API 请求失败时返回空结果而非抛出异常
- 提供有意义的错误信息给用户
- 支持操作取消（通过 AbortController）

## 测试方法

### 使用 curl 模拟

```bash
# 1. 发送请求触发 interrupt
curl -X POST "http://localhost:8000/api/v1/ai/agent-v2" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "总结我的书签，10条"}'

# 2. 模拟前端返回数据
curl -X POST "http://localhost:8000/api/v1/ai/resume" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "thread_id": "YOUR_THREAD_ID",
    "success": true,
    "data": {
      "tweets": [...],
      "count": 10
    }
  }'
```

### 浏览器控制台测试

```javascript
// 测试 TwitterClient
await TwitterClient.init();
const result = await TwitterClient.getBookmarks(5);
console.log(result);

// 测试分页获取
const allBookmarks = await TwitterClient.getAllBookmarks(15, (fetched, total) => {
  console.log(`Progress: ${fetched}/${total}`);
});
console.log(allBookmarks);
```

## 更新历史

| 版本 | 日期 | 更改 |
|------|------|------|
| 0.3.33 | 2026-01-26 | 使用 GraphQL API 替代 DOM 抓取 |
