/**
 * ExposurePredictionService v1.1
 *
 * 预测用户评论推文后能获得的曝光量
 * 基于推文数据和用户账号权重计算
 *
 * v1.1 更新：
 * - 加权互动率 (RT×30, Reply×20, Like×1)
 * - 蓝标门槛 B_gate (非蓝标砍85%)
 * - 账号健康度 A_health (基于账号年龄)
 * - 渗透率/生命周期阶段
 * - 分段排名转化率
 */

import { TimelineTweetData } from '../utils/HomeTimelineMonitor';
import { xUserStore } from '../stores/xUserStore';

// ============ 类型定义 ============

export interface UserProfile {
  screenName: string;
  followers: number;
  isBlue: boolean;
  createdAt?: string;  // v1.1: 账号创建时间
}

export type LifecyclePhase = 'launching' | 'accelerating' | 'peaking' | 'decaying' | 'dead';
export type TimingGrade = 'golden' | 'good' | 'late' | 'dead';

export interface ExposurePrediction {
  expected: number;           // 预期曝光量
  range: {
    low: number;              // 最低估计
    high: number;             // 最高估计
  };
  timing: TimingGrade;        // 时机评估
  phase: LifecyclePhase;      // v1.1: 生命周期阶段
  score: number;              // 推荐评分 0-100
  reason: { en: string; zh: string };  // 推荐理由（支持 i18n）
  hoursSincePost: number;     // 推文发布了多久
  // v1.1 新增
  penetrationRate: number;    // 渗透率
  accountHealth: number;      // 账号健康度 0.1-1.0
  blueGateApplied: boolean;   // 是否应用蓝标门槛
}

// ============ 用户资料缓存 ============

let cachedUserProfile: UserProfile | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30分钟缓存

/**
 * 获取当前用户的资料（带缓存）
 */
export function getCurrentUserProfile(): UserProfile | null {
  // 检查缓存
  if (cachedUserProfile && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return cachedUserProfile;
  }

  try {
    // 从 xUserStore 单例获取当前用户信息
    const userInfo = xUserStore.getUserInfo();
    if (!userInfo?.username) {
      console.warn('[ExposurePrediction] No user logged in');
      return null;
    }

    // 直接使用 xUserStore 中的数据
    const profile: UserProfile = {
      screenName: userInfo.username,
      followers: userInfo.followersCount || 0,
      isBlue: userInfo.isBlueVerified || false,
      createdAt: userInfo.createdAt || undefined,
    };

    cachedUserProfile = profile;
    cacheTimestamp = Date.now();

    return profile;
  } catch (err) {
    console.error('[ExposurePrediction] Failed to get user profile:', err);
    return null;
  }
}

// ============ v1.1 核心算法函数 ============

/**
 * 计算加权互动率
 * 基于 X 算法: RT×30, Reply×20, Like×1
 */
function calculateWeightedEngagement(tweet: TimelineTweetData): number {
  const weighted = (tweet.likeCount * 1) + (tweet.replyCount * 20) + (tweet.retweetCount * 30);
  return weighted / Math.max(tweet.viewCount, 1);
}

/**
 * 计算渗透率
 */
function calculatePenetrationRate(viewCount: number, authorFollowers: number): number {
  return viewCount / Math.max(authorFollowers, 1);
}

/**
 * 获取生命周期阶段
 */
