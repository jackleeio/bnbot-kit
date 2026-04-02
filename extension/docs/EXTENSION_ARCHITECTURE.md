# Chrome Extension 架构与通信机制

## 概述

BNBOT 是一个 Chrome Extension，包含两个核心运行环境：**Background Script** 和 **Content Script**。它们各有不同的能力和限制，通过 Chrome 消息机制互相通信。

## 架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Chrome Extension                                   │
│                                                                              │
│  ┌────────────────────────┐                    ┌────────────────────────┐   │
│  │   Background Script    │  chrome.runtime   │    Content Script      │   │
│  │   (background.ts)      │◄─────────────────►│    (index.tsx)         │   │
│  │                        │   .sendMessage()   │                        │   │
│  │  - 独立运行            │   .onMessage       │  - 注入到 x.com 页面   │   │
│  │  - Service Worker      │                    │  - Shadow DOM 隔离     │   │
│  │  - 有完整网络权限      │                    │  - 可访问页面 DOM      │   │
│  │  - 可跨域请求          │                    │  - 可读取页面 cookie   │   │
│  └───────────┬────────────┘                    └───────────┬────────────┘   │
│              │                                             │                │
│              ▼                                             ▼                │
│     ┌─────────────────┐                         ┌─────────────────────┐     │
│     │  BNBOT API      │                         │  Twitter API        │     │
│     │  api.bnbot.ai   │                         │  x.com/i/api/...    │     │
│     │  (跨域请求)     │                         │  (同域请求)         │     │
│     └─────────────────┘                         └─────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 两种 Script 的能力对比

| 能力                      | Content Script | Background Script |
|---------------------------|----------------|-------------------|
| 访问页面 DOM              | ✅             | ❌                |
| 读取页面 cookie           | ✅             | ❌ (需用 chrome.cookies API) |
| 向同域发请求 (x.com)      | ✅ 自动带 cookie | ✅ 但无法带页面 cookie |
| 向跨域发请求              | ❌ 受 CORS 限制 | ✅ 有 host_permissions |
| 持久运行                  | ❌ 随页面销毁   | ✅ Service Worker |
| 使用 Chrome Extension API | 部分           | 全部              |

## 消息通信机制

### Content Script → Background Script

```typescript
// Content Script 发送消息
const response = await chrome.runtime.sendMessage({
    type: 'API_REQUEST',
    url: 'https://api.bnbot.ai/api/v1/ai/chat',
    options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }
});

if (response.success) {
    console.log('API 响应:', response.data);
} else {
    console.error('API 错误:', response.error);
}
```

### Background Script 处理请求

```typescript
// background.ts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'API_REQUEST') {
        // Background Script 可以跨域请求
        fetch(message.url, message.options)
            .then(res => res.json())
            .then(data => sendResponse({ success: true, data }))
            .catch(err => sendResponse({ success: false, error: err.message }));

        return true; // 重要！保持消息通道开放，等待异步响应
    }
});
```

## Twitter API 认证机制

### 为什么 Content Script 可以调用 Twitter 内部 API？

Content Script 被注入到 `x.com` 页面中，与 Twitter 原生代码运行在同一个页面上下文：

