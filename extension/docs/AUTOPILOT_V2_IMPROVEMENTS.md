# AutoPilot V2 改进文档

> 更新日期: 2026-01-30

## 概述

本次改进主要解决 AutoPilot 的两个核心问题：

| 问题 | 之前 | 改进后 |
|------|------|--------|
| 推文数据获取 | DOM 抓取 + hover 头像获取粉丝数（慢、不稳定） | API 拦截直接获取完整数据（即时） |
| 打分机制 | 每条推文调用 AI 评估（成本高、2-5秒延迟） | 本地 `predictExposure()` 算法（零成本、<10ms） |

## 改进效果

| 方面 | 之前 | 改进后 |
|------|------|--------|
| 数据获取速度 | hover 头像 (2-3秒/推文) | API 缓存 (即时) |
| 数据完整性 | 可能失败 | API 数据完整 |
| 打分速度 | AI 调用 (2-5秒) | 本地算法 (<10ms) |
| 成本 | API 费用 | 零成本 |
| 稳定性 | 依赖 DOM 结构 | 不依赖 DOM |

---

## 修改的文件

### 1. `public/timeline-interceptor.js`

**改动**: 扩展 API 监听范围

```javascript
// 之前：只监听 HomeTimeline
if (url.includes('/HomeTimeline') || url.includes('/HomeLatestTimeline'))

// 现在：监听更多端点
const MONITORED_ENDPOINTS = [
  { pattern: '/HomeTimeline', type: 'timeline' },
  { pattern: '/HomeLatestTimeline', type: 'timeline' },
  { pattern: '/Notifications', type: 'notifications' },
  { pattern: '/TweetDetail', type: 'tweet_detail' },
  { pattern: '/UserTweets', type: 'user_tweets' },
];
```

**新增消息类型**:
- `BNBOT_TIMELINE_DATA` - 保持向后兼容
- `BNBOT_API_DATA` - 统一的 API 数据消息，包含 `endpoint` 和 `payload`

---

### 2. `utils/ApiDataCache.ts` (新建)

**功能**: 统一管理从 API 拦截的推文数据

```typescript
class ApiDataCache {
  private tweetCache: Map<string, TimelineTweetData> = new Map();

  start(): void;                    // 开始监听 BNBOT_API_DATA 消息
  stop(): void;                     // 停止监听
  getTweet(tweetId: string): TimelineTweetData | undefined;  // 获取缓存的推文
  getAllTweets(): TimelineTweetData[];  // 获取所有缓存的推文
  size(): number;                   // 缓存大小
  hasTweet(tweetId: string): boolean;   // 检查是否有缓存
  clear(): void;                    // 清空缓存
}

export const apiDataCache = new ApiDataCache();
```

**支持的 API 端点解析**:

| 端点 | 类型 | 数据路径 |
|------|------|----------|
| HomeTimeline | timeline | `data.home.home_timeline_urt.instructions` |
| Notifications | notifications | `data.notifications.notifications_timeline_urt.instructions` |
| TweetDetail | tweet_detail | `data.tweetResult.result` |
| UserTweets | user_tweets | `data.user.result.timeline_v2.timeline.instructions` |

---

### 3. `utils/TweetEvaluator.ts`

**改动**: 替换 AI 评估为本地算法

```typescript
async evaluate(tweet: ScrapedTweet): Promise<TweetEvaluation> {
  // 1. 优先从 API 缓存获取完整数据
  const cachedData = apiDataCache.getTweet(tweet.id);
  if (cachedData) {
    console.log('[TweetEvaluator] Using API cache data for tweet:', tweet.id);
    tweet.authorFollowers = cachedData.followers;
    tweet.authorBio = cachedData.bio;
  } else {
    // Fallback: hover 获取（保留兼容性）
    await this.fetchAuthorDetails(tweet);
  }

  // 2. 快速过滤
  const filterReason = this.checkQuickFilters(tweet);
  if (filterReason) {
    return { shouldReply: false, ... };
  }

  // 3. 使用曝光预测算法打分（替代 AI）
  const timelineData = this.convertToTimelineTweetData(tweet);
  const prediction = predictExposure(timelineData);

  // 4. 检查最小曝光阈值
  const minExpectedExposure = this.settings.minExpectedExposure || 0;
  if (minExpectedExposure > 0 && prediction.expected < minExpectedExposure) {
    return {
      shouldReply: false,
      reasons: [`Expected exposure too low (${prediction.expected} < ${minExpectedExposure})`],
      ...
    };
  }

  // 5. 根据预测结果决定是否回复
  const shouldReply = prediction.score >= 50 && prediction.timing !== 'dead';
  return { shouldReply, score: prediction.score, ... };
}
```