function getLifecyclePhase(
  penetration: number,
  hoursSince: number,
  velocity: number,
  authorFollowers: number
): { phase: LifecyclePhase; potential: number } {
  const expectedVelocity = authorFollowers * 0.1;
  const velocityRatio = velocity / Math.max(expectedVelocity, 1);

  // 🚀 刚起步：渗透率低
  if (penetration < 0.05) {
    return { phase: 'launching', potential: 0.9 };
  }

  // 📈 加速期：渗透率中等，速度还不错
  if (penetration < 0.3 && velocityRatio > 0.5) {
    return { phase: 'accelerating', potential: 0.7 - penetration };
  }

  // 🔝 高峰期：渗透率较高，还在增长
  if (penetration < 0.6 && velocityRatio > 0.2) {
    return { phase: 'peaking', potential: 0.4 - penetration * 0.5 };
  }

  // 📉 衰退期
  if (penetration < 1.0 && hoursSince < 24) {
    return { phase: 'decaying', potential: Math.max(0.05, 0.2 - penetration * 0.15) };
  }

  // 💀 已凉
  return { phase: 'dead', potential: 0.02 };
}

/**
 * 获取蓝标门槛系数
 * 非蓝标用户曝光砍85%
 */
function getBlueGate(isBlue: boolean): number {
  return isBlue ? 1.0 : 0.15;
}

/**
 * 获取账号健康度
 * 基于账号年龄
 */
function getAccountHealth(createdAt?: string): number {
  if (!createdAt) return 1.0;

  const days = (Date.now() - new Date(createdAt).getTime()) / 86400000;

  if (days < 7) return 0.1;    // 新号基本没曝光
  if (days < 30) return 0.4;   // 1个月内受限
  if (days < 90) return 0.7;   // 3个月内略受限
  return 1.0;                   // 老号正常
}

/**
 * 获取媒体类型加成
 * 视频 > 图片 > 无媒体
 */
function getMediaBonus(mediaType: 'video' | 'image' | 'none'): number {
  switch (mediaType) {
    case 'video': return 1.5;   // 视频加成 50%
    case 'image': return 1.2;   // 图片加成 20%
    case 'none': return 1.0;    // 无媒体无加成
  }
}

/**
 * 获取半衰期（小时）
 */
function getHalfLife(authorFollowers: number): number {
  if (authorFollowers > 1000000) return 6;
  if (authorFollowers > 100000) return 3;
  if (authorFollowers > 10000) return 1.5;
  return 0.75;
}

/**
 * 计算评论密度惩罚
 * 评论越多，每条新评论能获得的曝光越少
 * 马斯克 1400+ 条评论，新评论几乎不可能被看到
 */
function getReplyDensityPenalty(replyCount: number): number {
  if (replyCount < 10) return 1.0;        // 评论少，无惩罚
  if (replyCount < 50) return 0.7;        // 中等评论数
  if (replyCount < 200) return 0.4;       // 评论较多
  if (replyCount < 500) return 0.2;       // 评论很多
  if (replyCount < 1000) return 0.1;      // 评论爆炸
  return 0.05;                             // 1000+ 评论，基本被淹没
}

/**
 * 获取超大V修正系数
 * 超大V的推文竞争激烈，实际曝光远低于理论值
 */
function getMegaInfluencerPenalty(authorFollowers: number): number {
  if (authorFollowers < 1000000) return 1.0;      // <100万，正常
  if (authorFollowers < 10000000) return 0.5;     // 100万-1000万，减半
  if (authorFollowers < 50000000) return 0.2;     // 1000万-5000万，打2折
  if (authorFollowers < 100000000) return 0.1;    // 5000万-1亿，打1折
  return 0.05;                                     // 1亿+（如马斯克），打0.5折
}

/**
 * 获取单条评论曝光上限
 * 即使是最热门的推文，单条评论的曝光也有天花板
 */
function getExposureCap(authorFollowers: number, replyCount: number): number {
  // 基础上限：根据作者粉丝数
  let baseCap = 50000; // 默认5万上限

  if (authorFollowers > 100000000) baseCap = 10000;   // 1亿+ 粉丝，上限1万
  else if (authorFollowers > 10000000) baseCap = 20000; // 1000万+ 粉丝，上限2万
  else if (authorFollowers > 1000000) baseCap = 30000;  // 100万+ 粉丝，上限3万

  // 评论多时进一步降低上限
  if (replyCount > 500) baseCap = Math.min(baseCap, 5000);
  else if (replyCount > 200) baseCap = Math.min(baseCap, 10000);
  else if (replyCount > 100) baseCap = Math.min(baseCap, 20000);

  return baseCap;
}

