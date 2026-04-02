# BNBOT 远程控制与自动化系统 (扩展端)

## 概述

本文档描述 BNBOT 扩展端的远程控制与自动化系统，包含以下核心功能：

| 功能 | 描述 |
|------|------|
| **Telegram 远程控制** | 通过 Telegram 发送自然语言指令控制扩展 |
| **定时发推** | 接收后端定时任务指令，自动发布推文 |
| **活动报告** | 自动统计自动回复活动，定期发送报告 |
| **统一会话上下文** | AI 记住最近回复，避免风格重复 |
| **WebSocket 通信** | 与后端保持实时双向连接 |

**核心理念**：Telegram 就是另一个 ChatPanel，用户在 Telegram 发的消息等同于在扩展输入框发送消息，复用同一套 AI + Tool Calling 系统。

---

## 架构图

```
┌────────────────┐                              ┌─────────────────────────────┐
│    Telegram    │                              │      Chrome Extension       │
│   用户发消息   │                              │                             │
└───────┬────────┘                              │  ┌───────────────────────┐  │
        │                                       │  │   CommandService      │  │
        ▼                                       │  │   (WebSocket Client)  │  │
┌────────────────┐                              │  └───────────┬───────────┘  │
│  Telegram API  │                              │              │              │
│    Webhook     │                              │              ▼              │
└───────┬────────┘                              │  ┌───────────────────────┐  │
        │                                       │  │   chatService.send()  │  │
        ▼                                       │  │   (复用现有 AI 系统)  │  │
┌────────────────────────────────┐              │  └───────────┬───────────┘  │
│            后端                │              │              │              │
│  ┌──────────────────────────┐  │   WebSocket  │              ▼              │
│  │   WebSocket Server       │  │ ◄──────────► │  ┌───────────────────────┐  │
│  │   - 用户连接池           │  │              │  │   AI + Tool Calling   │  │
│  │   - 消息双向转发         │  │              │  │   ActionExecutor      │  │
│  └──────────────────────────┘  │              │  └───────────┬───────────┘  │
│  ┌──────────────────────────┐  │              │              │              │
│  │   Celery 定时任务        │  │              │              ▼              │
│  │   - 定时发推检查         │  │              │     执行 Twitter 操作      │
│  │   - 定期报告触发         │  │              │                             │
│  └──────────────────────────┘  │              └─────────────────────────────┘
└────────────────────────────────┘
```

---

## 新增文件

### 1. `services/commandService.ts`

WebSocket 客户端，负责与后端保持长连接。

```typescript
// 核心接口
interface CommandMessage {
  type: 'chat' | 'command' | 'heartbeat_ack';
  requestId?: string;
  content?: string;
  action?: string;
  payload?: any;
  from?: string;
}

// 主要方法
class CommandService {
  // 连接到后端 WebSocket
  async connect(): Promise<boolean>;

  // 断开连接
  disconnect(): void;

  // 发送消息
  send(message: object): boolean;

  // 发送聊天响应（返回给 Telegram）
  sendChatResponse(requestId: string, content: string, success: boolean): void;

  // 发送命令执行结果
  sendCommandResult(requestId: string, action: string, success: boolean, result?: string): void;

  // 发送报告
  sendReport(report: object): void;

  // 检查连接状态
  isConnected(): boolean;
}
```

**连接流程**：
1. 获取用户 session（authService.getUser/getAccessToken）
2. 构建 WebSocket URL：`wss://api.bnbot.com/ws/{userId}?token={accessToken}`
3. 建立连接，启动心跳（30秒间隔）
4. 监听消息，根据类型分发处理

**消息处理**：
- `chat` 类型：Telegram 聊天消息 → 调用 chatService 处理 → 返回结果
- `command` 类型：直接执行命令（post_tweet, start_autopilot 等）
- `heartbeat_ack`：心跳确认

**重连机制**：
- 最大重试 5 次
- 指数退避：3s → 6s → 9s → 12s → 15s

---

### 2. `services/reportService.ts`

报告生成服务，跟踪自动回复活动并生成统计报告。

