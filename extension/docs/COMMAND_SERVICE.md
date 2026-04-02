# BNBOT 扩展端 Telegram 集成文档

## 概述

扩展端通过 WebSocket 与后端通信，接收来自 Telegram 的命令和 AI 请求，执行浏览器操作后返回结果。

## 架构图（Offscreen Document 方案）

由于 Manifest V3 的 Service Worker 会被 Chrome 自动终止（idle timeout），无法维持长连接。
因此使用 **Offscreen Document** 方案，它是一个隐藏的 HTML 页面，不受 Service Worker 生命周期限制。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Chrome Extension                                │
│                                                                             │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────────────────┐  │
│  │  Tab 1       │      │              │      │   Offscreen Document     │  │
│  │  Content     │─────►│  Background  │─────►│   (offscreen.html)       │  │
│  │  Script      │      │  Service     │      │                          │  │
│  └──────────────┘      │  Worker      │      │  ┌────────────────────┐  │  │
│                        │              │      │  │  WebSocket Manager │  │  │
│  ┌──────────────┐      │  (中转消息)   │◄─────│  │  - 无限重连        │  │  │
│  │  Tab 2       │─────►│              │      │  │  - 指数退避        │  │  │
│  │  Content     │      │              │      │  │  - 心跳 30s        │  │  │
│  │  Script      │      └──────────────┘      │  │  - 健康检查 60s    │  │  │
│  └──────────────┘             │              │  └─────────┬──────────┘  │  │
│                               │              │            │              │  │
│  ┌──────────────┐             │              └────────────┼──────────────┘  │
│  │  Tab 3       │─────────────┘                           │                 │
│  │  Content     │                                         │                 │
│  │  Script      │                                         │                 │
│  └──────────────┘                                         │                 │
│                                                           │                 │
└───────────────────────────────────────────────────────────┼─────────────────┘
                                                            │
                                                            ▼ WebSocket (wss://)
                                                ┌──────────────────────┐
                                                │    Backend Server    │
                                                │                      │
                                                │  ┌────────────────┐  │
                                                │  │  websocket.py  │  │
                                                │  │  telegram.py   │  │
                                                │  └────────────────┘  │
                                                │           │          │
                                                │           ▼          │
                                                │  ┌────────────────┐  │
                                                │  │   Telegram     │  │
                                                │  │   Bot API      │  │
                                                │  └────────────────┘  │
                                                └──────────────────────┘
```

### 消息流程

**1. 连接请求（Content Script → Backend）**
```
Content Script          Background SW           Offscreen Doc           Backend
     │                       │                       │                     │
     │── WS_CONNECT ────────►│                       │                     │
     │                       │── ensureOffscreen() ─►│                     │
     │                       │── OFFSCREEN_WS_CONNECT►│                    │
     │                       │                       │── WebSocket ───────►│
     │                       │                       │◄─── Connected ──────│
     │                       │◄── WS_CONNECTED ──────│                     │
     │◄── WS_CONNECTED ──────│ (broadcast)           │                     │
```

**2. 接收消息（Backend → All Tabs）**
```
Backend              Offscreen Doc           Background SW           All Tabs
   │                      │                       │                     │
   │── message ──────────►│                       │                     │
   │                      │── WS_MESSAGE ────────►│                     │
   │                      │                       │── broadcast ───────►│
   │                      │                       │                     │
```

**3. 发送消息（Content Script → Backend）**
```
Content Script          Background SW           Offscreen Doc           Backend
     │                       │                       │                     │
     │── WS_SEND ───────────►│                       │                     │
     │                       │── OFFSCREEN_WS_SEND ─►│                     │
     │                       │                       │── ws.send() ───────►│
```

## 核心文件

```
扩展根目录/
├── offscreen.html       # Offscreen Document HTML 入口
├── offscreen.ts         # WebSocket 管理器（持久连接）
├── background.ts        # Service Worker（管理 Offscreen 生命周期，转发消息）
│
services/
├── commandService.ts    # Content Script 端 WebSocket 客户端接口
├── chatService.ts       # AI 对话服务
├── reportService.ts     # 报告生成服务
└── autoReplyService.ts  # AutoPilot 服务

utils/
├── actionIntegration.ts # Action 执行器
└── tweetPoster.ts       # 发推功能
```

## 各层职责

| 层级 | 文件 | 职责 |
|------|------|------|
| Content Script | `commandService.ts` | 发送 `WS_CONNECT`/`WS_SEND`，接收 `WS_MESSAGE`，执行 Action |
| Background SW | `background.ts` | 管理 Offscreen 生命周期，转发消息到 Offscreen/Tabs |
| Offscreen Doc | `offscreen.ts` | 维护 WebSocket 连接，发送 `WS_CONNECTED`/`WS_MESSAGE` |

## CommandService API

### 初始化和连接

```typescript
import { commandService } from './services/commandService';

// 初始化
commandService.init({
  onConnected: () => console.log('Connected'),
  onDisconnected: () => console.log('Disconnected'),
  onMessage: (msg) => console.log('Received:', msg)
});

// 连接 WebSocket
await commandService.connect();
```

### 消息类型

| 类型 | 方向 | 用途 |
|------|------|------|
| `chat` | 后端→扩展 | Telegram 用户消息，需要 AI 处理 |
| `command` | 后端→扩展 | 执行命令（发推、启动自动回复等）|
| `action` | 后端→扩展 | AI 需要浏览器执行的操作 |
| `heartbeat` | 双向 | 保持连接 |

### 接收 Action 消息

```typescript
interface CommandMessage {
  type: 'chat' | 'command' | 'action' | 'heartbeat_ack';
  requestId?: string;
  content?: string;

  // Action 专用字段
  actionType?: string;      // 如 'advanced_search'
  actionPayload?: any;      // 操作参数
  threadId?: string;        // LangGraph 线程 ID
  telegramChatId?: string;  // Telegram 聊天 ID
  telegramMsgId?: number;   // Telegram 消息 ID
}
```

### 处理 Action 流程

```typescript
private async handleAction(message: CommandMessage): Promise<void> {
  const { actionType, actionPayload, threadId } = message;

  // 1. 执行 Action
  const result = await executeAction(`action_${actionType}`, actionPayload);

  // 2. 返回结果给后端
  this.sendActionResult(
    requestId,
    threadId,
    actionType,
    result.success,
    result.data,
    result.error
  );
}
```

### 发送结果

```typescript
// 发送 Action 执行结果
commandService.sendActionResult(
  requestId,
  threadId,
  actionType,
  true,           // success
  { data: ... },  // result
  undefined,      // error
  telegramChatId,
  telegramMsgId
);

// 发送聊天回复
commandService.sendChatResponse(requestId, content, success);

// 发送命令结果
commandService.sendCommandResult(requestId, action, success, result, error);
```

## 支持的 Action 类型

| actionType | 说明 | 参数 |
|------------|------|------|
| `advanced_search` | Twitter 高级搜索 | `{ query, type, limit }` |
| `search_and_analyze` | 搜索并分析 | `{ query, analysisType }` |
| `navigate_to_profile` | 导航到用户主页 | `{ username }` |
| `scrape_tweets` | 抓取推文 | `{ username, limit }` |
| `scrape_bookmarks` | 抓取书签 | `{ limit }` |
| `post_tweet` | 发推 | `{ content, images }` |
| `follow_user` | 关注用户 | `{ username }` |

## WebSocket 连接管理

### 连接地址

```typescript
// 生产环境
wss://api.bnbot.ai/ws/{userId}?token={accessToken}
```

### 自动重连

```typescript
private scheduleReconnect(): void {
  if (this.reconnectAttempts >= this.maxReconnectAttempts) {
    return;
  }

  this.reconnectAttempts++;
  const delay = this.reconnectDelay * this.reconnectAttempts;

  setTimeout(() => {
    this.connect();
  }, delay);
}
```

### 心跳机制

```typescript
// 每 30 秒发送心跳
private startHeartbeat(): void {
  this.heartbeatInterval = setInterval(() => {
    this.send({ type: 'heartbeat' });
  }, 30000);
}
```

## 与 ChatService 集成

当收到 `chat` 类型消息时，调用 chatService 处理：

```typescript
private async handleChatMessage(message: CommandMessage): Promise<void> {
  const { requestId, content } = message;

  let responseContent = '';

  // 使用 chatService 处理消息
  chatService.sendStatelessMessageStream(content, {
    onContent: (chunk) => {
      responseContent += chunk;
    },
    onComplete: () => {
      this.sendChatResponse(requestId, responseContent, true);
    },
    onInterrupt: async (actionType, actionInput, threadId) => {
      // 处理 AI 需要的 Action
      const result = await executeAction(actionType, actionInput);
      chatService.resumeGraph(threadId, result, callbacks);
    }
  });
}
```

## 错误处理

```typescript
try {
  const result = await executeAction(actionType, payload);
  this.sendActionResult(..., true, result);
} catch (error) {
  this.sendActionResult(..., false, undefined, error.message);
}
```

## 调试

### 查看 WebSocket 状态

```typescript
console.log('Connected:', commandService.isConnected());
```

### Chrome DevTools

1. 打开扩展的 Service Worker
2. 查看 Network 标签页的 WS 连接
3. 查看 Console 的 `[CommandService]` 日志

## 注意事项

1. **Token 刷新**：WebSocket 连接使用 JWT Token，过期后需要重新连接
2. **页面状态**：某些 Action 需要当前在 Twitter 页面
3. **并发限制**：避免同时执行多个 Action
4. **超时处理**：Action 执行有超时限制，需要处理超时情况

## Tab Keep-Alive 机制

### 问题背景

Chrome 会自动冻结（Tab Discarding）长时间不活跃的后台标签页，这会导致：
- 定时器从 1s 变成 1min+
- DOM 操作失败或超时
- Telegram 远程控制无法执行

### 解决方案

使用 Chrome 的 `autoDiscardable` API 防止 X 标签页被冻结：

```typescript
// 当 WebSocket 连接时，禁止 Chrome 丢弃 X 标签页
chrome.tabs.update(tabId, { autoDiscardable: false });

// 当 WebSocket 断开时，恢复默认行为
chrome.tabs.update(tabId, { autoDiscardable: true });
```

### 实现细节

**1. 连接时启用保活**
```typescript
if (message.type === 'WS_CONNECTED') {
  remoteControlEnabled = true;
  setXTabsKeepAlive(true);  // 所有 X 标签页设置 autoDiscardable: false
}
```

**2. 断开时禁用保活**
```typescript
if (message.type === 'WS_DISCONNECTED') {
  remoteControlEnabled = false;
  setXTabsKeepAlive(false);  // 恢复默认行为
}
```

**3. 新标签页自动应用**
```typescript
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (remoteControlEnabled && tab.url?.includes('x.com')) {
    chrome.tabs.update(tabId, { autoDiscardable: false });
  }
});
```

### 工作流程

```
用户开启 Remote Control（WebSocket 连接）
    ↓