/**
 * 计算排名得分
 */
function calculateRankScore(
  userFollowers: number,
  isBlue: boolean,
  replyCount: number
): number {
  let score = 0;

  // 粉丝量贡献（降低权重：0.25 -> 0.15）
  score += Math.min(0.15, Math.log10(userFollowers + 1) / 20);

  // 蓝标贡献（提高权重：0.20 -> 0.25）
  if (isBlue) score += 0.25;

  // 早入场优势（提高权重）
  if (replyCount < 5) score += 0.30;
  else if (replyCount < 20) score += 0.18;
  else if (replyCount < 50) score += 0.10;
  else score += 0.03;

  return Math.min(0.8, score);
}

/**
 * 分段排名转化率
 */
function getRankShare(rank: number): number {
  if (rank <= 0) rank = 1;

  // 黄金区: Top 1-3
  if (rank <= 3) {
    return [0.25, 0.18, 0.12][rank - 1];
  }

  // 白银区: Top 4-10
  if (rank <= 10) {
    return 0.08 * Math.pow(0.75, rank - 4);
  }

  // 青铜区: Top 11-30
  if (rank <= 30) {
    return 0.02 * Math.pow(0.80, rank - 10);
  }

  // 折叠区: 30+
  return 0.005;
}

/**
 * 获取时机评级
 */
function getTimingGrade(phase: LifecyclePhase, hoursSince: number): TimingGrade {
  if (phase === 'launching' || (phase === 'accelerating' && hoursSince < 1)) {
    return 'golden';
  }
  if (phase === 'accelerating' || (phase === 'peaking' && hoursSince < 4)) {
    return 'good';
  }
  if (phase === 'peaking' || phase === 'decaying') {
    return 'late';
  }
  return 'dead';
}

/**
 * 获取不确定性因子
 */
function getUncertaintyFactor(hoursSince: number, viewCount: number): { low: number; high: number } {
  if (hoursSince < 1 && viewCount > 500) {
    return { low: 0.7, high: 1.4 };
  }
  if (hoursSince < 4 && viewCount > 200) {
    return { low: 0.5, high: 1.8 };
  }
  return { low: 0.3, high: 2.5 };
}

/**
 * 计算推荐评分 (0-100)
 */
function calculateScore(
  timing: TimingGrade,
  expected: number,
  viewCount: number,
  weightedEngagement: number
): number {
  let score = 0;

  // 时间分 (35分)
  switch (timing) {
    case 'golden': score += 35; break;
    case 'good': score += 25; break;
    case 'late': score += 10; break;
    case 'dead': score += 2; break;
  }

  // 曝光分 (35分)
  score += Math.min(35, Math.log10(expected + 1) / 3 * 35);

  // 热度分 (20分)
  score += Math.min(20, Math.log10(viewCount + 1) / 5 * 20);

  // 互动分 (10分)
  score += Math.min(10, weightedEngagement * 100);

  return Math.round(Math.min(100, score));
}

/**
 * 格式化数字
 */
