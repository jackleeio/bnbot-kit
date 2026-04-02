# BoostChecker 技术架构文档

本文档记录了 BNBOT 扩展在用户 Twitter 主页上检测 Boost 推文的技术实现原理。这些技术细节是通过逆向工程和实际调试摸索出来的，不是简单的 vibe coding 能实现的。

## 核心优势

> **🎯 无需第三方 Twitter API，无需官方授权**
>
> 这个方案的巧妙之处在于：直接利用用户已登录的 Twitter 会话，调用 Twitter 内部 GraphQL API。用户访问自己的主页时，我们跟随浏览器发起相同的请求，获取用户发布的所有推文（包括引用和转发）。
>
> 通过分析这些推文中被引用/转发的原推文 ID，我们可以知道**用户参与过哪些 Boost 活动**——完全不需要申请 Twitter Developer API，不需要 OAuth 授权流程，不需要付费的第三方服务。
>
> 这是一个**零成本、零授权**的解决方案。

## 目录

1. [问题背景](#问题背景)
2. [技术挑战](#技术挑战)
3. [解决方案概览](#解决方案概览)
4. [核心技术细节](#核心技术细节)
5. [反向查找机制](#反向查找机制)
6. [API 响应结构](#api-响应结构)
7. [完整工作流程](#完整工作流程)

---

## 问题背景

### 需求
当用户访问自己的 Twitter 主页（如 `x.com/jackleeio`）时，需要检测用户发布的**引用推文**和**转发推文**中，被引用/转发的原推文是否有活跃的 Boost 奖励。如果有，在推文卡片上显示 Boost 标记。

### 之前的方案（拦截方案）
注入 `interceptor.js` 到页面主世界，hook `window.fetch` 和 `XMLHttpRequest`，拦截 Twitter 的 `UserTweets` 请求响应。

### 问题
- **时机问题**: 直接刷新页面时，拦截器可能还没注入完成，导致错过首屏数据
- **跨世界通信复杂**: 需要 `postMessage` 在 MAIN world 和 content script 之间通信
- **消息缓冲**: 需要 buffer 机制缓存早期消息，等 BoostChecker 就绪后重放

---

## 技术挑战

### 1. 如何获取用户的 userId？

Twitter 的 GraphQL API 需要 `userId`（数字 ID），而不是 `username`（如 `jackleeio`）。

**尝试的方案**:
- ❌ 调用 `UserByScreenName` API → 返回 400 Bad Request（QueryID 过期）
- ✅ **从 DOM 提取**: Twitter 个人主页的 `profile_banners` 图片 URL 包含 userId

```html
<img src="https://pbs.twimg.com/profile_banners/1262375832112242691/1768052294/1500x500">
```

**提取方法**:
```typescript
const bannerImg = document.querySelector('img[src*="profile_banners"]');
const match = bannerImg.src.match(/profile_banners\/(\d+)\//);
const userId = match[1]; // "1262375832112242691"
```

### 2. 如何调用 Twitter 内部 GraphQL API？

Twitter 的 GraphQL API 需要：
- **QueryID**: 每个 API 端点有唯一的 QueryID，且会定期更新
- **Bearer Token**: 认证 token
- **CSRF Token**: 从 cookie `ct0` 获取
- **Features**: 大量的 feature flags

**动态提取 QueryID**:
```typescript
// 从 Twitter 页面脚本中提取
const scripts = document.querySelectorAll('script[src*="abs.twimg.com"]');
for (const script of scripts) {
    const code = await fetch(script.src).then(r => r.text());

    // 匹配 queryId:"xxx",operationName:"UserTweets"
    const match = code.match(/queryId:"([^"]+)",operationName:"UserTweets"/);
    if (match) {
        USER_TWEETS_QUERY_ID = match[1];
    }
}
```

### 3. API 响应路径不一致

Twitter API 响应结构有两种可能的路径：
- `data.user.result.timeline.timeline.instructions`
- `data.user.result.timeline_v2.timeline.instructions`

**解决方案**: 尝试两种路径
```typescript
let instructions = data.data?.user?.result?.timeline_v2?.timeline?.instructions;
if (!instructions) {
    instructions = data.data?.user?.result?.timeline?.timeline?.instructions;
}
```

### 4. 如何检测 Twitter 的分页请求？

用户滚动页面时，Twitter 会加载更多推文。我们需要跟随这些请求。

**尝试的方案**:
- ❌ 滚动监听 + 计算页面高度 → 不准确，Twitter 是 SPA
- ❌ 拦截 fetch/XHR → 内容脚本无法拦截页面的网络请求
- ✅ **PerformanceObserver**: 监听浏览器的资源加载

```typescript
const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
        const url = entry.name;
        if (url.includes('UserTweets') && url.includes(userId)) {
            // 提取 cursor 参数
            const cursorMatch = url.match(/cursor%22%3A%22([^%"&]+)/);
            if (cursorMatch) {
                // 延迟 300ms 后发起我们的请求
                setTimeout(() => loadTweetsWithCursor(cursor), 300);
            }
        }
    }
});
observer.observe({ entryTypes: ['resource'] });
```

**为什么延迟 300ms?**
- PerformanceObserver 在请求**发起时**触发，不是完成时
- 如果我们立即发请求，会和 Twitter 的请求竞争，可能触发 429 限流

### 5. 如何在引用推文卡片上注入 Badge？

引用推文的结构是：主推文包含一个 quote card，里面显示被引用的原推文。

**问题**: 我们检查的是原推文 ID（如 `2009633915292856374`），但需要在主推文（如 `2010060861856170205`）的 quote card 上注入 badge。

**解决方案**: 维护 `quoteMap` 映射

```typescript
// API 返回时构建映射
quoteMap: {
    "2010060861856170205": "2009633915292856374"  // 主推文 -> 被引用推文
}

// 注入 badge 时反向查找
for (const [mainId, quotedId] of quoteCache.entries()) {
    if (quotedId === tweetId) {
        // 找到主推文，在其 quote card 上注入 badge
        const mainTweet = document.querySelector(`a[href*="/status/${mainId}"]`);
        const quoteCard = mainTweet.closest('article').querySelector('div[role="link"]');
        injectBadge(quoteCard);
    }
}
```

---

## 核心技术细节

### Twitter GraphQL API 请求格式

```
GET https://x.com/i/api/graphql/{QueryID}/UserTweets
  ?variables={...}
  &features={...}
  &fieldToggles={...}
```

**Headers**:
```typescript
{
    'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAA...',
    'x-csrf-token': 'ct0_cookie_value',
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    'content-type': 'application/json'
}
```

**Variables**:
```json
{
    "userId": "1262375832112242691",
    "count": 20,
    "cursor": "DAABCgABG_LT...",  // 分页时传入
    "includePromotedContent": true,
    "withQuickPromoteEligibilityTweetFields": true,
    "withVoice": true,
    "withV2Timeline": true
}
```

**Features** (必须完整，否则返回 400):
```json
{
    "rweb_video_screen_enabled": false,
    "profile_label_improvements_pcf_label_in_post_enabled": true,
    "responsive_web_graphql_exclude_directive_enabled": true,
    // ... 30+ 个 feature flags
}
```

---

## 反向查找机制

这是整个方案中最巧妙的部分。

### 问题

当我们从 `check-tweets` API 得知某个推文 ID（如 `2009633915292856374`）有活跃 Boost 时，需要在页面上找到并标记它。但这个 ID 是**被引用的原推文**，而页面上显示的是用户发的**引用推文**（如 `2010060861856170205`）。

```
页面上显示的卡片结构：
┌─────────────────────────────────────┐
│ 引用推文 (ID: 2010060861856170205)    │
│ "It's time to build."               │
│ ┌─────────────────────────────────┐ │
│ │ 被引用推文 (ID: 2009633915292856374) │ ← 这个有 Boost！
│ │ @a16z: "It's time to build."    │ │
│ │ [视频]                           │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

直接用 `2009633915292856374` 在 DOM 中搜索是找不到的，因为引用卡片内部没有包含原推文的链接。

### 解决方案：quoteMap 反向查找

**第一步：构建映射表**

在调用 `getUserTweets` API 时，我们同时构建 `quoteMap`：

```typescript
// TwitterClient.ts - 解析 API 响应时
if (tweetResult.quoted_status_result?.result?.rest_id) {
    const quotedId = tweetResult.quoted_status_result.result.rest_id;
    result.quoteIds.push(quotedId);

    // 构建映射：主推文 ID -> 被引用推文 ID
    result.quoteMap[mainTweetId] = quotedId;
}

// 结果：
// quoteMap = { "2010060861856170205": "2009633915292856374" }
```

**第二步：填充本地缓存**

```typescript
// BoostChecker.ts - 收到 API 响应后
for (const [mainId, quotedId] of Object.entries(result.quoteMap)) {
    this.quoteCache.set(mainId, quotedId);
}

// quoteCache: Map {
//   "2010060861856170205" => "2009633915292856374"
// }
```

**第三步：反向查找并注入 Badge**

```typescript
// BoostChecker.ts - injectBadge() 方法
private injectBadge(tweetId: string): void {
    // 尝试直接查找（适用于转发等情况）
    let links = document.querySelectorAll(`a[href*="/status/${tweetId}"]`);

    // 如果找不到，说明是被引用推文，需要反向查找
    if (links.length === 0) {
        // 遍历 quoteCache，找到哪个主推文引用了这个 tweetId
        for (const [mainId, quotedId] of this.quoteCache.entries()) {
            if (quotedId === tweetId) {
                // 找到了！mainId 是引用推文，tweetId 是被引用推文
                console.log(`Reverse lookup: Main ${mainId} -> Quoted ${tweetId}`);

                // 通过主推文 ID 找到 DOM 元素
                const mainTweet = document.querySelector(`a[href*="/status/${mainId}"]`);
                const article = mainTweet.closest('article[data-testid="tweet"]');

                // 在 article 内部找到 Quote Card（引用卡片）
                const quoteCard = article.querySelector('div[role="link"][tabindex="0"]');

                // 在 Quote Card 右上角注入 Boost 标记
                this.injectQuoteBadge(quoteCard, tweetId);
                return;
            }
        }
    }
}
```

### 为什么这个方案巧妙？

1. **零额外请求** - 映射关系在获取推文时就已经拿到，不需要额外 API 调用
2. **O(n) 查找** - 虽然是遍历，但 quoteCache 通常只有几十条，性能无忧
3. **精准定位** - 通过主推文 ID 找到 article，再定位内部的 quote card，不会误注入

### 完整的数据流

```
API 响应                    本地缓存                     DOM 操作
────────                    ────────                     ────────

quoteMap: {                 quoteCache: Map {
  "主推文ID":                  "主推文ID" =>              找到主推文 article
    "被引用ID"                   "被引用ID"                    ↓
}                           }                            找到内部 quote card
     ↓                           ↓                            ↓
填充缓存 ──────────────────→ 反向查找 ──────────────────→ 注入 Badge
```

### 普通推文
```json
{
    "entryId": "tweet-2012807564602593606",
    "content": {
        "itemContent": {
            "tweet_results": {
                "result": {
                    "rest_id": "2012807564602593606",
                    "legacy": {
                        "full_text": "推文内容...",
                        "is_quote_status": false
                    }
                }
            }
        }
    }
}
```

### 引用推文
```json
{
    "entryId": "tweet-2010060861856170205",
    "content": {
        "itemContent": {
            "tweet_results": {
                "result": {
                    "rest_id": "2010060861856170205",  // 主推文 ID
                    "quoted_status_result": {
                        "result": {
                            "rest_id": "2009633915292856374"  // 被引用推文 ID
                        }
                    },
                    "legacy": {
                        "is_quote_status": true,
                        "quoted_status_id_str": "2009633915292856374"
                    }
                }
            }
        }
    }
}
```

### 分页 Cursor
```json
{
    "entryId": "cursor-bottom-2009972948271280228",
    "content": {
        "value": "DAABCgABG_LT-t8___ALAAIAAAA...",  // 下一页 cursor
        "cursorType": "Bottom"
    }
}
```

---

## 完整工作流程

```
┌─────────────────────────────────────────────────────────────────┐
│                     用户访问 x.com/jackleeio                      │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. BoostChecker.start()                                         │
│    - 从 profile_banners URL 提取 userId                          │
│    - 设置 PerformanceObserver 监听网络请求                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. TwitterClient.init()                                         │
│    - 扫描页面脚本，提取 QueryID 和 Bearer Token                   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. TwitterClient.getUserTweets(userId, 20)                      │
│    - 发起 UserTweets GraphQL 请求                                │
│    - 解析响应，提取 quoteIds, retweetOriginalIds, quoteMap       │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. 填充 quoteCache                                               │
│    - quoteCache.set("2010060861856170205", "2009633915292856374")│
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. boostService.checkTweets(quoteIds)                           │
│    - 发送到后端 API 检查哪些推文有活跃 Boost                       │
│    - 返回 active_tweet_ids: ["2009633915292856374"]              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. 标记已检查 + 缓存活跃 Boost                                    │
│    - checkedTweetIds.add("2009633915292856374")                 │
│    - activeBoostCache.add("2009633915292856374")                │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. injectBadge("2009633915292856374")                           │
│    - 反向查找: quoteCache 找到主推文 "2010060861856170205"        │
│    - 在主推文的 quote card 右上角注入 Boost 标记                  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 8. 用户滚动页面                                                  │
│    - PerformanceObserver 检测到 Twitter 发起新的 UserTweets 请求 │
│    - 提取 cursor，延迟 300ms 后发起我们的请求                     │
│    - 重复步骤 3-7                                                │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 9. IntersectionObserver (备用)                                   │
│    - 如果推文进入视口时还没被检查过，加入 pending 队列            │
│    - 如果已在 activeBoostCache 中，直接注入 badge                 │
│    - 不会重复发送 check-tweets 请求                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 关键代码位置

| 功能 | 文件 | 方法 |
|------|------|------|
| 提取 userId | `BoostChecker.ts` | `extractUserIdFromDOM()` |
| 动态提取 QueryID | `TwitterClient.ts` | `extractConfigs()` |
| 获取用户推文 | `TwitterClient.ts` | `getUserTweets()` |
| 监听 Twitter 分页 | `BoostChecker.ts` | `setupPerformanceObserver()` |
| 反向查找主推文 | `BoostChecker.ts` | `injectBadge()` |
| 注入 Quote Card Badge | `BoostChecker.ts` | `injectQuoteBadge()` |

---

## 经验总结

1. **不要依赖拦截器时机** - 内容脚本注入时机不可控，主动请求更可靠
2. **从 DOM 获取数据** - Twitter 页面上有很多隐藏的数据（profile_banners URL、React Fiber 等）
3. **动态提取 API 参数** - Twitter 的 QueryID 会更新，必须从页面脚本中提取
4. **PerformanceObserver 是利器** - 可以在内容脚本中监听页面的网络请求
5. **延迟跟随请求** - 避免和页面原生请求竞争，防止限流
6. **维护映射关系** - 引用推文需要知道主推文和被引用推文的对应关系

---

## 扩展应用：高级搜索

> **💡 这个技术方案可以扩展到更多场景**

### 当前应用：Boost 检测
- 浏览器端模拟 `UserTweets` API 获取用户推文
- 提取引用/转发的原推文 ID
- 发送到后端检查是否有 Boost 活动

### 未来应用：高级搜索
同样的技术可以用于实现**高级搜索**功能：

```
┌─────────────────────────────────────────────────────────────────┐
│                        浏览器端（插件）                           │
├─────────────────────────────────────────────────────────────────┤
│ 1. 模拟 Twitter SearchTimeline API                              │
│ 2. 获取搜索结果（推文列表）                                        │
│ 3. 将结果发送给后端 Gemini                                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        后端（Gemini）                            │
├─────────────────────────────────────────────────────────────────┤
│ 1. 接收搜索结果                                                  │
│ 2. AI 分析和处理                                                 │
│ 3. 只用第三方 Twitter API 做「行为验证」：                         │
│    - 检查用户是否转发了某条推文                                    │
│    - 检查用户是否引用了某条推文                                    │
│    - 检查用户是否评论了某条推文                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 优势

| 操作 | 传统方案 | 本方案 |
|------|----------|--------|
| 搜索推文 | 第三方 API（付费/限额） | 浏览器模拟请求（免费/无限） |
| 验证用户行为 | 第三方 API | 第三方 API（仅此处使用） |

**成本对比**：
- 传统方案：每次搜索消耗 API 配额 + 每次行为验证消耗 API 配额
- 本方案：搜索**零成本** + 仅行为验证消耗 API 配额

### 可复用的技术

1. **动态提取 QueryID** - `SearchTimeline` 的 QueryID 同样可以从页面脚本提取
2. **构造请求参数** - 复用 `getHeaders()` 方法获取认证信息
3. **解析响应结构** - Twitter 的 timeline 响应结构类似

### 示例：搜索 API 调用

```typescript
// 未来可以添加到 TwitterClient.ts
public static async searchTweets(query: string, count: number = 20): Promise<SearchResult> {
    await this.init();

    const variables = {
        rawQuery: query,
        count,
        querySource: "typed_query",
        product: "Latest"  // 或 "Top"
    };

    const url = `https://x.com/i/api/graphql/${this.SEARCH_QUERY_ID}/SearchTimeline?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders()
    });

    // 解析并返回搜索结果
    // 发送给后端 Gemini 进行 AI 分析
}
```

---

*最后更新: 2026-01-21*