```typescript
interface ReportData {
  periodStart: string;
  periodEnd: string;
  tweetsScanned: number;
  repliesPosted: number;
  repliesSkipped: number;
  replies: ReplyRecord[];
}

interface ReplyRecord {
  authorHandle: string;
  tweetPreview: string;
  replyContent: string;
  score: number;
  timestamp: string;
}

class ReportService {
  // 记录扫描
  recordScan(): void;

  // 记录成功回复
  recordReply(authorHandle: string, tweetPreview: string, replyContent: string, score: number): void;

  // 记录跳过
  recordSkip(): void;

  // 生成报告数据
  generateReport(): ReportData;

  // 发送报告到后端（通过 WebSocket）
  sendReport(): void;

  // 重置统计
  reset(): void;
}
```

**使用方式**：在 autoReplyService 中自动调用

```typescript
// autoReplyService.ts 中的集成
import { reportService } from './reportService';

// 扫描时
reportService.recordScan();

// 回复时
reportService.recordReply(handle, preview, content, score);

// 跳过时
reportService.recordSkip();
```

---

## 修改文件

### 1. `utils/ReplyGenerator.ts`

添加回复历史上下文，避免 AI 生成重复风格的回复。

```typescript
// 新增接口
interface RecentReply {
  authorHandle: string;
  content: string;
}

// 新增属性和方法
class ReplyGenerator {
  private recentReplies: RecentReply[] = [];
  private readonly MAX_RECENT_REPLIES = 5;

  // 记录回复
  recordReply(authorHandle: string, content: string): void {
    this.recentReplies.push({ authorHandle, content });
    if (this.recentReplies.length > this.MAX_RECENT_REPLIES) {
      this.recentReplies.shift();
    }
  }

  // 清除历史
  clearHistory(): void {
    this.recentReplies = [];
  }
}
```

**Prompt 增强**：

```
IMPORTANT - Your Recent Replies (avoid similar styles/openings):
1. @user1: "Great point! I think..."
2. @user2: "This is interesting..."
3. @user3: "Love this perspective..."

DO NOT start with similar phrases. Vary your tone, structure, and opening.
```

---

### 2. `services/autoReplyService.ts`

集成 reportService 进行自动统计。

```typescript
// 在评估循环中
reportService.recordScan();

// 在回复成功后
reportService.recordReply(
  tweet.authorHandle,
  tweet.text.substring(0, 50),
  generatedReply,
  evaluationScore
);

// 在跳过时
reportService.recordSkip();
```

---

### 3. `App.tsx`

启动时自动连接 CommandService。

```typescript
useEffect(() => {
  // 初始化 CommandService
  commandService.init({
    onConnected: () => console.log('Command service connected'),
    onDisconnected: () => console.log('Command service disconnected'),
    onError: (error) => console.error('Command service error:', error)
  });

  // 登录后自动连接
  if (isAuthenticated) {
    commandService.connect();
  }

  return () => {
    commandService.disconnect();
  };
}, [isAuthenticated]);
```

---

## 支持的命令

| 用户输入示例 | 解析结果 | 执行方法 |
|-------------|----------|----------|
| "帮我发一条推：今天天气不错" | `post_tweet` | `tweetPoster.postThread()` |
| "开始自动回复" | `start_autopilot` | `autoReplyService.start()` |
| "停止" | `stop_autopilot` | `autoReplyService.stop()` |
| "现在状态怎么样" | `get_status` | 返回运行状态 |
| "生成报告" | `generate_report` | `reportService.sendReport()` |

---

## 消息协议

### 扩展接收

```typescript
// 聊天消息（来自 Telegram）
{
  type: 'chat',
  requestId: 'uuid',
  content: '帮我发一条推文',
  from: 'telegram'
}

// 命令（来自定时任务）
{
  type: 'command',
  requestId: 'uuid',
  action: 'post_tweet',
  payload: {
    content: '推文内容',
    images: []
  }
}
```

### 扩展发送

```typescript
// 聊天响应
{
  type: 'chat_response',
  requestId: 'uuid',
  content: '已发送推文',
  success: true
}

// 命令结果
{
  type: 'command_result',
  requestId: 'uuid',
  action: 'post_tweet',
  success: true,
  result: '✅ Tweet posted'
}

// 报告
{
  type: 'report',
  report: {
    periodStart: '2024-01-15T10:00:00Z',
    periodEnd: '2024-01-15T16:00:00Z',
    tweetsScanned: 150,
    repliesPosted: 12,
    repliesSkipped: 138,
    replies: [...]
  }
}
```

---

## 依赖关系