function formatNumber(n: number, isZh: boolean): string {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  if (n >= 1000) return isZh ? n.toLocaleString() : (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return n.toString();
}

/**
 * 生成推荐理由（支持 i18n）
 */
function generateReason(
  timing: TimingGrade,
  _phase: LifecyclePhase,
  expected: number,
  range: { low: number; high: number },
  blueGateApplied: boolean
): { en: string; zh: string } {
  const rangeTextEn = `${formatNumber(range.low, false)} - ${formatNumber(range.high, false)}`;
  const rangeTextZh = `${formatNumber(range.low, true)} - ${formatNumber(range.high, true)}`;

  // 非蓝标警告
  if (blueGateApplied) {
    return {
      en: `⚠️ Non-blue account, limited exposure. Expected ${rangeTextEn}`,
      zh: `⚠️ 非蓝标账号，曝光受限。预计 ${rangeTextZh}`
    };
  }

  if (timing === 'golden') {
    return {
      en: `🔥 Golden time! Expected ${rangeTextEn}, comment now!`,
      zh: `🔥 黄金时间！预计曝光 ${rangeTextZh}，立即评论！`
    };
  }
  if (timing === 'good') {
    return {
      en: `✅ Worth commenting, expected ${rangeTextEn}`,
      zh: `✅ 值得评论，预计曝光 ${rangeTextZh}`
    };
  }
  if (timing === 'late') {
    if (expected > 100) {
      return {
        en: `⚠️ Past prime time, expected ${rangeTextEn}`,
        zh: `⚠️ 已过最佳时机，预计曝光 ${rangeTextZh}`
      };
    }
    return {
      en: `😐 Limited returns, expected ${rangeTextEn}`,
      zh: `😐 收益有限，预计曝光 ${rangeTextZh}`
    };
  }
  return {
    en: `🌘 Tweet is fading, expected only ${rangeTextEn}`,
    zh: `🌘 推文已进入尾声，预计曝光仅 ${rangeTextZh}`
  };
}

// ============ 核心预测算法 ============

/**
 * 预测评论曝光量 v1.1
 *
 * @param tweet - 推文数据（来自 HomeTimelineMonitor）
 * @param userProfile - 用户资料（可选，不传则自动获取）
 */
export function predictExposure(
  tweet: TimelineTweetData,
  userProfile?: UserProfile
): ExposurePrediction {
  // 获取用户资料
  const user = userProfile || getCurrentUserProfile();

  // 默认用户（未登录或获取失败时使用）
  const defaultUser: UserProfile = {
    screenName: 'unknown',
    followers: 100,
    isBlue: false
  };

  const profile = user || defaultUser;

  // ========== 1. 基础计算 ==========
  const hoursSincePost = calculateHoursSince(tweet.createdAt);
  const penetrationRate = calculatePenetrationRate(tweet.viewCount, tweet.followers);
  const velocity = tweet.viewCount / Math.max(hoursSincePost, 0.1);
  const weightedEngagement = calculateWeightedEngagement(tweet);

  // ========== 2. 生命周期阶段 ==========
  const { phase, potential } = getLifecyclePhase(
    penetrationRate,
    hoursSincePost,
    velocity,
    tweet.followers
  );

  // ========== 3. 未来增量 V_future ==========
  const halfLife = getHalfLife(tweet.followers);
  const decayFactor = Math.pow(0.5, hoursSincePost / halfLife);

  // 病毒系数
  const viralMultiplier = 1 + Math.min(4, weightedEngagement * 5);

  // 理论天花板（应用超大V惩罚）
  const megaInfluencerPenalty = getMegaInfluencerPenalty(tweet.followers);
  const theoreticalCeiling = tweet.followers * viralMultiplier * megaInfluencerPenalty;
  const remainingRoom = Math.max(0, theoreticalCeiling - tweet.viewCount);

  // 未来增量
  const vFuture = remainingRoom * potential * decayFactor * 0.3;

  // ========== 4. 排名转化率 R_rank ==========
  const rankScore = calculateRankScore(profile.followers, profile.isBlue, tweet.replyCount);
  const predictedRank = Math.max(1, Math.ceil(tweet.replyCount * (1 - rankScore)) + 1);
  const rRank = getRankShare(predictedRank);

  // 乐观/悲观排名
  const optimisticRank = Math.max(1, predictedRank - 3);
  const pessimisticRank = predictedRank + 5;
  const rRankOptimistic = getRankShare(optimisticRank);
  const rRankPessimistic = getRankShare(pessimisticRank);

  // ========== 5. 蓝标门槛 & 账号健康度 ==========
  const blueGate = getBlueGate(profile.isBlue);
  const accountHealth = getAccountHealth(profile.createdAt);
  const blueGateApplied = !profile.isBlue;

  // ========== 6. 评论密度惩罚 ==========
  const replyDensityPenalty = getReplyDensityPenalty(tweet.replyCount);

  // ========== 7. 回溯流量 V_backlog ==========
  const scrollRate = 0.015 * Math.pow(0.85, hoursSincePost / 4);
  const vBacklog = tweet.viewCount * scrollRate * replyDensityPenalty;

  // ========== 8. 综合计算 ==========
  const socialProofBonus = 1 + Math.log10(profile.followers + 100) / 15;
  const mediaBonus = getMediaBonus(tweet.mediaType || 'none');

  // 曝光上限
  const exposureCap = getExposureCap(tweet.followers, tweet.replyCount);

  // 期望值（应用评论密度惩罚和上限）
  const rawExpected = (vFuture * rRank * replyDensityPenalty) + vBacklog;
  const expected = Math.min(
    exposureCap,
    Math.max(10, Math.floor(rawExpected * blueGate * accountHealth * socialProofBonus * mediaBonus))
  );

  // 不确定性区间
  const uncertainty = getUncertaintyFactor(hoursSincePost, tweet.viewCount);

  // 最小值
  const rawLow = (vFuture * uncertainty.low * rRankPessimistic * replyDensityPenalty) + (vBacklog * 0.5);
  const low = Math.min(
    exposureCap,
    Math.max(5, Math.floor(rawLow * blueGate * accountHealth * socialProofBonus * mediaBonus))
  );

  // 最大值
  const rawHigh = (vFuture * uncertainty.high * rRankOptimistic * replyDensityPenalty) + (vBacklog * 1.5);
  const high = Math.min(
    exposureCap * 1.2,
    Math.floor(rawHigh * blueGate * accountHealth * socialProofBonus * mediaBonus * 1.2)
  );

  // ========== 9. 时机和评分 ==========
  const timing = getTimingGrade(phase, hoursSincePost);
  const score = calculateScore(timing, expected, tweet.viewCount, weightedEngagement);
  const reason = generateReason(timing, phase, expected, { low, high }, blueGateApplied);

  return {
    expected,
    range: { low, high },
    timing,
    phase,
    score,
    reason,
    hoursSincePost: Math.round(hoursSincePost * 10) / 10,
    penetrationRate,
    accountHealth,
    blueGateApplied
  };
}

/**
 * 计算发布时间（小时）
 */
function calculateHoursSince(createdAt: string): number {
  // Twitter API 返回格式: "Thu Jan 29 04:15:57 +0000 2026"
  const postTime = new Date(createdAt).getTime();
  return (Date.now() - postTime) / 3600000;
}

/**
 * 批量预测多条推文
 */
export function predictBatch(
  tweets: TimelineTweetData[]
): Map<string, ExposurePrediction> {
  const userProfile = getCurrentUserProfile();
  const results = new Map<string, ExposurePrediction>();

  for (const tweet of tweets) {
    const prediction = predictExposure(tweet, userProfile || undefined);
    results.set(tweet.tweetId, prediction);
  }

  return results;
}

/**
 * 获取推荐评论的推文（按评分排序）
 */
export function getRecommendedTweets(
  tweets: TimelineTweetData[],
  minScore: number = 50
): Array<{ tweet: TimelineTweetData; prediction: ExposurePrediction }> {
  const predictions = predictBatch(tweets);

  const recommended = tweets
    .map(tweet => ({
      tweet,
      prediction: predictions.get(tweet.tweetId)!
    }))
    .filter(item => item.prediction.score >= minScore)
    .sort((a, b) => b.prediction.score - a.prediction.score);

  return recommended;
}
