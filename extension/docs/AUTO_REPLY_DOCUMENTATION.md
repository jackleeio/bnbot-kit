# Auto-Reply 自动回复功能文档

## 目录
1. [功能概述](#功能概述)
2. [核心架构](#核心架构)
3. [工作流程](#工作流程)
4. [技术栈](#技术栈)
5. [模块详解](#模块详解)
6. [配置说明](#配置说明)
7. [开发指南](#开发指南)
8. [故障排查](#故障排查)

---

## 功能概述

### 什么是自动回复？
自动回复是一个AI驱动的功能，能够自动浏览Twitter/X时间线，识别优质推文，并使用AI生成有意义的回复内容。它模拟人类行为来避免被平台检测，同时提供用户确认机制确保内容质量。

### 核心特性
- **AI驱动评估**：使用Gemini评估推文是否值得回复
- **智能回复生成**：基于推文内容和配置的语气生成回复
- **人类行为模拟**：随机延迟、微暂停，模拟真实人类操作
- **用户确认机制**：发送前可编辑或跳过回复
- **多语言支持**：自动检测推文语言（中文/英文）
- **安全限制**：会话/每日限制，防止过度使用
- **干运行模式**：预览不发送，用于测试

---

## 核心架构

### 整体架构图
```
┌─────────────────────────────────────────────────────────┐
│                   UI 层 (AutoReplyPanel)                │
│              - 配置设置 | 实时状态 | 活动日志           │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│            控制层 (AutoReplyService)                     │
│         - 会话管理 | 事件发布 | 状态机                 │
└─┬──────────┬──────────┬──────────┬────────────────────┘
  │          │          │          │
  ▼          ▼          ▼          ▼
┌────────┐ ┌──────────┐┌──────────┐┌──────────────┐
│Timeline│ │ Tweet    ││ Reply    ││ Reply Poster │
│Scroller│ │Evaluator ││Generator ││              │
│        │ │          ││          ││              │
│- DOM   │ │- AI过滤  ││- AI生成  ││- DOM交互     │
│- 采集  │ │- 快速筛选││- 验证    ││- 发送推文    │
└────────┘ │- 评分    │└──────────┘└──────────────┘
           │- 话题    │
           └──────────┘
                │          │            │
                └──────────┴────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        ▼                                     ▼
┌──────────────────────┐  ┌─────────────────────────┐
│HumanBehaviorSimulator│  │ trendService (AI API)   │
│- 随机延迟           │  │ - 评估请求              │
│- 高斯分布           │  │ - 回复生成              │
│- 微暂停             │  │ - 流式响应              │
└──────────────────────┘  └─────────────────────────┘
        │                           │
        └─────────┬─────────────────┘
                  ▼
        ┌──────────────────────┐
        │  chrome.storage      │
        │  - 配置存储          │
        │  - 会话数据          │
        │  - 历史记录          │
        └──────────────────────┘
```

### 模块关系
```
src/
├── types/
│   └── autoReply.ts           # 类型定义
├── services/
│   └── autoReplyService.ts    # 核心服务（单例）
├── utils/
│   ├── TimelineScroller.ts    # 推文采集
│   ├── TweetEvaluator.ts      # AI评估
│   ├── ReplyGenerator.ts      # AI生成回复
│   ├── ReplyPoster.ts         # 发送回复
│   └── HumanBehaviorSimulator.ts # 人类行为
└── components/
    └── panels/
        └── AutoReplyPanel.tsx  # UI界面
```

---

## 工作流程

### 完整流程图
```
用户启动会话
       ↓
────────────────────────────────────────────
│         第1阶段：推文采集                 │
├────────────────────────────────────────────
│ • 监听DOM变化（MutationObserver）        │
│ • 提取推文数据（ID, 作者, 内容, 指标）   │
│ • 使用Set去重（避免重复处理）            │
│ • 每批采集5条（可配置）                  │
└────────────────────────────────────────────
       ↓ (每批)
────────────────────────────────────────────
│         第2阶段：快速过滤                 │
├────────────────────────────────────────────
│ ✓ 跳过转推                               │
│ ✓ 检查排除名单                           │
│ ✓ 验证最低点赞数 (≥5)                    │
│ ✓ 跳过极短推文 (<10字)                   │
│ ✓ 跳过仅媒体推文                         │
│ ✓ 检查话题过滤                           │
└────────────────────────────────────────────
       ↓ (通过过滤)
────────────────────────────────────────────
│         第3阶段：AI评估                   │
├────────────────────────────────────────────
│ • 调用 trendService.sendMessageStream()  │
│ • 输入：推文内容、作者信息               │
│ • 输出：{                                │
│     shouldReply: boolean,                │
│     score: 0-100,                        │
│     reasons: [],                         │
│     suggestedTone: string,               │
│     topics: []                           │
│   }                                      │
│ • Token消耗：~500 / 评估                 │
└────────────────────────────────────────────
       ↓ (shouldReply=true)
────────────────────────────────────────────
│         第4阶段：回复生成                 │
├────────────────────────────────────────────
│ • 基于评估结果构建提示词                 │
│ • 参数化：                               │
│   - 配置的语气 (casual/professional等)  │
│   - 用户自定义指令                       │
│   - 推文语言 (自动检测)                  │
│   - 字符限制 (280)                       │
│ • AI生成内容                             │
│ • Token消耗：~800 / 生成                 │
│ • 验证：                                 │
│   ✓ 内容非空                             │
│   ✓ 不超长                               │
│   ✓ 排除垃圾模式                         │
└────────────────────────────────────────────
       ↓ (if requireConfirmation=true)
────────────────────────────────────────────
│         第5阶段：用户确认                 │
├────────────────────────────────────────────
│ • 显示生成的回复内容                     │
│ • 用户可以：                             │
│   - 发送（修改后或原样）                 │
│   - 编辑内容                             │
│   - 跳过此推文                           │
│ • 5分钟自动超时（默认拒绝）             │
└────────────────────────────────────────────
       ↓ (用户确认发送)
────────────────────────────────────────────
│         第6阶段：回复发布                 │
├────────────────────────────────────────────
│ 如果 dryRunMode=true:                   │
│   • 记录"[DRY RUN] Would have posted"   │
│   • 不实际发送                           │
│ 否则：                                   │
│   • 导航到推文详情页                     │
│   • 点击回复按钮打开编辑器               │
│   • 使用paste事件填充文本                │
│   • 点击发送按钮                         │
│   • 监控发送状态（验证成功）             │
│ • Token消耗追踪                          │
└────────────────────────────────────────────
       ↓
────────────────────────────────────────────
│         第7阶段：等待与间隔               │
├────────────────────────────────────────────
│ • 等待时间 = [minInterval, maxInterval]  │
│ • 分布：高斯分布（更接近人类行为）      │
│ • 额外行为模拟：                         │
│   - 随机滚动（0.7-0.9 视口）            │
│   - 微暂停（200-800ms）                 │
│   - 思考暂停（1-3秒）                   │
└────────────────────────────────────────────
       ↓ (if sessionLimit未达到)
       循环回第1阶段...

       ↓ (if sessionLimit达到或用户停止)
用户停止会话
    记录统计数据
    保存历史记录
```

### 状态机
```
          ┌─────────────┐
          │    idle     │
          │   空闲状态  │
          └──────┬──────┘
                 │ start()
                 ▼
          ┌─────────────┐
    ┌────▶│  scrolling  │◀────┐
    │     │   滚动采集  │     │
    │     └──────┬──────┘     │
    │            │            │
    │     评估+生成完成  等待超时
    │            │            │
    │     ┌──────▼──────┐     │
    │     │  evaluating │     │
    │     │   评估中    │     │
    │     └──────┬──────┘     │
    │            │            │
    │     ┌──────▼──────┐     │
    │     │ generating  │────┬┘
    │     │   生成中    │    │
    │     └──────┬──────┘    │
    │            │           │
    │     ┌──────▼──────┐    │
    │     │confirming   │    │
    │     │   待确认    │    │
    │     └──────┬──────┘    │
    │            │           │
    │     ┌──────▼──────┐    │
    │     │  posting    │────┘
    │     │   发送中    │
    │     └──────┬──────┘
    │            │
    │     ┌──────▼──────┐
    │     │  waiting    │
    │     │   等待中    │
    │     └──────┬──────┘
    └────────────┘

    pause() 在任何状态
         ↓
    ┌─────────────┐
    │   paused    │
    │   已暂停    │
    └──────┬──────┘
           │ resume()
           └─────────▶ 回到之前的状态

    任何状态 + stop()
         ↓
    ┌─────────────┐
    │   stopped   │ (最终状态)
    │   已停止    │
    └─────────────┘
```

---

## 技术栈

### 编程语言和框架
| 技术 | 版本 | 用途 |
|------|------|------|
| TypeScript | - | 类型安全的主编程语言 |
| React | - | UI界面框架 |
| Chrome Extension APIs | - | 浏览器扩展功能 |

### 关键库
| 库 | 用途 |
|----|------|
| trendService | AI评估和生成（Gemini API） |
| chrome.storage | 本地持久化存储 |
| HumanBehaviorSimulator | 人类行为模拟 |
| Lucide React | UI图标库 |

### 设计模式
1. **单例模式** - AutoReplyService是全局唯一实例
2. **事件驱动** - EventListener模式用于UI更新
3. **模块化分层** - UI层、控制层、功能层、AI层清晰分离
4. **流式处理** - TweetEvaluator和ReplyGenerator支持流式API
5. **观察者模式** - MutationObserver监听DOM变化

---

## 模块详解

### 1. AutoReplyService（核心服务）
**文件**：`services/autoReplyService.ts`

**职责**：
- 管理整个自动回复的生命周期
- 协调各个功能模块
- 维护会话状态
- 发布事件供UI监听

**主要方法**：
```typescript
// 会话控制
getInstance(): AutoReplyService
startSession(): void
stopSession(): void
pauseSession(): void
resumeSession(): void

// 配置管理
updateSettings(settings: Partial<AutoReplySettings>): void
getSettings(): AutoReplySettings

// 状态查询
getSession(): AutoReplySession | null
getDailyStats(): DailyStats
getHistory(): ActivityLog[]

// 事件监听
addEventListener(event: string, callback: Function): void
removeEventListener(event: string, callback: Function): void
```

**会话数据结构**：
```typescript
interface AutoReplySession {
  id: string;                    // 会话ID
  startTime: number;             // 开始时间
  status: SessionStatus;         // 当前状态
  tweetsScanned: number;         // 扫描推文数
  repliesPosted: number;         // 发送回复数
  repliesFailed: number;         // 失败数
  totalTokensUsed: number;       // Token消耗
  errors: ErrorLog[];            // 错误日志
  currentTweet?: TweetData;      // 当前处理的推文
  currentReply?: string;         // 当前生成的回复
}
```

### 2. TimelineScroller（推文采集）
**文件**：`utils/TimelineScroller.ts`

**职责**：
- 监听时间线DOM变化
- 提取推文信息
- 去重处理

**采集流程**：
```typescript
// 1. 初始化监听
initialize(): void
  ├─ 启动MutationObserver
  ├─ 获取当前用户handle
  └─ 初始化处理集合

// 2. 当检测到新推文
onMutation()
  ├─ 使用CSS选择器: article[data-testid="tweet"]
  ├─ 解析推文数据:
  │  ├─ ID (data-testid)
  │  ├─ 作者信息 (handle, 头像, 名字)
  │  ├─ 内容文本
  │  ├─ 指标 (点赞, 转发, 回复)
  │  └─ 媒体URL
  ├─ 检查是否已处理
  ├─ 添加到tweetQueue
  └─ 失败10次后停止

// 3. 获取推文
getTweets(count: number): TweetData[]
  └─ 返回最多count条未处理的推文

interface TweetData {
  id: string;
  author: {
    handle: string;
    name: string;
    avatarUrl: string;
  };
  content: string;
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
  };
  mediaUrls: string[];
  timestamp: number;
}
```

### 3. TweetEvaluator（推文评估）
**文件**：`utils/TweetEvaluator.ts`

**职责**：
- 快速本地过滤
- AI远程评估
- 返回评估结果

**评估流程**：
```typescript
// 第一步：快速过滤（本地）
async evaluate(tweet: TweetData): Promise<EvaluationResult> {
  // 过滤规则
  if (isRetweet(tweet)) return skip("转推");
  if (isExcluded(tweet.author.handle)) return skip("排除名单");
  if (tweet.metrics.likes < minLikeCount) return skip("点赞数不足");
  if (tweet.content.length < 10) return skip("内容太短");
  if (isMediaOnly(tweet)) return skip("仅媒体");
  if (!passesTopicFilter(tweet.content)) return skip("话题不符");

  // 第二步：AI评估
  return await trendService.sendMessageStream({
    prompt: `评估此推文是否值得回复...`,
    onContent: (chunk) => {
      // 流式处理响应
    }
  });
}

interface EvaluationResult {
  shouldReply: boolean;          // 是否回复
  score: number;                 // 0-100分数
  reasons: string[];             // 评估原因
  suggestedTone: string;         // 建议语气
  topics: string[];              // 识别的话题
}
```

**快速过滤条件**：
- 转推判断：检查转推标志
- 排除名单：excludeHandles数组
- 最低点赞：minLikeCount阈值
- 内容长度：最少10字符
- 媒体检查：排除仅媒体推文
- 话题过滤：topicFilters匹配

### 4. ReplyGenerator（回复生成）
**文件**：`utils/ReplyGenerator.ts`

**职责**：
- 基于评估结果生成回复
- 参数化生成策略
- 验证生成内容

**生成流程**：
```typescript
async generate(
  tweet: TweetData,
  evaluation: EvaluationResult
): Promise<string> {
  // 1. 检测语言
  const language = detectLanguage(tweet.content);
  // 中文判断：/[\u4e00-\u9fff]/

  // 2. 构建提示词
  const prompt = buildPrompt({
    tweetContent: tweet.content,
    authorHandle: tweet.author.handle,
    topics: evaluation.topics,
    tone: settings.replyTone,        // casual/professional/humorous/etc
    language: language,
    maxLength: settings.maxReplyLength,
    customInstructions: settings.customInstructions,
  });

  // 3. 调用AI生成
  const reply = await trendService.sendMessageStream({
    prompt: prompt,
    onContent: (chunk) => {
      // 流式处理
    }
  });

  // 4. 验证内容
  if (!validateReply(reply)) {
    throw new Error("回复验证失败");
  }

  return reply;
}

// 验证规则
function validateReply(reply: string): boolean {
  // ✓ 非空
  if (!reply.trim()) return false;

  // ✓ 不超长
  if (reply.length > maxLength) return false;

  // ✓ 排除垃圾内容
  const blacklist = ['Hi there', 'Thanks for', '我是AI'];
  if (blacklist.some(pattern => reply.includes(pattern))) {
    return false;
  }

  return true;
}
```

**语气选项**：
- `casual` - 随意友好
- `professional` - 专业正式
- `humorous` - 幽默搞笑
- `informative` - 信息丰富
- `match_author` - 匹配作者风格

### 5. ReplyPoster（回复发布）
**文件**：`utils/ReplyPoster.ts`

**职责**：
- DOM交互发送回复
- 监控发送状态
- 处理错误

**发送流程**：
```typescript
async post(tweetId: string, replyContent: string): Promise<boolean> {
  try {
    // 1. 导航到推文详情页
    history.pushState(null, '', `/compose/${tweetId}`);
    await HumanBehaviorSimulator.randomDelay(100, 400);

    // 2. 点击回复按钮
    const replyBtn = document.querySelector('[aria-label="Reply"]');
    replyBtn?.click();
    await HumanBehaviorSimulator.thinkingPause(1, 3);

    // 3. 填充文本（使用paste避免逐字输入）
    const textArea = document.querySelector('textarea[aria-label="Post text"]');
    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: new DataTransfer(),
      bubbles: true
    });
    pasteEvent.clipboardData.setData('text/plain', replyContent);
    textArea?.dispatchEvent(pasteEvent);

    // 4. 点击发送
    const sendBtn = document.querySelector('[aria-label="Post"]');
    sendBtn?.click();

    // 5. 监控发送状态（等待响应）
    return await monitorPostStatus(10000); // 10秒超时

  } catch (error) {
    console.error("发送失败:", error);
    return false;
  }
}

async function monitorPostStatus(timeout: number): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    // 检查文本区域是否清空（发送成功的标志）
    const textArea = document.querySelector('textarea');
    if (!textArea?.value) {
      return true; // 发送成功
    }

    // 检查发送按钮是否恢复可点击状态
    const sendBtn = document.querySelector('[aria-label="Post"]');
    if (!sendBtn?.disabled) {
      // 可能发送失败，重试或返回失败
    }

    await new Promise(r => setTimeout(r, 200));
  }

  return false; // 超时
}
```

### 6. HumanBehaviorSimulator（人类行为模拟）
**文件**：`utils/HumanBehaviorSimulator.ts`

**职责**：
- 提供随机延迟
- 模拟人类操作间隔
- 实现自然的交互行为

**核心方法**：
```typescript
// 1. 基础延迟
static randomDelay(min: number, max: number): Promise<void>
  // 在[min, max]毫秒间随机延迟

// 2. 高斯分布延迟（更自然）
static gaussianDelay(mean: number, stdDev: number): Promise<void>
  // 使用高斯分布生成更符合人类的延迟

// 3. 微暂停
static microPause(): Promise<void>
  // 200-800ms 微暂停

// 4. 思考暂停
static thinkingPause(minSec: number, maxSec: number): Promise<void>
  // 思考时间（秒）

// 5. 阅读暂停
static readingPause(contentLength: number): Promise<void>
  // 基于内容长度的阅读暂停
  // 公式：length / avgReadSpeed + randomVariation

// 6. 回复间隔
static replyInterval(minSec: number, maxSec: number): Promise<void>
  // 高斯分布的回复间隔

// 7. 滚动行为
static randomScroll(): Promise<void>
  // 随机滚动0.7-0.9个视口高度

// 使用示例
await HumanBehaviorSimulator.randomDelay(100, 300);
await HumanBehaviorSimulator.thinkingPause(1, 3);
await HumanBehaviorSimulator.replyInterval(60, 180);
```

**延迟分布**：
```
高斯分布（正态分布）
  |
  |    ╱╲
  |   ╱  ╲
  |  ╱    ╲
  | ╱      ╲
  |╱────────╲
  └─────────────
    mean     max

优点：更接近人类行为，避免规律性
```

---

## 配置说明

### 用户设置接口
```typescript
interface AutoReplySettings {
  // 时间限制
  minIntervalSeconds: number;     // 最小间隔（秒）
  maxIntervalSeconds: number;     // 最大间隔（秒）

  // 数量限制
  dailyLimit: number;              // 每日最多回复数
  sessionLimit: number;            // 每次会话最多回复数

  // 账户过滤
  minFollowerCount: number;        // 最低粉丝数
  minLikeCount: number;            // 最低点赞数
  excludeHandles: string[];        // 排除账户名单
  onlyFollowing: boolean;          // 仅回复已关注账户

  // 内容策略
  replyTone: ReplyTone;            // 回复语气
  maxReplyLength: number;          // 最大字符数（默认280）
  customInstructions: string;      // 自定义指令
  topicFilters: string[];          // 话题过滤（包含）

  // 行为控制
  requireConfirmation: boolean;    // 发送前确认
  dryRunMode: boolean;             // 干运行模式
}

type ReplyTone = 'casual' | 'professional' | 'humorous' | 'informative' | 'match_author';
```

### 默认配置
```typescript
const DEFAULT_SETTINGS: AutoReplySettings = {
  minIntervalSeconds: 60,
  maxIntervalSeconds: 180,
  dailyLimit: 50,
  sessionLimit: 20,
  minFollowerCount: 0,
  minLikeCount: 5,
  topicFilters: [],
  excludeHandles: [],
  onlyFollowing: false,
  replyTone: 'casual',
  maxReplyLength: 280,
  customInstructions: '',
  requireConfirmation: true,
  dryRunMode: true
};
```

### 存储键
```typescript
const STORAGE_KEYS = {
  AUTO_REPLY_SETTINGS: 'bnbot_auto_reply_settings',
  AUTO_REPLY_SESSION: 'bnbot_auto_reply_session',
  AUTO_REPLY_DAILY_STATS: 'bnbot_auto_reply_daily_stats',
  AUTO_REPLY_HISTORY: 'bnbot_auto_reply_history',
  AUTO_REPLY_PROCESSED_TWEETS: 'bnbot_auto_reply_processed_tweets'
};
```

---

## 开发指南

### 添加新功能

#### 1. 修改推文过滤规则
**文件**：`utils/TweetEvaluator.ts`

```typescript
// 在快速过滤部分添加新规则
async evaluate(tweet: TweetData): Promise<EvaluationResult> {
  // ... 现有规则

  // 新规则：检查是否为链接推文
  if (hasExternalLink(tweet.content)) {
    return { shouldReply: false, reason: "包含外部链接" };
  }

  // ... 继续AI评估
}
```

#### 2. 修改回复生成策略
**文件**：`utils/ReplyGenerator.ts`

```typescript
// 在buildPrompt中添加新的参数化选项
function buildPrompt(options: GenerationOptions): string {
  return `
    评估下面的推文是否值得回复，请考虑：
    - 推文主题
    - 作者的粉丝数量
    - 新策略参数
    ...
  `;
}
```

#### 3. 添加新的人类行为模拟
**文件**：`utils/HumanBehaviorSimulator.ts`

```typescript
static async typingDelay(contentLength: number): Promise<void> {
  // 模拟打字延迟
  // 基于每分钟平均字数
  const avgWPM = 60;
  const avgCharPerWord = 5;
  const typingTime = (contentLength / avgCharPerWord / avgWPM) * 60000;
  await this.randomDelay(typingTime * 0.8, typingTime * 1.2);
}
```

### 扩展UI面板
**文件**：`components/panels/AutoReplyPanel.tsx`

```typescript
// 添加新的设置项
<div className="settings-section">
  <label>新功能选项</label>
  <input
    type="checkbox"
    checked={settings.newOption}
    onChange={(e) => updateSetting('newOption', e.target.checked)}
  />
</div>

// 监听新的事件
useEffect(() => {
  service.addEventListener('new_event', (data) => {
    console.log('新事件:', data);
  });

  return () => {
    service.removeEventListener('new_event');
  };
}, [service]);
```

### 添加新的事件类型
**文件**：`services/autoReplyService.ts`

```typescript
// 在合适的地方发布事件
private publishEvent(event: string, data: any) {
  const listeners = this.eventListeners.get(event) || [];
  listeners.forEach(callback => callback(data));
}

// 使用示例
this.publishEvent('new_event_type', { detail: data });
```

---

## 故障排查

### 常见问题

#### 1. "认证失败"错误
**原因**：API token过期或无效

**解决方案**：
```typescript
// 在TweetEvaluator中添加认证检查
try {
  const result = await trendService.sendMessageStream(options);
} catch (error) {
  if (error.message.includes('401')) {
    this.pauseSession();
    this.publishEvent('authentication_error', {
      message: '请重新登录'
    });
  }
}
```

#### 2. "推文采集停止"
**原因**：可能是DOM结构变化或网络问题

**调试步骤**：
```typescript
// 检查CSS选择器是否仍有效
const tweets = document.querySelectorAll('article[data-testid="tweet"]');
console.log('采集到推文数:', tweets.length);

// 检查MutationObserver是否运行
console.log('Observer活跃:', observer.isActive);

// 检查失败计数
console.log('连续失败次数:', failureCount);
```

#### 3. "发送失败"
**原因**：可能是DOM交互错误或网络问题

**调试步骤**：
```typescript
// 检查文本框是否可用
const textArea = document.querySelector('textarea[aria-label="Post text"]');
console.log('文本框存在:', !!textArea);
console.log('文本框可见:', textArea?.offsetParent !== null);

// 检查发送按钮
const sendBtn = document.querySelector('[aria-label="Post"]');
console.log('发送按钮可用:', !sendBtn?.disabled);
```

#### 4. "Token消耗过快"
**原因**：评估或生成操作频繁

**优化方案**：
```typescript
// 增加快速过滤规则，减少AI调用
const QUICK_FILTER_RULES = [
  (tweet) => tweet.metrics.likes < settings.minLikeCount,
  (tweet) => !tweet.content || tweet.content.length < 10,
  (tweet) => isRetweet(tweet),
];

// 使用缓存避免重复评估
const evaluationCache = new Map<string, EvaluationResult>();
```

### 调试模式

#### 启用详细日志
```typescript
// 在AutoReplyService中
const DEBUG_MODE = true;

function debug(message: string, data?: any) {
  if (DEBUG_MODE) {
    console.log(`[AutoReply] ${message}`, data);
  }
}
```

#### 使用干运行模式测试
```typescript
// 设置 dryRunMode: true
// 所有操作都不会真正发送，只记录日志
// 便于测试和调试
```

#### 检查存储数据
```typescript
// 浏览器开发工具Console
chrome.storage.local.get('bnbot_auto_reply_history', (data) => {
  console.log('自动回复历史:', data);
});
```

---

## 性能优化建议

1. **批量采集**：一次采集多条推文，减少DOM查询
2. **流式处理**：使用SSE流式API而非等待完整响应
3. **缓存评估**：相似内容复用评估结果
4. **限流控制**：严格遵守dailyLimit和sessionLimit
5. **错误降级**：评估或生成失败时自动降级

---

## 安全建议

1. **从不存储密钥**：所有API密钥由服务端管理
2. **验证输入**：AI生成的内容必须通过验证
3. **记录审计**：所有操作都应记录，便于审计
4. **速率限制**：严格遵守平台的速率限制
5. **人工审查**：定期审查发送的内容质量

---

## 版本历史

| 版本 | 日期 | 描述 |
|------|------|------|
| 1.0 | 2024-12 | 初始版本：核心功能完成 |

---

## 参考资源

- [Twitter/X API 文档](https://developer.twitter.com/en/docs)
- [Chrome Extension APIs](https://developer.chrome.com/docs/extensions/)
- [Gemini API 文档](https://ai.google.dev/docs)

---

**最后更新**：2026-01-01
**文档维护者**：开发团队
