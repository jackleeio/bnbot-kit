# HomeTimelineMonitor 技术文档

## 概述

`HomeTimelineMonitor` 是一个用于监听 Twitter/X 首页时间线的模块，能够实时捕获用户滚动时可见的推文数据，包括完整的用户信息（粉丝数、关注数、简介等）。

## 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        HomeTimelineMonitor                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   API 拦截    │    │  数据缓存     │    │  可见性检测   │      │
│  │  Interceptor │───▶│  tweetCache  │◀───│  Observer    │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────────────────────────────────────────────┐      │
│  │                   Console 输出                        │      │
│  │  { tweetId, username, followers, tweetText, ... }    │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. API 拦截器 (`timeline-interceptor.js`)

注入到页面中的脚本，拦截 Twitter 的 `fetch` 请求，捕获 HomeTimeline API 响应。

**工作原理：**
- 覆盖 `window.fetch` 方法
- 检测 URL 是否包含 `HomeTimeline`
- 解析响应 JSON 并通过 `postMessage` 发送给内容脚本

```javascript
// 拦截 fetch 请求
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const response = await originalFetch.apply(this, args);

  if (url.includes('HomeTimeline')) {
    const data = await response.clone().json();
    window.postMessage({
      type: 'BNBOT_TIMELINE_DATA',
      payload: data
    }, '*');
  }

  return response;
};
```

### 2. 数据缓存 (`tweetCache`)

使用 `Map<string, TimelineTweetData>` 存储解析后的推文数据。

```typescript
interface TimelineTweetData {
  tweetId: string;
  username: string;      // screen_name (如 mukakin1203)
  displayName: string;   // name (如 拳智(むかたん))
  followers: number;     // followers_count
  following: number;     // friends_count
  bio: string;           // description
  tweetText: string;     // full_text
  replyCount: number;
  retweetCount: number;
  likeCount: number;
  viewCount: number;
  createdAt: string;
}
```

### 3. 可见性检测 (`IntersectionObserver`)

监控推文元素何时进入视口。

```typescript
this.intersectionObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        this.onTweetElementVisible(entry.target);
      }
    }
  },
  { threshold: 0.5 }  // 50% 可见时触发
);
```

## 工作流程

```
用户打开"曝光预测"开关
        │
        ▼
┌───────────────────┐
│  1. start() 启动  │
└─────────┬─────────┘
          │
          ├──────────────────────────────────────┐
          │                                      │
          ▼                                      ▼
┌──────────────────┐                   ┌──────────────────┐
│ 注入 API 拦截器   │                   │ 设置 Observer    │
│ (fetch 拦截)      │                   │ (Intersection    │
└─────────┬────────┘                   │  + Mutation)     │
          │                            └────────┬─────────┘
          ▼                                     │
┌──────────────────┐                            │
│ 点击 Home 按钮    │◀───────────────────────────┘
│ (触发 API 刷新)   │
└─────────┬────────┘
          │
          ▼
┌──────────────────┐
│ Twitter 请求新的  │
│ HomeTimeline API │
└─────────┬────────┘
          │
          ▼
┌──────────────────┐
│ 拦截器捕获响应    │
│ 解析推文数据      │
│ 存入 tweetCache  │
└─────────┬────────┘
          │
          ▼
┌──────────────────┐
│ 用户滚动页面      │
│ Observer 检测可见 │
│ 从缓存读取输出    │
└──────────────────┘
```

## API 数据结构解析

Twitter HomeTimeline API 返回的数据结构：

```
data
└── home
    └── home_timeline_urt
        └── instructions[]
            └── entries[]
                └── content
                    └── itemContent
                        └── tweet_results
                            └── result
                                ├── rest_id (推文 ID)
                                ├── core
                                │   └── user_results
                                │       └── result
                                │           ├── core
                                │           │   ├── name (显示名)
                                │           │   └── screen_name (用户名)
                                │           ├── legacy
                                │           │   ├── followers_count
                                │           │   ├── friends_count
                                │           │   └── description
                                │           └── profile_bio
                                │               └── description
                                ├── legacy
                                │   ├── full_text (推文内容)
                                │   ├── created_at
                                │   ├── reply_count
                                │   ├── retweet_count
                                │   └── favorite_count
                                └── views
                                    └── count
```