```
commandService
  ├── authService (获取用户凭证)
  ├── chatService (处理自然语言)
  ├── autoReplyService (自动回复控制)
  ├── reportService (报告生成)
  └── tweetPoster (发推执行)

reportService
  └── commandService (发送报告)

autoReplyService
  ├── reportService (记录统计)
  └── replyGenerator (回复生成 + 历史)
```

---

## 功能详解

### 1. Telegram 远程控制

用户通过 Telegram 发送消息，扩展接收并处理：

```
用户 Telegram 消息: "帮我发一条推文：今天天气不错"
    ↓
Telegram Bot API Webhook
    ↓
后端接收 → 查找用户 → 检查扩展在线
    ↓
WebSocket 推送给扩展
    ↓
commandService 接收 → chatService 处理
    ↓
AI 解析意图 → 执行 post_tweet action
    ↓
tweetPoster.postThread() 发布推文
    ↓
结果通过 WebSocket 返回后端
    ↓
后端发送 Telegram 消息给用户: "✅ 推文已发送"
```

**支持的自然语言指令**：
- "帮我发一条推文：xxx" → 发布推文
- "开始自动回复" → 启动 autopilot
- "停止" → 停止 autopilot
- "查看状态" → 返回当前运行状态
- "生成报告" → 发送活动报告

---

### 2. 定时发推

后端 Celery 定时任务检查 TweetDraft 表，发现待发送的定时推文后推送指令：

```
Celery Beat (每分钟)
    ↓
check_scheduled_posts 任务
    ↓
查询 TweetDraft (publish_status="scheduled", scheduled_at <= now)
    ↓
检查用户扩展是否在线
    ↓
[在线] WebSocket 发送 command: post_tweet
    ↓
扩展执行 tweetPoster.postThread()
    ↓
返回结果，更新 draft 状态

[离线] 通过 Telegram 通知用户
```

**扩展端执行流程** (`commandService.ts`):

```typescript
private async executePostTweet(payload: any): Promise<string> {
  const { content, images } = payload || {};
  if (!content) throw new Error('No tweet content provided');

  const { tweetPoster } = await import('../utils/tweetPoster');
  const tweet = { text: content, media: images || [] };
  await tweetPoster.postThread([tweet as any]);

  return `✅ Tweet posted: "${content.substring(0, 50)}..."`;
}
```

---

### 3. 活动报告

报告服务自动跟踪 autopilot 活动，定期发送统计报告到 Telegram：

**数据收集** (`reportService.ts`):

```typescript
// 在 autoReplyService 中自动调用
reportService.recordScan();      // 扫描推文时
reportService.recordReply(...);  // 成功回复时
reportService.recordSkip();      // 跳过推文时
```

**报告内容**:

```
📊 BNBOT Auto-Reply Report

⏱ Period: 2024-01-15 10:00 - 16:00

📈 Statistics
• Tweets scanned: 150
• Replies posted: 12
• Replies skipped: 138

💬 Recent Replies
1. @user1
   "Great insight! I think..."
2. @user2
   "This is really..."
```

**触发方式**：
- 后端 Celery 定时检查 → 发送 `generate_report` 命令
- 用户通过 Telegram 发送 "生成报告"
- 扩展调用 `reportService.sendReport()`

---

### 4. 统一会话上下文

解决问题：AI 在连续自动回复时容易生成相似风格的内容。

**实现方式** (`ReplyGenerator.ts`):

```typescript
// 记录最近 5 条回复
private recentReplies: RecentReply[] = [];
private readonly MAX_RECENT_REPLIES = 5;

recordReply(authorHandle: string, content: string): void {
  this.recentReplies.push({ authorHandle, content });
  if (this.recentReplies.length > this.MAX_RECENT_REPLIES) {
    this.recentReplies.shift();
  }
}
```

**Prompt 注入**:

```
IMPORTANT - Your Recent Replies (avoid similar styles/openings):
1. @crypto_whale: "Great point! The market dynamics..."
2. @defi_builder: "This is exactly what I've been thinking..."
3. @nft_collector: "Love this perspective on..."

DO NOT start with similar phrases. Vary your tone, structure, and opening.
```

---

### 5. WebSocket 通信

扩展与后端保持长连接，实现实时双向通信：

**连接生命周期**:

```
扩展启动 → 用户登录
    ↓
commandService.connect()
    ↓
建立 WebSocket 连接: wss://api.bnbot.com/ws/{userId}?token={jwt}
    ↓
启动心跳 (每30秒)
    ↓
监听消息，分发处理
    ↓
[断开] 自动重连 (最多5次，指数退避)
```

