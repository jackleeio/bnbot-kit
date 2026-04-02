# BNBOT 扩展端架构文档

## 目录

1. [整体架构](#整体架构)
2. [WebSocket 通信](#websocket-通信)
3. [Telegram 集成](#telegram-集成)
4. [Action 执行系统](#action-执行系统)
5. [服务层架构](#服务层架构)

---

## 整体架构

### 概述

BNBOT 扩展是一个 Chrome 扩展，注入到 Twitter/X 页面，提供 AI 对话、自动回复、内容分析等功能。通过 WebSocket 与后端通信，支持 Telegram 远程控制。

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     Chrome Extension                         │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │   App.tsx    │  │  Sidebar.tsx │  │  Panels          │   │
│  │   (主入口)   │  │  (标签导航)  │  │  - ChatPanel     │   │
│  │              │  │              │  │  - AutoPilotPanel│   │
│  └──────────────┘  └──────────────┘  │  - BoostPanel    │   │
│                                      │  - AnalysisPanel │   │
│                                      └──────────────────┘   │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    Services Layer                       │ │
│  │  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐ │ │
│  │  │ chatService   │  │commandService │  │ authService │ │ │
│  │  │ (AI 对话)     │  │ (WebSocket)   │  │ (认证)      │ │ │
│  │  └───────────────┘  └───────────────┘  └─────────────┘ │ │
│  │  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐ │ │
│  │  │autoReplyService│ │ reportService │  │telegramSvc  │ │ │
│  │  │ (自动回复)    │  │ (报告生成)    │  │ (Telegram)  │ │ │
│  │  └───────────────┘  └───────────────┘  └─────────────┘ │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    Utils Layer                          │ │
│  │  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐ │ │
│  │  │ ReplyPoster   │  │TweetEvaluator │  │ tweetPoster │ │ │
│  │  │ (发送回复)    │  │ (评估推文)    │  │ (发推)      │ │ │
│  │  └───────────────┘  └───────────────┘  └─────────────┘ │ │
│  │  ┌───────────────┐  ┌───────────────┐                  │ │
│  │  │actionIntegration│TimelineScroller│                  │ │
│  │  │ (Action执行)  │  │ (滚动时间线)  │                  │ │
│  │  └───────────────┘  └───────────────┘                  │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket
                              ▼
                    ┌──────────────────┐
                    │     Backend      │
                    │  api.bnbot.ai    │
                    └──────────────────┘
```

### 文件结构

```
bnbot-extension/
├── App.tsx                 # 主应用入口
├── index.tsx               # 内容脚本入口
├── background.ts           # Service Worker
├── manifest.json           # 扩展清单
│
├── components/
│   ├── Sidebar.tsx         # 侧边栏导航
│   └── panels/
│       ├── ChatPanel.tsx       # AI 对话面板
│       ├── AutoPilotPanel.tsx  # 自动驾驶面板
│       ├── BoostPanel.tsx      # 推广面板
│       ├── AnalysisPanel.tsx   # 分析面板
│       └── CreditsPanel.tsx    # 积分面板
│
├── services/
│   ├── authService.ts          # 认证服务
│   ├── chatService.ts          # AI 对话服务
│   ├── commandService.ts       # WebSocket 命令服务
│   ├── autoReplyService.ts     # 自动回复服务
│   ├── reportService.ts        # 报告服务
│   └── telegramService.ts      # Telegram 集成
│
├── utils/
│   ├── actionIntegration.ts    # Action 执行器
│   ├── ReplyPoster.ts          # 回复发送
│   ├── tweetPoster.ts          # 推文发送
│   ├── TweetEvaluator.ts       # 推文评估
│   ├── TimelineScroller.ts     # 时间线滚动
│   └── TwitterInjector.ts      # UI 注入
│
├── locales/
│   ├── en.ts                   # 英文
│   └── zh.ts                   # 中文
│
└── types/
    ├── autoReply.ts            # 自动回复类型
    └── index.ts                # 通用类型
```

---

## WebSocket 通信

### 概述

CommandService 管理与后端的 WebSocket 连接，处理来自 Telegram 和定时任务的命令。

### 连接流程

```typescript
// services/commandService.ts

// 1. 初始化
commandService.init({
  onConnected: () => console.log('Connected'),
  onDisconnected: () => console.log('Disconnected'),
  onMessage: (msg) => handleMessage(msg)
});

// 2. 连接
await commandService.connect();

// 3. 发送消息
commandService.send({ type: 'heartbeat' });

// 4. 断开
commandService.disconnect();
```

### 消息类型

| 类型 | 方向 | 说明 |
|------|------|------|
| `heartbeat` | 扩展→后端 | 心跳保活（30秒间隔）|
| `heartbeat_ack` | 后端→扩展 | 心跳确认 |
| `chat` | 后端→扩展 | Telegram 聊天消息 |
| `chat_response` | 扩展→后端 | 聊天回复 |
| `command` | 后端→扩展 | 执行命令 |
| `command_result` | 扩展→后端 | 命令结果 |
| `action` | 后端→扩展 | AI 需要的浏览器操作 |
| `action_result` | 扩展→后端 | Action 执行结果 |
| `report` | 扩展→后端 | 报告数据 |

### 重连机制

```typescript
private scheduleReconnect(): void {
  if (this.reconnectAttempts >= this.maxReconnectAttempts) {
    return; // 最多重试 5 次
  }

  this.reconnectAttempts++;
  const delay = this.reconnectDelay * this.reconnectAttempts; // 递增延迟

  setTimeout(() => {
    this.connect();
  }, delay);
}
```

详细文档见：[COMMAND_SERVICE.md](./COMMAND_SERVICE.md)

---

## Telegram 集成

### 概述

用户通过 Telegram 发送消息，后端 AI 处理后，如需浏览器操作则派发到扩展执行。

### 消息处理流程

```
Telegram 用户消息
        ↓
后端 TelegramAIService.chat()
        ↓
┌───────┴───────┐
│               │
纯文本回复    需要 Action
   ↓               ↓
直接回复     派发到扩展
Telegram          ↓
          commandService 接收
                  ↓
          executeAction() 执行
                  ↓
          sendActionResult() 返回
                  ↓
          后端 resume() 继续
                  ↓
          最终回复 Telegram
```

### 处理 Action 消息

```typescript
// services/commandService.ts

private async handleAction(message: CommandMessage): Promise<void> {
  const { actionType, actionPayload, threadId, telegramChatId, telegramMsgId } = message;

  try {
    // 执行 Action
    const result = await executeAction(`action_${actionType}`, actionPayload);

    // 返回结果
    this.sendActionResult(
      requestId,
      threadId,
      actionType,
      result.success,
      result.data,
      result.error,
      telegramChatId,
      telegramMsgId
    );
  } catch (error) {
    this.sendActionResult(requestId, threadId, actionType, false, undefined, error.message);
  }
}
```

### 支持的命令

| 命令 | Action | 说明 |
|------|--------|------|
| 发推 | `post_tweet` | 发送推文 |
| 开始自动回复 | `start_autopilot` | 启动自动驾驶 |
| 停止自动回复 | `stop_autopilot` | 停止自动驾驶 |
| 查看状态 | `get_status` | 获取当前状态 |
| 生成报告 | `generate_report` | 生成并发送报告 |

---

## Action 执行系统

### 概述

Action 是 AI 需要浏览器执行的操作，如搜索、抓取、发推等。

### 支持的 Action 类型

| actionType | 说明 | 参数 |
|------------|------|------|
| `advanced_search` | Twitter 高级搜索 | `{query, type, limit}` |
| `search_and_analyze` | 搜索并分析 | `{query, analysisType}` |
| `navigate_to_profile` | 导航到用户主页 | `{username}` |
| `scrape_tweets` | 抓取推文 | `{username, limit}` |
| `scrape_bookmarks` | 抓取书签 | `{limit}` |
| `post_tweet` | 发推 | `{content, images}` |
| `follow_user` | 关注用户 | `{username}` |

### 执行器实现

```typescript
// utils/actionIntegration.ts

export function executeAction(
  actionName: string,
  input: Record<string, unknown>,
  callbacks: ActionCallbacks
): void {
  switch (actionName) {
    case 'action_advanced_search':
      executeAdvancedSearch(input, callbacks);
      break;
    case 'action_post_tweet':
      executePostTweet(input, callbacks);
      break;
    // ... 其他 Action
  }
}

interface ActionCallbacks {
  onComplete: (result: unknown) => void;
  onError: (error: string) => void;
  onProgress?: (message: string) => void;
}
```

### 与 ChatService 集成

```typescript
// AI 对话中的 Action 处理
chatService.sendMessageStream(message, {
  onInterrupt: async (actionType, actionInput, threadId) => {
    // 执行 Action
    const result = await executeActionPromise(actionType, actionInput);

    // 恢复 AI 处理
    chatService.resumeGraph(threadId, result, callbacks);
  }
});
```

---

## 服务层架构

### authService

认证服务，管理用户登录状态和 Token。

```typescript
// services/authService.ts

class AuthService {
  async getUser(): Promise<User | null>;
  async getAccessToken(): Promise<string | null>;
  async signIn(): Promise<void>;
  async signOut(): Promise<void>;
}
```

### chatService

AI 对话服务，调用后端 LangGraph。

```typescript
// services/chatService.ts

class ChatService {
  sendMessageStream(message: string, callbacks: StreamCallbacks): void;
  sendStatelessMessageStream(message: string, callbacks: StreamCallbacks): void;
  resumeGraph(threadId: string, value: unknown, callbacks: StreamCallbacks): void;
}
```

### autoReplyService

自动回复服务，管理自动驾驶模式。

```typescript
// services/autoReplyService.ts

class AutoReplyService {
  async start(config?: AutoReplyConfig): Promise<void>;
  stop(): void;
  getSession(): AutoReplySession | null;
}
```

### reportService

报告生成服务。

```typescript
// services/reportService.ts

class ReportService {
  generateReport(): Report;
  sendReport(): void;
}
```

---

## 本地开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 加载扩展
# Chrome -> 扩展程序 -> 加载已解压的扩展程序 -> 选择 dist/ 目录
```

## 环境变量

```bash
# .env
VITE_API_URL=https://api.bnbot.ai
VITE_WS_URL=wss://api.bnbot.ai
```
