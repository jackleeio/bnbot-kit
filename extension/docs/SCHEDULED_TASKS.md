# 定时任务实现文档

本文档详细说明 BNBOT 扩展中所有定时任务的实现方式。

---

## 目录

1. [任务类型概览](#任务类型概览)
2. [HANDLE_NOTIFICATION 任务](#handle_notification-任务)
3. [AUTO_REPLY 任务](#auto_reply-任务)
4. [FEED_REPORT 任务](#feed_report-任务)
5. [通用架构](#通用架构)

---

## 任务类型概览

| 任务类型 | 说明 | 执行器 |
|----------|------|--------|
| `handle_notification` | 处理通知（新帖子+回复） | `NotificationTaskExecutor` |
| `auto_reply` | 自动回复时间线推文 | `autoReplyService` |
| `feed_report` | 刷推生成报告 | `FeedReportExecutor` |
| 其他 | 走 SSE/LangGraph 流程 | `chatService` |

**任务调度入口**: `services/commandService.ts` → `handleScheduledTrigger()`

```typescript
// commandService.ts
if (taskTypeLower === 'handle_notification') {
  await this.executeNotificationTask(trigger_id, execution_id, task_name);
} else if (taskTypeLower === 'auto_reply') {
  await this.executeAutoReplyTask(trigger_id, execution_id, task_name, false);
} else if (taskTypeLower === 'feed_report') {
  await this.executeFeedReportTask(trigger_id, execution_id, task_name);
} else {
  await this.executeSSETask(trigger_id, execution_id);
}
```

---

## HANDLE_NOTIFICATION 任务

### 概述

处理 Twitter/X 通知页面的通知，分两个阶段：
- **阶段1**：处理新帖子通知（关注的人发的新推文）
- **阶段2**：处理回复通知（别人回复我的帖子）

### 文件结构

```
utils/
├── NotificationTaskExecutor.ts    # 主执行器，协调两个阶段
├── NotificationProcessor.ts       # 通知页面 DOM 操作
├── ReplyNotificationStorage.ts    # 已处理回复的持久化存储（48小时）
```

### 配置参数

```typescript
interface NotificationTaskSettings {
  // 阶段1：新帖子通知
  phase1Enabled: boolean;           // 是否启用（默认 true）
  phase1MaxCount: number;           // 最多处理几条（默认 20）
  phase1MaxTweetAge: number;        // 推文最大年龄，分钟（默认 30）
  phase1LikeProbability: number;    // 点赞概率 0-1（默认 0.5）

  // 阶段2：回复通知
  phase2Enabled: boolean;           // 是否启用（默认 true）
  phase2MaxCount: number;           // 最多处理几条（默认 50）
  phase2ReplyProbability: number;   // 回复概率 0-1（默认 0.7）
  phase2LikeProbability: number;    // 点赞概率 0-1（默认 0.6）
}
```

### 执行流程

```
┌──────────────────────────────────────────────────────────┐
│  阶段1：处理新帖子通知                                      │
├──────────────────────────────────────────────────────────┤
│  1. 导航到 /notifications                                 │
│  2. 查找 "New Post" / "新帖子" 通知                        │
│  3. 检查推文时间（≤30分钟内）                               │
│  4. 点击进入时间线                                         │
│  5. 抓取推文 → TweetEvaluator 评估                        │
│  6. ReplyGenerator 生成回复                               │
│  7. ReplyPoster 发布回复                                  │
│  8. 随机点赞（50%概率）                                    │
│  9. 返回 /notifications，处理下一条                        │
│  循环直到：处理完20条 或 没有更多通知                        │
└──────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────┐
│  阶段2：处理回复通知                                        │
├──────────────────────────────────────────────────────────┤
│  1. 导航到 /notifications                                 │
│  2. 滚动查找 "replied" / "回复了你" 通知                    │
│  3. 检查是否是当天的                                       │
│  4. 检查 ReplyNotificationStorage（防重复，48小时）         │
│  5. 点击进入帖子详情                                       │
│  6. 随机决定是否回复（70%概率）                             │
│  7. 如果回复：评估 → 生成 → 发布                           │
│  8. 随机点赞（60%概率）                                    │
│  9. 标记为已处理（存入 chrome.storage）                     │
│  10. 返回 /notifications，处理下一条                       │
│  循环直到：处理完50条 或 遇到非当天通知 或 没有更多通知        │
└──────────────────────────────────────────────────────────┘
```

### 后端报告格式

```json
{
  "success": true,
  "data": {
    "phase1_processed": 5,
    "phase1_replied": 4,
    "phase1_liked": 2,
    "phase1_skipped": 1,
    "phase2_processed": 10,
    "phase2_replied": 7,
    "phase2_liked": 6,
    "phase2_skipped": 3,
    "duration_ms": 120000
  }
}
```

### 关键实现细节

#### 1. 通知类型识别

```typescript
// NotificationProcessor.ts
private identifyNotificationType(cell: HTMLElement): NotificationType {
  const text = cell.textContent || '';

  // 新帖子通知关键词
  if (['New post', '新帖子', 'New tweet', '新推文'].some(k => text.includes(k)))
    return 'new_post';

  // 回复通知关键词
  if (['replied', '回复了你', 'replied to your'].some(k => text.includes(k)))
    return 'reply';

  // ... 其他类型
}
```

#### 2. 时间过滤

```typescript
// 阶段1：只处理30分钟内的推文
isTweetWithinTimeRange(timestamp: string, maxMinutes: number): boolean {
  const tweetDate = new Date(timestamp);
  const diffMinutes = (Date.now() - tweetDate.getTime()) / (1000 * 60);
  return diffMinutes <= maxMinutes;
}

// 阶段2：只处理当天的通知
isToday(timestamp: string): boolean {
  const date = new Date(timestamp);
  return date.toDateString() === new Date().toDateString();
}
```

#### 3. 防重复存储

```typescript
// ReplyNotificationStorage.ts
const STORAGE_KEY = 'bnbot_processed_replies';
const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48小时

interface ProcessedReply {
  notificationId: string;
  tweetId: string;
  authorHandle: string;
  processedAt: number;
}
```

#### 4. 点赞功能

```typescript
// NotificationProcessor.ts
async likeTweet(): Promise<boolean> {
  const likeButton = document.querySelector('button[data-testid="like"]');
  if (!likeButton) return false;

  // 检查是否已点赞
  if (document.querySelector('button[data-testid="unlike"]')) return false;

  likeButton.click();
  return true;
}
```

### 测试方法

```javascript
// 浏览器控制台手动测试
const { notificationTaskExecutor } = await import('./utils/NotificationTaskExecutor');
const result = await notificationTaskExecutor.execute();
console.log('执行结果:', result);

// 查看已处理记录
const data = await chrome.storage.local.get('bnbot_processed_replies');
console.log('已处理回复:', data);

// 清空记录
await chrome.storage.local.remove('bnbot_processed_replies');
```

---

## AUTO_REPLY 任务

### 概述

自动回复时间线上的推文，使用 `autoReplyService` 执行。

### 执行方法

```typescript
// commandService.ts
private async executeAutoReplyTask(triggerId, executionId, taskName, onlyProcessNotifications) {
  const { autoReplyService } = await import('./autoReplyService');

  const settings = {
    ...DEFAULT_AUTO_REPLY_SETTINGS,
    onlyProcessNotifications: false,  // 滚动时间线模式
    requireConfirmation: false,
    dryRunMode: false,
  };

  autoReplyService.start(settings);
  // ... 等待完成并报告结果
}
```

### 与 HANDLE_NOTIFICATION 的区别

| 特性 | AUTO_REPLY | HANDLE_NOTIFICATION |
|------|------------|---------------------|
| 数据来源 | 时间线滚动 | 通知页面 |
| 处理对象 | 任意推文 | 新帖子 + 回复通知 |
| 点赞功能 | 无 | 有（随机概率） |
| 回复概率 | 100%（评估通过即回复） | 阶段2有70%概率 |

---

## FEED_REPORT 任务

### 概述

刷推并生成阅读报告，使用 `FeedReportExecutor` 执行。

*(详细实现待补充)*

---

## 通用架构

### 任务触发流程

```
后端 WebSocket 消息
    ↓
{ type: "scheduled_trigger", task_type: "xxx", trigger_id: "xxx" }
    ↓
commandService.handleScheduledTrigger()
    ↓
根据 task_type 路由到对应执行器
    ↓
执行器完成任务
    ↓
commandService.reportTaskResult()
    ↓
POST /api/v1/scheduled-tasks/triggers/{triggerId}/complete
```

### 报告结果 API

```typescript
private async reportTaskResult(
  triggerId: string,
  executionId: string,
  success: boolean,
  data?: unknown,
  error?: string
): Promise<void> {
  await authService.fetchWithAuth(
    `${API_BASE_URL}/api/v1/scheduled-tasks/triggers/${triggerId}/complete`,
    {
      method: 'POST',
      body: JSON.stringify({
        execution_id: executionId,
        success,
        data,
        error,
      }),
    }
  );
}
```

---

## 更新日志

### 2024-02-03
- 新增 HANDLE_NOTIFICATION 任务实现
  - 两阶段处理：新帖子通知 + 回复通知
  - 时间过滤：阶段1限30分钟，阶段2限当天
  - 防重复：48小时存储
  - 随机点赞功能