**心跳机制**:

```typescript
private startHeartbeat(): void {
  this.heartbeatInterval = window.setInterval(() => {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'heartbeat' });
    }
  }, 30000);
}
```

---

## 文件清单

### 新增文件

| 文件 | 功能 |
|------|------|
| `services/commandService.ts` | WebSocket 客户端，接收后端指令 |
| `services/reportService.ts` | 活动报告生成与发送 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `utils/ReplyGenerator.ts` | 添加回复历史，避免风格重复 |
| `services/autoReplyService.ts` | 集成 reportService 统计 |
| `App.tsx` | 启动时连接 CommandService |

---

## 调试

```typescript
// 控制台查看连接状态
commandService.isConnected()

// 手动发送测试消息
commandService.send({ type: 'test', content: 'hello' })

// 查看报告数据
reportService.generateReport()

// 查看回复历史
replyGenerator.getRecentReplies()
```

---

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| WebSocket 断开 | 自动重连，最多5次 |
| 用户未登录 | 不建立连接 |
| 命令执行失败 | 返回错误信息给后端 → Telegram |
| 浏览器离线 | 后端通过 Telegram 通知用户 |

---

## 多标签页执行策略

当用户打开多个 X/Twitter 标签页时，需要确保任务只在一个标签页执行，避免重复操作。

### 执行优先级

`background.ts` 中的 `sendToOneXTab()` 函数实现了三级优先级：

```
优先级 1: 当前窗口的激活 X 标签页
    ↓ (没有)
优先级 2: 任意已打开的 X 标签页
    ↓ (没有)
优先级 3: 自动在后台打开新的 X 标签页
```

### 实现代码

```typescript
// background.ts
async function sendToOneXTab(message: object): Promise<void> {
  // 优先级 1: 当前窗口的激活 X 标签页
  const activeTabs = await chrome.tabs.query({
    url: ['*://twitter.com/*', '*://x.com/*'],
    active: true,
    currentWindow: true
  });

  if (activeTabs.length > 0 && activeTabs[0].id) {
    chrome.tabs.sendMessage(activeTabs[0].id, message);
    return;
  }

  // 优先级 2: 任意 X 标签页
  const allXTabs = await chrome.tabs.query({
    url: ['*://twitter.com/*', '*://x.com/*']
  });

  if (allXTabs.length > 0 && allXTabs[0].id) {
    chrome.tabs.sendMessage(allXTabs[0].id, message);
    return;
  }

  // 优先级 3: 自动打开新标签页
  const newTab = await chrome.tabs.create({
    url: 'https://x.com/home',
    active: false  // 后台打开，不打扰用户
  });

  // 等待页面加载 + content script 初始化
  await waitForTabReady(newTab.id);
  chrome.tabs.sendMessage(newTab.id, message);
}
```

### 自动打开标签页的细节

当用户没有打开任何 X 页面时，扩展会自动打开一个：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| URL | `https://x.com/home` | 打开首页 |
| active | `false` | 后台打开，不切换焦点 |
| 等待时间 | 1.5 秒 | 确保 content script 初始化完成 |
| 超时保护 | 15 秒 | 防止页面加载卡死 |
| keep-alive | 自动设置 | 如果远程控制开启，设置 `autoDiscardable: false` |

### 权限要求

`manifest.json` 需要 `tabs` 权限：

```json
{
  "permissions": [
    "storage",
    "identity",
    "offscreen",
    "tabs"  // 用于查询和创建标签页
  ]
}
```

### 使用场景

| 场景 | 行为 |
|------|------|
| 用户正在看 X 页面 | 任务在当前页面执行 |
| 用户开了多个 X 页面，但在看其他网站 | 任务在第一个 X 页面执行 |
| 用户没有打开任何 X 页面 | 自动后台打开 X 首页，任务在新页面执行 |
| 定时任务触发时用户在睡觉 | 自动打开页面执行，不打扰用户 |

### Tab Keep-Alive 机制

当远程控制（WebSocket）开启时，所有 X 标签页会被设置为不可丢弃：

```typescript
// 防止 Chrome 冻结后台标签页
await chrome.tabs.update(tabId, { autoDiscardable: false });
```

这确保即使用户切到其他标签页，X 页面也不会被 Chrome 冻结，保证定时任务能正常执行。
