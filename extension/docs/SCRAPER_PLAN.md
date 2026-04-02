# Scraper Service 实现计划

BNBot 内置数据抓取服务，通过 `chrome.scripting.executeScript()` 和直接 HTTP fetch 获取各平台数据，替代 opencli 的 CDP 方案。不需要 `debugger` 权限。

## 实现方式说明

| 方式 | 说明 | 用于 |
|------|------|------|
| **PUBLIC** | background 直接 `fetch()`，无需开 tab | 公开 API、RSS |
| **COOKIE** | 开后台 tab → `chrome.scripting.executeScript({ world: 'MAIN' })` → 调内部 API | 需要登录态的站 |
| **DOM** | 同 COOKIE，但提取 DOM 而非调 API | 页面无内部 API，只能解析 HTML |
| **INTERCEPT** | 开 tab 等页面自己请求 API，拦截结果 | 需要页面主动触发请求的站 |

## 总览

| # | 平台 | 命令 | 方式 | 需要 tab | 状态 | host_permissions |
|---|------|------|------|----------|------|------------------|
| 1 | TikTok | search | COOKIE (内部 API) | 是 | ✅ 已实现 | `*://*.tiktok.com/*` ✅ |
| 2 | YouTube | search | COOKIE (InnerTube API) | 是 | ✅ 已实现 | `*://*.youtube.com/*` ✅ |
| 3 | HackerNews | search | PUBLIC (Algolia API) | 否 | 待实现 | 不需要 |
| 4 | Reddit | search | COOKIE (JSON API) | 是 | 待实现 | 需加 `*://*.reddit.com/*` |
| 5 | Bilibili | search | COOKIE (WBI 签名 API) | 是 | 待实现 | 需加 `*://*.bilibili.com/*` |
| 6 | 知乎 | search | COOKIE (v4 API) | 是 | 待实现 | 需加 `*://*.zhihu.com/*` |
| 7 | 小红书 | search | DOM 解析 | 是 | 待实现 | `*://*.xiaohongshu.com/*` ✅ |
| 8 | 雪球 | search | COOKIE (JSON API) | 是 | 待实现 | 需加 `*://*.xueqiu.com/*` |
| 9 | V2EX | hot | PUBLIC (JSON API) | 否 | 待实现 | 不需要 |
| 10 | Bloomberg | news | PUBLIC (RSS) | 否 | 待实现 | 不需要 |
| 11 | 微博 | search | DOM 解析 | 是 | 待实现 | 需加 `*://*.weibo.com/*` `*://s.weibo.com/*` |
| 12 | LinkedIn | search | HEADER (Voyager API) | 是 | 待实现 | 需加 `*://*.linkedin.com/*` |
| 13 | 即刻 | search | DOM + React fiber | 是 | 待实现 | 需加 `*://*.okjike.com/*` |
| 14 | Linux.do | search | COOKIE (JSON API) | 是 | 待实现 | 需加 `*://linux.do/*` |
| 15 | 豆瓣 | search | DOM 解析 | 是 | 待实现 | 需加 `*://*.douban.com/*` |
| 16 | Facebook | search | DOM 解析 | 是 | 待实现 | 需加 `*://*.facebook.com/*` |
| 17 | Instagram | search | COOKIE (内部 API) | 是 | 待实现 | 需加 `*://*.instagram.com/*` |
| 18 | Medium | search | DOM 解析 | 是 | 待实现 | 需加 `*://*.medium.com/*` |
| 19 | 新浪博客 | search | PUBLIC (Sina Search API) | 否 | 待实现 | 不需要 |
| 20 | Substack | search | PUBLIC (Substack API) | 否 | 待实现 | 不需要 |
| 21 | Google | search | DOM 解析 | 是 | 待实现 | 需加 `*://*.google.com/*` |
| 22 | 微信 | download | COOKIE (DOM 提取) | 是 | 待实现 | `*://mp.weixin.qq.com/*` ✅ |
| 23 | 36氪 | search | INTERCEPT (API 拦截) | 是 | 待实现 | 需加 `*://*.36kr.com/*` |
| 24 | Product Hunt | hot | INTERCEPT (DOM) | 是 | 待实现 | 需加 `*://*.producthunt.com/*` |
| 25 | ONES | tasks | COOKIE (内部 API) | 是 | 待实现 | 需加对应域名 |
| 26 | BBC | news | PUBLIC (RSS) | 否 | 待实现 | 不需要 |
| 27 | Apple Podcasts | search | PUBLIC (iTunes API) | 否 | 待实现 | 不需要 |
| 28 | 小宇宙 | podcast | PUBLIC (Next.js props) | 否 | 待实现 | 不需要 |
| 29 | Yahoo Finance | quote | COOKIE (API + DOM) | 是 | 待实现 | 需加 `*://*.yahoo.com/*` |
| 30 | 新浪财经 | news | PUBLIC (CJ API) | 否 | 待实现 | 不需要 |
| 31 | Spotify | search | PUBLIC (OAuth API) | 否 | 待实现 | 不需要 |
| 32 | StackOverflow | search | PUBLIC (SE API) | 否 | 待实现 | 不需要 |
| 33 | Wikipedia | search | PUBLIC (MediaWiki API) | 否 | 待实现 | 不需要 |