**新增方法**:
- `convertToTimelineTweetData(tweet)` - 将 ScrapedTweet 转换为 TimelineTweetData 格式

---

### 4. `types/autoReply.ts`

**改动**: 添加新设置项

```typescript
interface AutoReplySettings {
  // ... 其他设置
  minExpectedExposure: number;  // 最小预期曝光阈值 (默认: 0)
}

const DEFAULT_AUTO_REPLY_SETTINGS = {
  // ...
  minExpectedExposure: 0,  // 0 = 不过滤
};
```

---

### 5. `components/panels/AutoReplyPanel.tsx`

**改动**: 添加设置 UI

```tsx
{/* Min Expected Exposure */}
<div className="col-span-2">
  <label className="text-xs text-[var(--text-secondary)] block mb-1">
    {t.autoPilot.config.minExpectedExposure}
  </label>
  <input
    type="number"
    value={(settings as any).minExpectedExposure ?? 0}
    onChange={(e) => handleSettingChange('minExpectedExposure', parseInt(e.target.value) || 0)}
    min={0}
    step={100}
    placeholder="0"
  />
  <p className="text-xs text-[var(--text-tertiary)] mt-1">
    {t.autoPilot.config.minExpectedExposureHint}
  </p>
</div>
```

---

### 6. `locales/en.ts` 和 `zh.ts`

**改动**: 添加国际化文案

```typescript
// en.ts
config: {
  // ...
  minExpectedExposure: 'Min Expected Exposure',
  minExpectedExposureHint: '0 = no filtering. Uses local prediction algorithm.',
}

// zh.ts
config: {
  // ...
  minExpectedExposure: '最小预期曝光',
  minExpectedExposureHint: '0 = 不过滤。使用本地预测算法。',
}
```

---

### 7. `services/autoReplyService.ts`

**改动**: 初始化和清理 API 缓存

```typescript
import { apiDataCache } from '../utils/ApiDataCache';

async start() {
  // 启动 API 缓存监听
  console.log('[AutoReplyService] Starting API data cache...');
  apiDataCache.start();
  // ...
}

stop() {
  // 停止缓存监听
  apiDataCache.stop();
  // ...
}
```

---

## 数据流

```
Twitter API 响应
    ↓
timeline-interceptor.js (拦截)
    ↓
postMessage({ type: 'BNBOT_API_DATA', endpoint, payload })
    ↓
ApiDataCache.handleApiData() (解析并缓存)
    ↓
TweetEvaluator.evaluate()
    ↓
apiDataCache.getTweet(id) → 获取完整数据 (followers, bio, etc.)
    ↓
predictExposure() → 本地算法打分
    ↓
检查 minExpectedExposure 阈值
    ↓
返回评估结果
```

---

## 新增设置说明

### minExpectedExposure (最小预期曝光)

- **类型**: `number`
- **默认值**: `0` (不过滤)
- **作用**: 只回复预期曝光量 >= 此阈值的推文
- **算法**: 使用 `exposurePredictionService.predictExposure()` 计算

**推荐设置**:

| 场景 | 值 | 说明 |
|------|-----|------|
| 不过滤 | 0 | 默认，不按曝光过滤 |
| 保守 | 1000 | 只回复预期曝光 1000+ 的推文 |
| 激进 | 100 | 回复更多推文 |

---

## 相关文档

- [AUTO_REPLY_DOCUMENTATION.md](./AUTO_REPLY_DOCUMENTATION.md) - AutoPilot 完整文档
- [EXPOSURE_PREDICTION_ALGORITHM.md](./EXPOSURE_PREDICTION_ALGORITHM.md) - 曝光预测算法详解
- [HOME_TIMELINE_MONITOR.md](./HOME_TIMELINE_MONITOR.md) - 时间线监控文档

---

## 验证方法

1. **构建扩展**: `npm run build`
2. **打开 AutoPilot 设置**: 确认"最小预期曝光"输入框显示
3. **设置阈值**: 比如设置为 1000
4. **运行 AutoPilot**:
   - 控制台应显示 `[TweetEvaluator] Using API cache data for tweet XXX`
   - 不应再看到 hover 用户头像的操作（除非缓存未命中）
   - 低于阈值的推文应被跳过，日志显示 `Expected exposure too low`