### 数据提取映射

| 输出字段 | API 路径 | 说明 |
|---------|----------|------|
| `tweetId` | `tweet.rest_id` | 推文 ID |
| `username` | `userResult.core.screen_name` | @用户名 |
| `displayName` | `userResult.core.name` | 显示名称 |
| `followers` | `userResult.legacy.followers_count` | 粉丝数 |
| `following` | `userResult.legacy.friends_count` | 关注数 |
| `bio` | `userResult.legacy.description` | 用户简介 |
| `tweetText` | `tweetLegacy.full_text` | 推文内容 |
| `replyCount` | `tweetLegacy.reply_count` | 回复数 |
| `retweetCount` | `tweetLegacy.retweet_count` | 转发数 |
| `likeCount` | `tweetLegacy.favorite_count` | 点赞数 |
| `viewCount` | `tweet.views.count` | 浏览数 |
| `createdAt` | `tweetLegacy.created_at` | 发布时间 |

## 触发刷新机制

### triggerHomeRefresh()

通过模拟点击 Home 按钮来触发 Twitter 重新请求 API：

```typescript
private triggerHomeRefresh(): void {
  // 优先级 1: 导航栏 Home 按钮
  const homeLink = document.querySelector('a[data-testid="AppTabBar_Home_Link"]');
  if (homeLink) {
    homeLink.click();
    return;
  }

  // 优先级 2: X logo
  const xLogoLink = document.querySelector('header[role="banner"] h1 a[href="/home"]');
  if (xLogoLink) {
    xLogoLink.click();
    return;
  }

  // 优先级 3: header 中的 /home 链接
  const headerHomeLink = document.querySelector('header[role="banner"] a[href="/home"]');
  if (headerHomeLink) {
    headerHomeLink.click();
    return;
  }
}
```

## 文件结构

```
utils/
└── HomeTimelineMonitor.ts    # 主监控类

public/
└── timeline-interceptor.js   # 注入的 API 拦截脚本

manifest.json                 # 需要声明 web_accessible_resources
```

## manifest.json 配置

```json
{
  "web_accessible_resources": [
    {
      "resources": ["timeline-interceptor.js"],
      "matches": ["https://twitter.com/*", "https://x.com/*"]
    }
  ]
}
```

## 使用示例

```typescript
import { HomeTimelineMonitor } from './utils/HomeTimelineMonitor';

// 创建实例
const monitor = new HomeTimelineMonitor();

// 开启监控（用户打开"曝光预测"开关时）
monitor.start();

// 关闭监控（用户关闭开关或离开 /home 页面时）
monitor.stop();

// 手动刷新缓存
await monitor.refreshCache();

// 获取状态
console.log('是否运行中:', monitor.getIsRunning());
console.log('缓存大小:', monitor.getCacheSize());
```

## Console 输出示例

```javascript
[BNBot Timeline Monitor] Starting...
[BNBot Timeline Monitor] Clicking Home button to refresh timeline...
[BNBot Timeline Monitor] Interceptor script loaded
[BNBot Timeline Monitor] Cache updated, total tweets: 25
[BNBot Timeline] 当前可见推文: {
  tweetId: "2016726986052583846",
  username: "mukakin1203",
  displayName: "拳智(むかたん)",
  followers: 382870,
  following: 552,
  bio: "年中有休 29歳 自由業 年商150万 資産40万",
  tweetText: "Mercedes-Maybach SL 680 Monogram Series \n\n納車日本最速?",
  replyCount: 26,
  retweetCount: 30,
  likeCount: 296,
  viewCount: 26581,
  createdAt: "Thu Jan 29 04:15:57 +0000 2026"
}
```

## 优势

1. **完整数据**: 通过 API 获取完整用户信息，包括粉丝数、简介等
2. **无侵入性**: 不需要触发 hover card 或其他 UI 交互
3. **高性能**: 使用缓存机制，避免重复解析
4. **实时性**: IntersectionObserver 精确检测可见推文