## 按优先级分批

### 第一批：PUBLIC API（不需要 tab，最简单）
直接在 background service worker 用 `fetch()` 调用公开 API，无需 host_permissions。

| 平台 | API | 返回数据 |
|------|-----|----------|
| HackerNews | `hn.algolia.com/api/v1/search` | title, points, author, comments, url |
| StackOverflow | `api.stackexchange.com/2.3/search/advanced` | title, score, answers, url |
| Wikipedia | `{lang}.wikipedia.org/w/api.php?action=query&list=search` | title, snippet, url |
| Apple Podcasts | `itunes.apple.com/search?media=podcast` | title, author, episodes, genre |
| Substack | `substack.com/api/v1/post/search` | title, author, date, url |
| 新浪博客 | `search.sina.com.cn/api/search` | title, author, date, url |
| 新浪财经 | `app.cj.sina.com.cn/api/news/pc` | time, content, views |
| V2EX | `v2ex.com/api/topics/hot.json` | title, replies, url |
| Bloomberg | `feeds.bloomberg.com` (RSS) | title, description, url |
| BBC | `feeds.bbci.co.uk/news/rss.xml` | title, description, url |

### 第二批：COOKIE API（需要 tab，调内部 API）
用 `chrome.scripting.executeScript({ world: 'MAIN' })` 在页面上下文调用内部 API。

| 平台 | 导航到 | 内部 API |
|------|--------|----------|
| Reddit | reddit.com | `/search.json?q=...` |
| Bilibili | bilibili.com | `/x/web-interface/wbi/search/type` |
| 知乎 | zhihu.com | `/api/v4/search_v3` |
| 雪球 | xueqiu.com | `/stock/search.json` |
| Instagram | instagram.com | `/web/search/topsearch/` |
| Linux.do | linux.do | `/search.json` |
| 即刻 | okjike.com | DOM + React fiber |

### 第三批：DOM 解析（需要 tab，解析页面 DOM）

| 平台 | 导航到 | 提取方式 |
|------|--------|----------|
| 小红书 | xiaohongshu.com/search_result | `.note-item` 元素 |
| 微博 | s.weibo.com/weibo?q=... | `.card-wrap` 元素 |
| 豆瓣 | search.douban.com | `.item-root` 元素 |
| Medium | medium.com/search | article 元素 |
| Google | google.com/search | `#rso` 容器 |
| Facebook | facebook.com/search/top | `[role="article"]` 元素 |

### 第四批：特殊处理

| 平台 | 说明 |
|------|------|
| LinkedIn | Voyager API + CSRF token |
| 36氪 | INTERCEPT 策略，需拦截 API 请求 |
| Product Hunt | INTERCEPT 策略 |
| 微信 | 文章下载，非搜索 |
| Yahoo Finance | API + DOM 混合 |
| Spotify | 需要 OAuth 授权 |
| ONES | 需要 team UUID |
| 小宇宙 | Next.js props 提取 |

## 需要新增的 host_permissions

```json
"host_permissions": [
  // 已有
  "*://*.tiktok.com/*",
  "*://*.youtube.com/*",
  "*://*.xiaohongshu.com/*",
  "*://mp.weixin.qq.com/*",
  // 需要新增
  "*://*.reddit.com/*",
  "*://*.bilibili.com/*",
  "*://*.zhihu.com/*",
  "*://*.xueqiu.com/*",
  "*://*.weibo.com/*",
  "*://s.weibo.com/*",
  "*://*.linkedin.com/*",
  "*://*.okjike.com/*",
  "*://linux.do/*",
  "*://*.douban.com/*",
  "*://*.facebook.com/*",
  "*://*.instagram.com/*",
  "*://*.medium.com/*",
  "*://*.google.com/*",
  "*://*.36kr.com/*",
  "*://*.producthunt.com/*",
  "*://*.yahoo.com/*"
]
```

注意：PUBLIC API 的平台不需要 host_permissions（background service worker 的 fetch 不受 CORS 限制）。

## 架构设计

```
services/
  scraperService.ts        # 通用基础设施（tab 池、executeScript 封装）
  scrapers/
    public/                # 不需要 tab 的抓取器
      hackernews.ts
      stackoverflow.ts
      wikipedia.ts
      ...
    browser/               # 需要 tab 的抓取器
      tiktok.ts
      youtube.ts
      reddit.ts
      ...
```

## 测试方法

Service Worker 控制台：
```js
// PUBLIC API（不开 tab）
searchHackerNews('AI', 5).then(r => console.table(r))

// COOKIE/DOM（开后台 tab）
searchTikTok('AI', 5).then(r => console.table(r))
searchYouTube('Claude Code', 5).then(r => console.table(r))
```