所有 X 标签页设置 autoDiscardable: false
    ↓
用户可以切换到其他网站/应用
    ↓
X 标签页保持活跃，不会被 Chrome 冻结
    ↓
Telegram 发送命令 → X 标签页正常执行
    ↓
用户关闭 Remote Control（WebSocket 断开）
    ↓
恢复默认行为，X 标签页可被正常丢弃
```

## 多标签页处理

### 问题背景

用户可能同时打开多个 X 标签页，如果广播消息到所有标签页，会导致：
- 同一个操作被执行多次（如发推发 3 遍）
- 资源浪费

### 解决方案

只向第一个 X 标签页发送 Action 消息：

```typescript
if (message.type === 'WS_MESSAGE') {
  chrome.tabs.query({ url: ['*://twitter.com/*', '*://x.com/*'] }, (tabs) => {
    if (tabs.length > 0 && tabs[0].id) {
      // 只发给第一个标签页
      chrome.tabs.sendMessage(tabs[0].id, message);
    }
  });
}
```

### 消息类型处理策略

| 消息类型 | 处理策略 | 原因 |
|---------|---------|------|
| `WS_CONNECTED` | 发给第一个标签页 | 只需一个标签页知道连接状态 |
| `WS_DISCONNECTED` | 广播到所有标签页 | 所有标签页都需要知道断开 |
| `WS_MESSAGE` (Action) | 发给第一个标签页 | 避免重复执行 |