```
┌─────────────────────────────────────────────────────────────────┐
│                        x.com 页面                                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Twitter 原生代码                                          │   │
│  │  - 用户已登录                                              │   │
│  │  - 浏览器存储了 session cookie                             │   │
│  │  - 浏览器存储了 ct0 (CSRF token) cookie                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  BNBOT Content Script (注入到同一页面)                     │   │
│  │  - 可以访问 document.cookie ✅                            │   │
│  │  - 可以发送 fetch 请求并携带 cookie ✅                    │   │
│  │  - 对 Twitter 来说就像是页面上的正常 JavaScript           │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 获取 CSRF Token (ct0)

```typescript
// 从 document.cookie 读取 ct0 cookie
private static getCsrfToken(): string {
    const cookies = document.cookie.split('; ');
    const ct0Cookie = cookies.find(row => row.startsWith('ct0='));
    if (ct0Cookie) {
        return ct0Cookie.split('=')[1];
    }
    throw new Error('未找到 ct0 cookie，请确保已登录 Twitter');
}
```

**为什么能读取？**
- Content Script 运行在 `x.com` 页面的上下文中
- `document.cookie` 返回当前域名下所有**非 HttpOnly** 的 cookie
- Twitter 的 `ct0` cookie 不是 HttpOnly，所以可以被 JavaScript 读取

### 携带 Session Cookie

```typescript
// 发送请求时携带 cookie
const response = await fetch('https://x.com/i/api/graphql/xxx/Bookmarks', {
    method: 'GET',
    headers: {
        'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAA...',
        'x-csrf-token': this.getCsrfToken(),
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
        'content-type': 'application/json'
    },
    credentials: 'include'  // ← 关键！
});
```

**`credentials: 'include'` 的作用：**
- 告诉浏览器："请携带该域名的所有 cookie"
- 因为我们是在 `x.com` 页面上发起请求到 `x.com/i/api/...`（同域）
- 浏览器会自动附加所有 cookie，**包括 HttpOnly 的 session cookie**

### 认证信息汇总

| 认证信息 | 获取方式 | 原理 |
|----------|----------|------|
| `ct0` (CSRF Token) | `document.cookie` | Content Script 可读取当前域名的非 HttpOnly cookie |
| Session Cookie | `credentials: 'include'` | 同域请求，浏览器自动携带所有 cookie（包括 HttpOnly） |
| Bearer Token | 硬编码 | Twitter 公开的 API Bearer Token，所有客户端相同 |

### 前提条件

**用户必须已经在 Twitter 登录**，否则这些 cookie 不存在，API 请求会返回 401 错误。

## 动态提取 Twitter QueryID

Twitter GraphQL API 的 QueryID 会随版本更新而变化，需要动态提取：

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

        // 使用正则提取各种 QueryID
        const patterns = [
            { regex: /queryId:"([^"]+)",operationName:"Bookmarks"/, key: 'BOOKMARKS' },
            { regex: /queryId:"([^"]+)",operationName:"UserTweets"/, key: 'USER_TWEETS' },
            { regex: /queryId:"([^"]+)",operationName:"TweetDetail"/, key: 'TWEET_DETAIL' },
        ];

        for (const { regex, key } of patterns) {
            const match = code.match(regex);
            if (match && match[1]) {
                this.QUERY_IDS[key] = match[1];
            }
        }
    }
}
```

## 实际应用场景

### 场景 1: 调用 BNBOT AI API（跨域）

```
用户输入消息
    │
    ▼
Content Script (ChatPanel.tsx)
    │ chrome.runtime.sendMessage()
    ▼
Background Script (background.ts)
    │ fetch('https://api.bnbot.ai/...')
    ▼
BNBOT 后端 API
    │
    ▼
返回 AI 响应
```

### 场景 2: 抓取 Twitter 书签（同域）

```
用户请求 "总结我的书签"
    │
    ▼
Content Script (TwitterClient.ts)
    │ fetch('https://x.com/i/api/graphql/.../Bookmarks')
    │ credentials: 'include' (自动带 cookie)
    ▼
Twitter GraphQL API
    │
    ▼
返回书签数据
```

### 场景 3: 下载视频（跨域 + 二进制）

```
需要下载 YouTube/TikTok 视频
    │
    ▼
Content Script
    │ chrome.runtime.sendMessage({ type: 'FETCH_VIDEO', url: '...' })
    ▼
Background Script
    │ fetch(url) → arrayBuffer
    ▼
返回二进制数据给 Content Script
```

## 相关文件

| 文件 | 作用 |
|------|------|
| `background.ts` | Service Worker，处理跨域请求和 OAuth |
| `index.tsx` | Content Script 入口，注入 React 应用 |
| `services/authService.ts` | 认证服务，封装消息通信 |
| `utils/TwitterClient.ts` | Twitter API 客户端，直接调用同域 API |
| `manifest.json` | 扩展配置，定义权限和脚本 |

## 安全注意事项

1. **不要在 Content Script 中存储敏感信息** - 页面上的恶意脚本可能访问到
2. **Background Script 的 API 密钥** - 存储在 Background Script 中，Content Script 无法直接访问
3. **CORS 限制** - 跨域请求必须通过 Background Script 代理
4. **用户授权** - 所有 Twitter API 调用都依赖用户已登录，扩展本身不存储 Twitter 凭据

## 更新历史

| 版本 | 日期 | 更改 |
|------|------|------|
| 1.0 | 2026-01-27 | 初始文档，记录通信架构和认证机制 |