## 限制

1. **依赖 API 结构**: 如果 Twitter 修改 API 响应格式，需要更新解析逻辑
2. **只在 /home 页面生效**: 其他页面（如搜索、个人主页）使用不同的 API
3. **需要触发刷新**: 首次打开开关时需要点击 Home 按钮获取初始数据

## 版本历史

| 版本 | 日期 | 改动 |
|------|------|------|
| 0.3.43 | 2026-01-29 | 支持转发推文解析，修复返回 /home 时滚动到顶部的问题 |
| 0.3.42 | 2026-01-29 | 集成曝光预测算法 v1.1，新增 URL 变化检测和 SPA 路由支持 |
| 0.3.41 | 2026-01-29 | 改用点击 Home 按钮触发 API 刷新，修复用户名解析 |
| 0.3.40 | 2026-01-28 | 初始实现：API 拦截 + IntersectionObserver |

## v0.3.43 新增功能

### 转发推文支持

转发推文（Retweet）现在能正确解析和预测：

```typescript
// 检查是否是转发推文
const retweetedResult = tweet?.legacy?.retweeted_status_result?.result;
const isRetweet = !!retweetedResult;

// 对于转发，使用原始推文的数据来预测
const targetTweet = isRetweet ? (retweetedResult?.tweet || retweetedResult) : tweet;

// 同时缓存转发 ID 和原始推文 ID
this.tweetCache.set(tweetId, tweetData);
if (isRetweet && targetTweet?.rest_id) {
  this.tweetCache.set(targetTweet.rest_id, tweetData);
}
```

### 保持滚动位置

从推文详情返回 /home 时，不再触发 Home 按钮点击刷新，避免滚动到顶部：

```typescript
/**
 * Start monitoring the timeline
 * @param skipRefresh - 如果为 true，不触发刷新（用于从详情页返回时）
 */
start(skipRefresh: boolean = false): void {
  // ...
  if (!skipRefresh) {
    this.triggerHomeRefresh();
  } else {
    console.log('[BNBot Timeline Monitor] Skipping refresh (returning from detail page)');
    this.logCurrentlyVisibleTweets();
  }
}
```

## v0.3.42 新增功能

### 曝光预测集成

推文可见时，除了输出推文数据，还会输出曝光预测：

```javascript
[BNBot Timeline] 当前可见推文: {
  tweetId: "2016726986052583846",
  username: "elonmusk",
  followers: 150000000,
  viewCount: 50000,
  ...
}
[BNBot Timeline] 📊 曝光预测: {
  预测范围: "800 - 2500",
  期望值: 1500,
  生命周期: "📈 accelerating",
  时机: "golden",
  评分: 85,
  渗透率: "0.03%",
  账号健康度: 1,
  蓝标受限: false,
  建议: "🔥 黄金时间！预计曝光 800 - 2.5k，立即评论！"
}
```

### SPA 路由支持

新增 URL 变化检测，解决从推文详情返回 /home 后 Monitor 不工作的问题：

```typescript
// URL 变化检测
private setupUrlChangeDetection(): void {
  this.urlCheckInterval = setInterval(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== this.lastUrl) {
      const isOnHome = currentUrl.includes('/home');
      if (isOnHome && !wasOnHome) {
        this.onReturnToHome();
      }
      this.lastUrl = currentUrl;
    }
  }, 500);
}

// 返回 /home 时的处理
private onReturnToHome(): void {
  setTimeout(() => {
    this.setupIntersectionObserver();
    this.setupMutationObserver();
    this.scanExistingTweets();
    this.logCurrentlyVisibleTweets();
  }, 500);
}
```

### Cache 更新后立即输出

Cache 更新后，立即扫描当前可见推文并输出预测：

```typescript
private handleApiData(data: any): void {
  // ... 解析数据 ...
  console.log(`[BNBot Timeline Monitor] Cache updated, total tweets: ${this.tweetCache.size}`);

  // 立即扫描当前可见的推文并输出预测
  this.logCurrentlyVisibleTweets();
}
```
