# Changelog

All notable changes to BNBOT will be documented in this file.


## [0.11.0] - 2026-04-22

### Removed
- **登录 UI 全部下线，登录归 CLI 拥有**: extension 不再做 OAuth flow，token 由 CLI 通过 `inject_auth_tokens` WS action 推送进来（这条 bridge 一直存在，没用上）。架构对齐"extension = 浏览器执行层 / CLI = 智力 + auth 入口"。
  - 删 `components/panels/LoginPanel.tsx`（415 LOC）— Google + 邮箱 OTP 登录页
  - 删 `components/modals/LoginModal.tsx`（473 LOC）— 弹窗版登录
  - 删 `oauth-callback.ts`（30 LOC）— OAuth redirect 处理（已 unused）
  - `services/authService.ts` 删 `googleLogin / sendVerificationCode / verifyCode / processLoginResponse / LoginResponse interface` + `clearAllCachedAuthTokens` 调用
  - `background.ts` 删 `handleGoogleLogin` 函数 + `GOOGLE_LOGIN` 消息 handler + `GOOGLE_CLIENT_ID` / `OAUTH_REDIRECT_URI` 常量 + `clearAllCachedAuthTokens` 调用
  - `App.tsx` 去 LoginPanel/LoginModal imports + `showLoginModal` / `showLoginPanel` state，合并成单一 `showLoginHint`，未登录时显示"在终端运行 `bnbot login`"占位
  - `manifest.json` + `manifest.firefox.json` 去掉 `identity` permission（OAuth 没了不用申请）
  - `.env.production` 去掉 `GOOGLE_CLIENT_ID` 环境变量
- **保留**: BoostPanel / CreditsPanel / XAnalyticsPanel / XBalancePanel 全部完整保留，只是 token 来源从 OAuth 换成 CLI bridge。`authService.fetchWithAuth` / `refreshAccessToken` / `getAccessToken` / `saveTokens` 等所有 token 消费链路不动。
- 砍 ~1,050 LOC + 1 个权限

## [0.10.1] - 2026-04-22

### Removed
- **TikTok 视频搬运残留全删**: 旧"搬运"流程（下载 TikTok 视频 → base64 → 后端再发 X）已被 `/remix` skill 替代，扩展里残留的 ~600 LOC 死路径下线：
  - 删 `utils/VideoDownloadManager.ts`（往 X 分享菜单注入"下载视频"按钮，无消费者）
  - 删 `services/tiktokService.ts` + `services/actions/tiktokActions.ts`（fetch_tiktok_video 路径）
  - 删 `background.ts` 里的 `fetchTiktokVideo` / `fetchTiktokVideoV2` 两个函数 + `TIKTOK_FETCH` / `TIKTOK_FETCH_V2` 消息 handler + `TikTokVideoData` interface（~300 LOC）
  - 删 `actionRegistry.ts` 的 `FETCH_TIKTOK_VIDEO` 定义和注册
  - 删 `actionExecutor.ts` 的 `NO_INDICATOR_ACTIONS` 列表中的 `'fetch_tiktok_video'`
  - 删 `types/action.ts` 的 INTERRUPT_ACTIONS 里的 `'fetch_tiktok_video'`
  - 删 `services/actions/index.ts` 的 tiktokHandlers 引用
  - 删 `index.tsx` 里的 VideoDownloadManager 实例化和 tiktokService side-effect import
- **保留**: `videoCacheService.ts`（其它地方可能用）、`searchTikTok` / `fetchTikTokExplore` / `getTikTokProfile` / `likeTikTok`（CLI `bnbot tiktok search` / `explore` 仍依赖）
- 砍 ~600 LOC，bundle minified 再减 10KB（2,121 → 2,111）

## [0.10.0] - 2026-04-22

### Removed
- **整个日程 / Schedule UI 下线**: 排期统一迁到 `bnbot calendar` + macOS launchd（skill: `/schedule`），扩展不再承载日历界面。
  - 删 `components/panels/SchedulePanel.tsx`（564 LOC）— 日历主面板
  - 删 `components/modals/TweetCalendarModal.tsx`（1,678 LOC）— 已经是 orphan
  - `commandService.ts` 删 `EXECUTE_SCHEDULED_TASK` / `PUBLISH_SCHEDULED_DRAFT` message handlers + `handleAlarmTriggeredTask` / `handleScheduledDraftPublish` 两个方法（chrome.alarms 死路径）
  - `draftService.ts` 删 `scheduleDraft` / `unscheduleDraft` / `getCalendarDrafts` / `getPendingDrafts` / `notifyDraftAlarmSync` / `notifyDraftAlarmRemove` 六个 schedule 相关方法（保留 saveTweetDraft / deleteDraft 等核心方法）
  - `RewrittenTimeline.tsx` 删 schedule picker modal、Calendar 按钮、`scheduledDate` / `showSchedulePicker` 等 state、`initialScheduledAt` / `draftId` props（后者已没人传）
  - `App.tsx` 去 SchedulePanel import + `Tab.DRAFTS` case
  - `Sidebar.tsx` 去 DRAFTS nav 项 + `CalendarDays` icon import
  - `types.ts` 的 `Tab.DRAFTS` enum 也下线
  - 砍量约 **3,200 LOC**，bundle minified 减 ~30KB

## [0.9.7] - 2026-04-22

### Fixed
- **Delete 回复时找错 tweet 的 bug**: reply 的详情页里会显示父推（被回复的人）+ 焦点推（自己的回复），`SEL.caretMain` 旧实现是 `document.querySelector('[data-testid="caret"]')`，命中的是**父推**的 `...` 菜单 —— 里面没有"删除"选项，所以报 `delete menu item not found — not your tweet?`。改成从 `tweetUrl` 抽 `tweetId`，遍历 `article[data-testid="tweet"]` 找内含 `a[href*="/status/<tweetId>"]` 的那一条，点它内部的 caret。CDP 版（`deleteViaDebugger`）和 DOM 版（`deleteTweetHandler`）都修了。

## [0.9.6] - 2026-04-22

### Added
- **`bnbot x navigate url` 改走 CDP**: 新增 `navigateTabViaCdp` handler（background.ts），用 `Page.navigate` 在 scraper pool 的 x.com tab 上换页，而不是之前走 content-script `window.history.pushState`。老路径依赖 action 系统路由，可能跳到用户主浏览器的 X tab 污染视图；CDP 路径确定性路由到 bnbot pool tab，还支持跨源。
- **`waitForTabComplete` helper**: 监听 `chrome.tabs.onUpdated` 等 `status=complete` + render delay，替代之前 screenshot `--url` 的固定 2.5s 等待（x.com SPA splash 页没等够会截到 X logo）。

### Changed
- **Scraper 窗口统一复用**: 新增 `scraperWindowIds` set 独立追踪 bnbot 开的窗口，`openScraperWindow`（getTab 内用）和 `openTabInScraperWindow`（screenshot / navigate --url 用）都先 prune + 复用活着的窗口，不再每次测试叠一个新窗口。`chrome.windows.onRemoved` 自动清理死窗口 ID。
- **Screenshot `--url` 只复用 scraper 窗口里的 tab**: 之前 startsWith 匹配全局任意 tab，可能撞到用户主浏览器的 X tab。现在要求匹配 tab 在 scraperWindowIds 里，否则开新 tab。

## [0.9.5] - 2026-04-21

### Fixed
- **CDP write ops 永远 timeout 的严重 bug**: `waitForJsonResponse` 之前只监听 `Network.responseReceived`（headers 到了就触发），然后立即 `getResponseBody` —— body 还没完整传完，直接 reject 整个 promise，CLI 报 timeout。**改成** 监听 `Network.loadingFinished`（body 完整传完），加 3 次 retry 兜底。
- **Quote / 长推文发送时监听错 endpoint**: quote 推走 `/CreateNoteTweet`（而不是 `/CreateTweet`），response 在 `data.notetweet_create` 不在 `data.create_tweet`。所有 4 个写命令（post / reply / quote / thread）改成同时监听两个 URL patterns，response 解析 fallback 两个路径（`extractCreatedId` helper）。

### Changed
- **Sidebar 下半部分紧凑布局修正**: 设置齿轮 + 用户头像从独立 flex container 合并到 tab 按钮下方同一 flex group，间距统一 16px。

## [0.9.4] - 2026-04-21

### Changed
- **FAB / popup 联动定位**: FAB 每次对齐 Grok 时广播 `bnbot-fab-aligned` event，popup 监听并把自己锚在 FAB 上方 12px（`bottom = fab.bottom + fab.height + 12`），避免 popup 盖住 FAB。max-height 也跟 FAB 位置联动。
- **FAB 尺寸对齐 Grok**: 从 44×44 改为 **54×54**（跟 GrokDrawerHeader 一致），logo 从 28 → 32，圆角 12 → 14。
- **FAB 水平居中对齐 Grok 垂直中线**: `right` 不再写死 20px，按 Grok 的 `right` edge 动态计算。
- **Sidebar 紧凑布局**: 设置齿轮 + 用户头像从 `marginTop: auto` 改为 `marginTop: 16px`，跟功能 tab 紧挨着（统一 16px gap），去掉中部大块留白。

## [0.9.3] - 2026-04-21

### Changed
- **Sidebar → 右下 popup**: 面板从占满整个右侧 slide-in 改成右下浮层（420×min(640, viewport-180)）。触发入口改成独立 FAB，位置在 X 的 Grok drawer 上方（`right: 20px; bottom: 90px`）。
- 点 FAB 弹出 / 关闭，popup 带圆角阴影 + fade/translate 动画。

### Added
- **`utils/BnbotFabInjector.ts`**: 独立 content-script 注入 FAB（44×44 圆角卡片 + logo），不依赖 X 的 DOM 层级（`position: fixed`），抗 X 布局更新。

### Removed
- **旧"Tail Button"和"Collapse Button"**: FAB 接管显隐，不再需要边缘 slide 触发器和折叠按钮。

## [0.9.2] - 2026-04-21

### Removed
- **HomeTimelineMonitor 整个删**: 曝光预测 badge 注入 + 时间线 API 拦截监控类下线。预测算法已完整迁移到 `/auto-reply` skill 内联（v1.1 公式含 halflife / rank share / blue multiplier），扩展侧不再需要本地预测。
- **曝光预测开关 + 阈值输入**: Sidebar settings 里的 toggle 和高亮阈值输入框下线，`App.tsx` 的 `exposurePredictionEnabled` / `exposureThreshold` state + handler 全清。
- **`bnbot:exposure-threshold-changed` event**: 无消费者，删除事件派发。
- **locales `exposurePrediction` / `highlightThreshold` keys**: 下线。

### Changed
- **`TimelineTweetData` interface 迁移**: 从 `utils/HomeTimelineMonitor.ts`（已删）搬到 `utils/ApiDataCache.ts`，仍被 ApiDataCache + ChatPanel 正常使用。

## [0.9.1] - 2026-04-21

### Removed
- **AnalyzeButtonInjector 整个清掉**: 推文页注入的五个按钮全部下线 — AI 回复、AI 图片回复、AI 引用、Analyze (推文分析)、Thread Summary (线程合并)。这些 AI 写+读的入口迁移到桌面 agent 的 `/reply` / `/quote` / `/remix` skill。
- **TweetContextPanel.tsx**: 已经不渲染了，彻底删文件。
- **ChatPanel `contextActions`**: 推文详情页 chat 模式下的 3×3 action grid 下线。
- **App.tsx `bnbot-analyze-tweet` 事件监听**: 连带下线。
- **`locales/{zh,en}.ts xAgent` 块**: 整段删除 (analyze/reply/quote/similar/threads/factCheck/imageReply/summary 等字段全部下线)。

## [0.9.0] - 2026-04-21

### Removed
- **Auto-reply / autopilot / scheduler**: 1500+ LOC 移动到 bnbot CLI + `/auto-reply`、`/inbox-triage`、`/inbox-watch` skill（extension 不再判断，只做 CDP 执行层）。
- **Chat / Auto Reply 侧边栏 Tab**: 从 Sidebar 去掉。
- **二创 (Tweet Remix / AI 复写)**: 侧边栏 suggestion 卡片、推文详情页"二创"按钮、xAgent AI 复写 action、相关 i18n 全部移除。能力迁移到 bnbot 桌面 app 的 `/remix` skill。
- **notificationHandlers**: notification 分类 / 处理全部改走 `/inbox-triage` skill。
- **Draft alarm scheduler**: 定时发布改走 `bnbot calendar` 单 tick 调度 + `~/.bnbot/calendar/<date>.json`。

### Changed
- **commandService**: `start_autopilot` / `stop_autopilot` / `get_status` / `handleScheduledTrigger` 等 bridge action 改为抛错并提示调用方走 CLI。
- **background**: 去掉 taskAlarmScheduler 启动和 7 个调度相关的 message 路由。

## [0.8.0] - 2026-04-18

### Added
- **TikTok 扩展**: 获取用户 Profile(`TIKTOK_PROFILE`)、点赞视频(`TIKTOK_LIKE`)
- **Reddit 扩展**: 点赞/踩(`REDDIT_UPVOTE`)、收藏/取消收藏(`REDDIT_SAVE`)、首页(`REDDIT_FRONTPAGE`)、读帖子+评论(`REDDIT_POST`)、用户信息(`REDDIT_USER`)、订阅/取消订阅(`REDDIT_SUBSCRIBE`)
- **Bilibili 扩展**: 动态(`BILIBILI_DYNAMIC`)、历史记录(`BILIBILI_HISTORY`)、关注列表(`BILIBILI_FOLLOWING`)、用户视频(`BILIBILI_USER_VIDEOS`)、评论(`BILIBILI_COMMENTS`)
- **Zhihu 扩展**: 点赞回答/文章(`ZHIHU_LIKE`)、获取问题回答(`ZHIHU_QUESTION`)

## [0.7.6] - 2026-04-18

### Added
- **YouTube 写操作**: 点赞(`YOUTUBE_LIKE`)、取消点赞、订阅频道(`YOUTUBE_SUBSCRIBE`)、取消订阅，通过 InnerTube API + SAPISIDHASH 认证
- **YouTube 读操作**: 获取主页推荐(`YOUTUBE_FEED`)、观看历史(`YOUTUBE_HISTORY`)、稍后观看(`YOUTUBE_WATCH_LATER`)、订阅频道列表(`YOUTUBE_SUBSCRIPTIONS`)
- **Skill 新爬虫**: `crawl-eastmoney.js`（东方财富热股榜）、`crawl-nowcoder.js`（牛客网热搜）

### Fixed
- **Twitter 视频下载**: `VideoDownloadManager.downloadVideo` 改用 `chrome.downloads` API，视频现在会真正下载而非只在新标签页打开

### Synced
- opencli v1.7.4: 同步 YouTube 全量操作、东方财富/牛客热榜等新平台

## [0.7.5] - 2026-04-18

### Fixed
- **Scraper 抗扩展冲突**: 重构 scraper 窗口创建和 debugger attach 逻辑，大幅减少与其他扩展的冲突
  - `getTab` 改用 `chrome.windows.create({ focused: false })` 开独立窗口，绕过 `chrome.tabs.onCreated` 被其他扩展劫持的问题
  - 不再使用 `state: 'minimized'`（Chrome 会节流最小化窗口，导致页面加载不完 → debugger attach 失败）；改为 `focused: false` 创建 + 加载完成后再 `chrome.windows.update({ state: 'minimized' })`
  - `waitForLoad` 升级为轮询目标 hostname，不再只等 `status === 'complete'`
  - `executeInPage` 使用 `{targetId}` 代替 `{tabId}` 进行 attach，减少跨 frame 的安全检查冲突
  - 新增 `chrome.windows.onRemoved` 监听，清理用户手动关闭 scraper 窗口后 pool 里的死条目
  - 已知不兼容扩展：Relingo (`dpphkcfmnbkdpmgneljgdhfnccnhmfig`) — 需禁用或限制站点权限

### Removed
- **cookies 权限**: 移除未使用的 `cookies` permission

## [0.7.1] - 2026-04-01

### Added
- **Scraper Service**: 内置 19 个平台的数据抓取服务，通过 `chrome.scripting.executeScript()` 在页面上下文调用网站内部 API
  - 已支持：TikTok, YouTube, Reddit, Bilibili, 知乎, 雪球, Instagram, Linux.do, 即刻, 小红书, 微博, 豆瓣, Medium, Google, Facebook, LinkedIn, 36氪, Product Hunt, 微信, Yahoo Finance
  - Tab 池化复用，30 秒空闲自动关闭
  - 未登录时友好提示"Please sign in to [Platform] first"
  - 30 秒超时兜底防止 Promise 挂住
- **bnbot-cli**: 新增 11 个 PUBLIC API 命令（HackerNews, StackOverflow, Wikipedia, Apple Podcasts, Substack, V2EX, Bloomberg, BBC, 新浪财经, 新浪博客, 小宇宙），直接 fetch 不需要浏览器

### Removed
- **OpenCLI Bridge**: 移除内置的 opencli browser bridge（`services/opencli/` 目录）
- **debugger 权限**: 不再需要，安装时不会提示"访问页面调试程序后端"和"所有网站"
- **动态图标**: 移除基于 bridge 连接状态的图标变色逻辑
- **Spotify/ONES 抓取器**: Spotify API 拦截扩展请求，ONES 需要特定环境

### Changed
- **scripting 权限**: 替代 debugger，使用 `chrome.scripting.executeScript()` 在目标页面执行 JS
- **架构分层**: 需要登录态的抓取走扩展（19 个），公开 API 走 CLI（11 个）

## [0.6.3] - 2026-04-01

### Fixed
- **OpenCLI Bridge CORS 修复**: ping 请求改用 `mode: 'no-cors'`，修复 Chrome MV3 service worker 因 CORS 策略拦截 daemon ping 导致 bridge 无法连接的问题

### Changed
- **动态图标状态**: 扩展图标根据 OpenCLI Bridge 连接状态变化——连接时显示彩色，断开时显示灰色
- **Bridge 状态持久化**: OpenCLI Bridge 的启用状态存储到 `chrome.storage.local`，重启浏览器后保持

## [0.6.2] - 2026-03-31

### Changed
- **新 Logo**: 像素风龙虾机器人 Logo，替换旧 3D 风格 mascot
- **主题色更新**: accent 颜色从金色 (#facc15) 改为珊瑚红 (#ff4d4d)
- **发送按钮**: 聊天框发送按钮改为黑色
- **二创/AI 引用**: 点击推文详情的"二创"和"AI 引用"按钮直接在 Chat 面板发送消息，未登录自动弹出登录

### Removed
- **推文详情面板 (@)**: 移除 TweetContextPanel 及侧边栏 @ 按钮，推文详情页默认显示 Chat 面板
- **Trend 面板常驻开关**: 移除"常驻"toggle
- **长推合并**: 移除"长推合并"功能卡片

## [0.6.1] - 2026-03-31

### Added
- **切换账号 Action**: 新增 `switch_account` action，支持通过 CLI/MCP 在已登录的 Twitter 账号间切换，自动检测当前账号避免重复切换
- **扩展状态 Action**: 新增 `get_extension_status` action，返回扩展版本号、名称和当前页面 URL

### Fixed
- **Extension context invalidated 保护**: 发推（postThread/postTweetWithVerify/postThreadWithVerify）、TweetPostInterceptor、Sidebar 轮询等所有 `chrome.runtime` 调用加 try-catch 保护，扩展重载后给出"请刷新页面"提示而非 uncaught error
- **CRXJS HMR 补丁**: dev 模式下 `vendor/crx-client-port.js` 的 `chrome.runtime.connect()` 包裹 try-catch，消除扩展重载时的 console 报错

### Changed
- **侧边栏默认收起**: 页面加载后侧边栏默认收起，用户点击展开

## [0.6.0] - 2026-03-31

### Added
- **OpenCLI Bridge**: 集成 opencli 协议，支持 8 种 action（exec/navigate/tabs/cookies/screenshot 等），用户无需单独安装 opencli 扩展
- **scrapeUserTweets 分页**: 支持获取超过 20 条用户推文，返回完整推文内容（文本、指标、媒体）

### Changed
- **插件体积 65MB → 2.6MB**（减少 96%）
  - 移除 FFmpeg/YouTube 视频合并功能（31MB wasm）
  - 移除未使用的 logo 候选图片（30MB）
  - 压缩 logo 从 906x906 到 256x256（886KB → 100KB）
  - 用 fetch 替代 Apollo/GraphQL/Viem（useVaultBalance）
  - 移除未使用的 echarts/echarts-for-react 依赖

### Removed
- YouTube 视频搬运功能（FFmpeg 合并、YouTubeProcessor、youtubeActions）
- YouTube Repost 建议卡片和输入模式
- dev/prod 环境图标复制逻辑（copyEnvIcons）

## [0.5.30] - 2026-03-27

### Added
- **推文分析按钮**: 在每条推文的 Grok 按钮旁注入 BNBot logo 图标，点击打开侧边栏分析推文
- **AI 回复按钮**: 展开回复框后显示「🦞回复」按钮，点击直接在输入框生成 AI 回复（chat-v2，2-5秒）
- **二创按钮**: 推文详情页顶部右侧「🦞二创」按钮，点击触发 AI 复写当前推文
- **AnalyzeButtonInjector**: 新注入器，基于 data-testid 定位

### Changed
- **"打开 BNBot"** 改为 logo 图标
- **Hi 页面** 挥手 emoji 改为 logo
- **BNBOT → BNBot** 统一品牌名称
- **Crypto/AI 标签** 加 cursor-pointer
- **常驻开关** 灰色加深
- **Boost 箭头按钮** 加 cursor-pointer

## [0.5.29] - 2026-03-26

### Changed
- **X Agent 页面重设计**: editorial 风格标题，卡片 hover 金色渐变 + 浮起效果，更紧凑的布局

## [0.5.28] - 2026-03-26

### Fixed
- **Boost API 端点迁移**: `/api/v1/boost` → `/api/v1/engage`，修复 Boost 活动无法加载
- **移除推文黑框**: TweetObserver 不再给所有可见推文添加黑色边框
- **暗色模式适配**: Boost 堆叠卡片、侧边栏 tooltip 适配暗色主题

### Changed
- **Money Vision 默认开启**: 移除 Money Vision 开关，功能始终启用
- **Boost 卡片重构**: 多活动卡片不再展开，活动数显示在右上角，总金额（USD）显示在右下角，支持滚动加载
- **OpenClaw 状态**: 移除端口号显示，仅保留状态灯和刷新按钮
- **X Agent 副标题**: 改为「选择一个操作，或直接问我任何问题」
- **登录按钮**: 文案简化为 "Continue" / "继续"

## [0.5.27] - 2026-03-26

### Changed
- **OpenClaw 状态指示器**: 移除 Connected/Waiting 文字，改为纯圆点指示 — 绿色常亮=已连接，灰色呼吸闪烁=等待连接

## [0.5.26] - 2026-03-26

### Fixed
- **修复发布版本无法连接本地 WebSocket**: 移除 localRelayManager 的 fetch pre-check，该检查在 production build 中因缺少 localhost host_permissions 而失败，导致 WebSocket 连接从未被尝试

## [0.5.25] - 2026-03-24

### Changed
- **OpenClaw 始终开启**: 移除 toggle 开关，OpenClaw 默认启用且不可关闭，新增刷新连接按钮
- **隐藏 Telegram 配置**: 侧边栏设置中不再显示 Telegram 绑定/开关（代码保留，后续移除）
- **发推不显示蓝色呼吸边框**: post_tweet、post_thread、submit_reply、open_tweet_composer 执行时不再显示 AI 操作指示器

## [0.5.24] - 2026-03-24

### Changed
- **回复发布返回 tweetId**: submitReplyHandler 通过 interceptor 捕获 CreateTweet 响应，发布成功后返回 tweetId、tweetUrl 和 screenName

## [0.5.23] - 2026-03-24

### Added
- **发推返回 URL**: 通过 bnbot-cli 发推后返回推文 URL

## [0.5.22] - 2026-03-24

### Added
- **关闭编辑器**: 新增 close_composer action handler

## [0.5.21] - 2026-03-18

### Changed
- **自动更新**: 扩展启动时自动检查更新，有新版时自动应用（无需等待 Chrome 自动更新周期）
- **更新提示前置**: 侧边栏加载时即检查更新并显示提示，不再需要打开设置面板

## [0.5.20] - 2026-03-16

### Fixed
- **API URL 修复**: draftService, boostService, analysisService 使用环境变量替代硬编码 localhost:8000，修复生产环境草稿箱、Boost、分析功能无法使用的问题
- **重复 Upgrade 按钮**: Free 用户只显示一个 Upgrade Plan 按钮

## [0.5.19] - 2026-03-16

### Added
- **用户资料查询** (`scrape_user_profile`): 通过 GraphQL API 获取完整用户资料（粉丝数、推文数等精确数字）
- **用户推文查询** (`scrape_user_tweets`): 通过 GraphQL API 获取用户推文列表
- **高级搜索** (`scrape_search_results`): 支持 from/since/until/lang 等过滤器，支持 top/latest/people/media/lists tab 切换，自动导航到搜索页
- **搜索导航增强** (`navigate_to_search`): 支持 tab 参数切换搜索标签页
- **SearchTimeline API 监听**: timeline-interceptor 新增 SearchTimeline 端点监听
- **TwitterClient 扩展**: 新增 getUserProfile、getUserList、getAllUserList 等 GraphQL API 方法，支持动态提取 Followers/Following/BlueVerifiedFollowers query ID

### Changed
- **搜索查询构建**: Extension 侧支持 from/since/until/lang 参数，CLI 和 Extension 都可独立构建搜索查询
- **CLI timeout**: CLI 命令行超时从 60s 提升到 120s

## [0.5.18] - 2026-03-16

### Added
- **取消点赞** (`unlike_tweet`): 支持取消已点赞的推文
- **取消转发** (`unretweet`): 支持取消已转发的推文
- **取关用户** (`unfollow_user`): 支持在用户主页和推文页取关，兼容下拉菜单和确认弹窗两种交互
- **删除推文** (`delete_tweet`): 支持删除自己的推文
- **收藏推文** (`bookmark_tweet`): 支持将推文加入书签
- **取消收藏** (`unbookmark_tweet`): 支持从书签中移除推文

### Fixed
- **GeminiService 启动崩溃**: 无 API Key 时不再抛异常导致 content script 加载失败

## [0.5.17] - 2026-03-16

### Changed
- **OpenClaw 默认开启**: 安装后自动启用 OpenClaw 连接，无需手动去设置打开

## [0.5.16] - 2026-03-16

### Fixed
- **发推重试机制**: 当推文输入框未找到时（X 页面渲染不稳定），自动导航回 /home 并点击 Post 按钮重试，而不是直接报错

## [0.5.15] - 2026-03-16

### Fixed
- **Local MCP connection**: Keep localhost permissions in production build, allowing extension to connect to ws://localhost:18900 for local AI assistant integration (OpenClaw, Claude Code, etc.)

## [0.5.14] - 2026-03-10

### Added
- **版本显示与更新检测**: Settings 弹窗底部显示当前版本号，自动检测 Chrome Web Store 新版本，有更新时显示绿色提示按钮和设置图标角标

## [0.5.13] - 2026-03-10

### Added
- **Draft only 模式**: 草稿详情新增 Draft only 开关（默认开启），开启时 Publish 只填入编辑器不自动发布，关闭时自动发布
- **定时发推时区显示**: Schedule Post 时间选择器旁显示用户时区（如 Asia/Shanghai）
- **过期时间校验**: 设置定时发推时禁止选择过去的时间，以 toast 提示替代 alert 弹窗

### Changed
- **已发布草稿隐藏**: 草稿列表和 Tweet Calendar 自动过滤 `published` 状态的草稿
- **草稿卡片优化**: 移除创建时间显示，定时发布时间改为内联显示在 @handle 后
- **Save 按钮样式**: 始终黑色背景，无更改时降低透明度
- **文章筛选开关**: 修复 toggle 动画方向问题，改用绝对定位
- **筛选菜单点击外部关闭**: 点击菜单外任意区域自动收起下拉菜单
- **定时选择器默认当前时间**: 每次打开自动填入当前时间（或已有的定时时间）
- **定时 icon 状态**: 仅未来定时显示蓝色时间标签，过期/无定时显示灰色日历图标

### Fixed
- **定时草稿立即触发**: 修复 alarm 对过期 scheduled_at 自动 +5 秒触发的 bug，改为跳过不创建 alarm
- **Schedule confirm 无日期**: 未选日期时默认使用今天，避免 confirm 无反应

## [0.5.12] - 2026-03-04

### Added
- **通知任务暂停/继续**: 通知任务执行中支持暂停和继续操作，UI 显示暂停状态和控制按钮
- **通知任务停止按钮**: 执行中的通知任务可直接停止

### Changed
- **NotificationTaskExecutor**: 新增 pause/resume/stop 控制、重试逻辑优化、更详细的 activity log
- **NotificationProcessor**: 更健壮的通知处理流程
- **taskAlarmScheduler**: 定时任务调度可靠性提升

## [0.5.11] - 2026-03-03

### Added
- **Follow Digest 滚动收集优化**: 改用 `maxTweets` 控制推文数量（默认 100），替代原来的 `maxTimelineRequests`；滚动间隔增至 2000ms 降低封号风险
- **Follow Digest 日志按钮隐藏**: Follow Digest 任务不再显示日志 icon 和日志面板
- **Notification Task 实时 UI**: 自动评论任务显示当前推文卡片、AI 评估推理过程、流式输出状态

### Changed
- **Follow Digest 滚动策略**: 每次滚动到页面底部（带随机偏移），连续 5 次无新推文自动停止
- **NotificationTaskExecutor 重构**: 支持事件系统、当前推文/评估状态查询、activity log，与 autoReplyService 对齐
- **SPA 导航改进**: navigationUtils 统一处理页内导航，NotificationProcessor 使用 SPA 方式导航

## [0.5.10] - 2026-03-03

### Fixed
- **定时任务重复执行**: 添加去重保护（3 分钟内不重复执行同一任务），修复 alarm 提前触发导致每分钟重复执行的 bug
- **修改时间后任务不执行**: `syncSingleTaskAlarm` 不再使用后端旧的 `next_execution_at`，改为从新 schedule 配置重新计算；清除去重时间戳防止阻止首次执行
- **修改时间后当天不执行**: 当天已过的执行时间自动在 30 秒后补执行，而不是等到明天
- **SPA 导航页面刷新**: 自动评论进入推文详情时偶尔导致页面刷新，改用相对路径并将临时链接插入 React root 内部，确保 Twitter 路由拦截器捕获点击事件
- **start-execution 404 错误**: 任务被暂停/删除时，alarm 触发的 `start-execution` 返回 404，现在自动清除对应 alarm

### Changed
- **执行完自动刷新**: 定时任务执行完成后，返回任务详情页自动刷新 Execution History 数据
- **Keep-alive 日志精简**: X tab 的 `autoDiscardable` 设置从每次 tab 更新都触发改为每个 tab 只设置一次，消除日志刷屏
- **定时执行同步用户设置**: 定时执行自动评论前先同步用户配置（评分过滤、回复语气等），不再使用默认值
- **定时执行日志与手动一致**: 定时执行创建 external session，实时显示统计、推文卡片、AI 推理过程，与 Run Now 显示一致
- **导航统一使用 SPA 方式**: `ReplyPoster`、`TimelineScroller`、`ApiTweetProvider`、`FollowDigestExecutor`、`AutoPilotPanel` 全部改用相对路径 + React root 内临时链接导航

## [0.5.9] - 2026-03-03

### Added
- **Telegram 自然语言管理定时任务**: 后端 x_agent 新增 6 个 scheduled task tools（list/create/update/pause/resume/delete），用户可通过 Telegram 用自然语言创建和管理定时任务
- **WebSocket task_sync 实时同步**: background.ts 拦截 `task_sync` WS 消息，自动同步 chrome.alarm（创建/更新/删除），无需等待 30 分钟定期同步
- **user_id 注入 LangGraph config**: `stream_graph_with_interrupt()` 和 `resume_graph()` 支持传入 user_id，tools 可通过 `config["configurable"]["user_id"]` 获取用户身份

## [0.5.8] - 2026-03-02

### Added
- **Follow Digest 设置面板**: 新增完整的设置 UI，支持自定义提示词、时间范围、最大滚动数、兴趣标签、关键词
- **Follow Digest Telegram 通知开关**: 设置中可开关 Telegram 通知，保存到后端 `notification_type` 字段
- **Follow Digest 调度设置**: 设置面板中可配置调度频率（Hourly/Daily/Weekly）
- **所有任务设置分区标题**: Reply Settings / Notification Settings / Digest Settings

### Changed
- **通知类型显示优化**: 详情页 `Notification` 字段从 raw 值 (`none`, `telegram_only`) 改为友好文本 (`Off`, `Telegram`)
- **Notification Settings 简化**: 去掉 Reply (%) 设置项，AI 评估已能智能过滤
- **隐藏无用 Prompt 卡片**: Follow Digest 等单例任务不再显示 Prompt 区域
- **Follow Digest 执行使用用户设置**: 手动执行和定时执行均从 storage 读取用户配置，不再使用硬编码值
- **后端请求新增字段**: `custom_prompt` 和 `notification_type` 随请求发送给后端

## [0.5.7] - 2026-03-02

### Added
- **任务执行队列**: content script 中新增串行执行队列，多个同时触发的任务（如两个 09:00 任务）按顺序执行，避免 DOM 操作冲突
- **过期执行自动清理**: 每 30 分钟同步时检查 RUNNING 超过 10 分钟的执行记录，自动标记为 cancelled

### Changed
- **任务创建 UX 优化**:
  - 单例任务类型（Auto Reply、Handle Notification、Follow Digest）隐藏名称输入框，自动使用默认名称
  - 非单例类型名称改为可选，placeholder 显示任务类型名称
  - 任务类型下拉框移除 emoji 图标
- **任务列表自动刷新**: 创建任务后自动刷新列表

### Fixed
- **`setShowSettings is not defined`**: AutoPilotPanel 中移除已失效的 `setShowSettings` 调用
- **`sendToOneXTab` 静默失败**: 返回值改为 `boolean`，无可用 tab 时立即上报 cancelled 而非等待超时
- **Active tab 发送失败不 fallback**: 修复 active tab 发送失败后不尝试其他 X tab 的问题

## [0.5.6] - 2026-03-02

### Added
- **草稿定时发推迁移到 chrome.alarms**: 草稿定时发布从后端 Celery Beat 轮询改为浏览器本地 `chrome.alarms` 调度
  - 复用 `taskAlarmScheduler.ts` 基础设施（`bgFetchWithAuth`、`sendToOneXTab`、alarm listener）
  - 每 30 分钟同步周期自动拉取 scheduled 草稿并创建/移除 alarm
  - UI 设置/取消定时后即时通知 background 同步对应 alarm
  - content script 收到 `PUBLISH_SCHEDULED_DRAFT` 消息后，根据 `draft_type` 调用 `tweetPoster` 发布推文或推文串
  - 发布结果通过 `DRAFT_PUBLISH_RESULT` 消息回传，background 调用后端 API 更新草稿状态
  - 支持过期草稿立即触发、双重触发防护（检查 `publish_status`）

## [0.5.5] - 2026-03-02

### Changed
- **Auto Pilot UI 优化**:
  - "Start" 按钮改为 "Run Now / 立即执行"
  - Pause/Resume 按钮从标题栏移到底部操作栏，Pause 图标改为实心
  - 移除 Daily Limit 和 Max Reply Length 设置，改为 "Replies Per Execution / 每次执行回复上限"
  - Reply Interval 简化为单一上限值（0 到 N 随机）
  - Replies / Interval / Tone 设置合并为一行三列
  - Timezone 移入 Schedule 卡片显示
  - 移除独立的 Runs 和 Last Run 统计卡片，执行次数显示在 Execution History 右上角
- **删除任务确认弹窗**: 替换浏览器原生 `confirm()` 为插件内 Modal，遵循 sidebar z-index 降低模式
- **CLAUDE.md**: 新增 Modal 实现规范文档

### Fixed
- **alarm 触发日志不可见**: 包装 async alarm handler 的 `.catch()` 防止错误被静默吞掉
- **执行超时保护**: 新增 5 分钟超时机制，超时自动上报 `cancelled` 状态到后端
- **`sendToOneXTab` 错误被吞**: `.catch(() => {})` 改为 `console.warn` 可追踪日志
- 移除 autoReplyService 中的 daily limit 检查逻辑

## [0.5.4] - 2026-03-01

### Added
- **chrome.alarms 本地定时调度**: 所有用户级定时任务迁移到浏览器 `chrome.alarms` 本地调度，不再依赖后端 Celery Beat + WebSocket 推送触发
  - 新增 `utils/taskAlarmTimeCalculator.ts` — 时区感知的下次执行时间计算，支持 once/hourly/daily/weekly/monthly/yearly
  - 新增 `services/taskAlarmScheduler.ts` — alarm 调度核心（同步后端任务配置 → 创建/更新/删除 alarm → 触发执行 → 上报结果）
  - `background.ts`: 初始化调度器 + 处理 `SCHEDULED_TASK_RESULT` / `TASK_ALARM_SYNC` / `TASK_ALARM_REMOVE` 消息 + logout 时清除所有 alarm
  - `commandService.ts`: 新增 `handleAlarmTriggeredTask()` — 根据 taskType 路由到对应 executor（AUTO_REPLY / HANDLE_NOTIFICATION / FOLLOW_DIGEST / GENERATE_TWEET / CUSTOM_TASK）
  - `scheduledTaskService.ts`: 新增 `notifyAlarmSync()` / `notifyAlarmRemove()` 方法
  - `AutoPilotPanel.tsx` / `TaskCreateModal.tsx`: 任务创建/暂停/恢复/删除后同步 alarm
  - `manifest.json` / `manifest.firefox.json`: 添加 `alarms` 权限
  - WebSocket 触发路径保留不删，作为过渡期兼容

## [0.5.3] - 2026-03-01

### Changed
- **Auto-Reply 改用 API 拦截数据，取消 DOM 抓取**:
  - 新增 `utils/ApiTweetProvider.ts` — 从 `ApiDataCache` 读取推文并转换为 `ScrapedTweet`，替代 DOM 滚动抓取
  - `autoReplyService.ts` 的 `runLoop()` 改为从 API 缓存读取推文，缓存用完再滚动触发新 API 请求
  - `AutoReplyTaskExecutor.ts` 同步改用 `ApiTweetProvider` 替代 `TimelineScroller`
  - 启动时始终点击 Home 按钮触发新的 timeline API 请求，确保缓存有最新数据
  - `types/autoReply.ts`: `articleElement` 改为可选（API 来源的推文没有 DOM 元素）
  - `TweetEvaluator.ts`: 增加 `articleElement` undefined guard（API 来源跳过 DOM hover）
  - `TimelineScroller` 保留不变，供 `NotificationProcessor` 等其他功能使用

### Fixed
- **设置面板保存修复**: Save 按钮无效、输入值不保存的问题
  - 所有字段改为受控组件（`value` + `onChange`），绑定到 `settings` state
  - Save 按钮增加 `onClick`，调用 `autoReplyService.updateSettings()` 保存到 `chrome.storage.local`

## [0.5.2] - 2026-03-01

### Changed
- **X Agent @ 面板优化**: context action（AI Rewrite、Analyze Tweet 等）改用 API 拦截获取推文原始数据，替代 DOM 抓取
  - 利用已有的 `timeline-interceptor.js` 拦截 TweetDetail API 响应，直接从 raw payload 解析目标推文
  - 消息中附带完整推文内容（作者、正文、媒体链接、互动数据），后端跳过 `get_tweet_info` 工具调用，响应更快
  - `ApiDataCache` 新增 `mediaUrls` 字段，提取图片/视频原始 URL（最高质量 MP4）
  - `TimelineTweetData` 接口扩展 `mediaUrls` 可选字段
  - 手动输入首条消息同样受益（自动注入推文上下文）
- **WebSocket URL 可配置**: 新增 `VITE_WS_BASE_URL` 环境变量，`WebSocketManager` 支持自定义 WS 地址
- **TimelineScroller 导航修复**: `start()` 改用 SPA 友好的 `navigateToHome()` 替代 `window.location.href`
- **SessionControlBar 样式统一**: Resume/Pause 按钮颜色改为黑色，与整体风格一致

## [0.5.1] - 2026-02-28

### Added
- **OpenClaw MCP 集成**:
  - 新增 `utils/localRelayManager.ts` — 本地 WebSocket 客户端，连接 MCP relay server (ws://localhost:18900)
  - 新增 `bnbot-mcp-server/` — 独立 MCP Server npm 包，桥接 AI 助手与 BNBOT 扩展
  - MCP Server 提供 15 个工具：scrape_timeline, scrape_bookmarks, scrape_search_results, scrape_current_view, account_analytics, post_tweet, post_thread, submit_reply, navigate_to_tweet, navigate_to_search, navigate_to_bookmarks, navigate_to_notifications, return_to_timeline, get_extension_status, get_current_page_info
  - Settings 面板新增 OpenClaw 开关、端口配置和连接状态显示

### Changed
- **ActionExecutor**: 新增全局互斥锁，同一时间只允许一个 action 执行（跨 Telegram/OpenClaw 来源）
- **commandService.ts**: 新增 `handleLocalAction()` 方法，支持 local 结果返回通道（不走远程 API）
- **background.ts**: 新增本地 WebSocket 连接管理（LocalRelayManager）和消息路由

## [0.5.0] - 2026-02-28

### Added
- **Chrome + Firefox + Edge 跨浏览器支持**:
  - 新增 `utils/browserCompat.ts` — 浏览器检测工具（编译时 `__FIREFOX__` 常量 + 运行时 UA 检测）
  - 新增 `utils/websocketManager.ts` — 从 offscreen.ts 抽取 WebSocket 核心逻辑为独立模块，Chrome/Firefox 共享
  - 新增 `manifest.firefox.json` — Firefox MV3 manifest（`background.scripts` 替代 `service_worker`，无 offscreen 权限）
  - 新增 `vite.config.firefox.ts` — Firefox 构建配置（IIFE 格式，输出到 `dist-firefox/`）
  - 新增 npm scripts: `dev:firefox`, `build:firefox`, `build:release:firefox`

### Changed
- **background.ts**: WebSocket 连接支持 Chrome（offscreen document）和 Firefox（直接在 background 中连接）双路径
- **background.ts**: `autoDiscardable`、offscreen document 管理、`clearAllCachedAuthTokens` 等 Chrome 独有 API 添加条件检查
- **offscreen.ts**: 重构为使用共享 `WebSocketManager` 模块，减少代码重复
- **services/authService.ts**: `clearAllCachedAuthTokens` 添加兼容性检查
- **vite.config.ts**: 添加 `__FIREFOX__: false` 编译常量
- **Edge 支持**: 基于 Chromium，与 Chrome 共享同一构建产物 `dist/`，零改动即可使用

## [0.4.19] - 2026-02-10

### Fixed
- **小红书 `__INITIAL_STATE__` 解析修复**:
  - 使用括号计数替代正则提取 JSON，修复嵌套层级过深导致 JSON 截断的问题
  - 兼容 2026 新版小红书页面结构（无 `state.note`），新增 5 条搜索路径查找笔记数据
  - 增强图片 URL 提取，兼容多种字段名（`urlDefault`、`url`、`infoList`、`originImageKey` 等）
- **小红书图片上传到 Twitter 修复**:
  - 修复 xhscdn 图片 MIME 类型错误（从 `video/mp4` 改为正确检测）
  - 新增 webp→PNG 自动转换（Twitter 不支持 webp 上传）
  - `tweetPoster.ts` 新增 background proxy（`FETCH_BLOB`）步骤绕过 CORS
- **Thread 类型响应渲染修复**:
  - `extractRewrittenTimeline` 同时识别 `"type": "thread"` 和 `"type": "rewritten_timeline"`
  - 新增 `convertThreadToTimeline` 函数，将 `original_media`（URL 数组）转换为 `media`（对象数组）
  - 清理 JSON 前后的多余花括号等 artifacts
- **图片预览修复**: `RewrittenTimeline` 的 `onPreview` 使用代理后的 URL 而非原始 http URL
- **Timeline 卡片外边框**: 使用 inline style 设置边框（与 TweetDraftCard 一致），修复 Shadow DOM 中 Tailwind border 不生效的问题

### Changed
- **Generate Image 按钮**: 当推文已有 4 张图片时自动隐藏（Twitter 单条推文最多 4 张图）
- **Publish/Schedule 按钮**: 添加 `cursor-pointer`，hover 时显示手指光标
- **日历按钮选中态**: 从蓝色改为黑色（`var(--text-primary)`），与整体风格统一
- **DOWNLOAD_PORT**: 新增 `contentType` 字段，为 xhscdn 请求添加 Referer header

## [0.4.18] - 2026-02-10

### Added
- **小红书搬运架构重构为 x_action 中断/恢复模式**:
  - 新增 `fetch_xiaohongshu_note` action handler，对接后端 interrupt/resume 流程（与微信/TikTok 一致）
  - 新增 `xiaohongshuActions.ts` action handler 文件
  - 在 actionRegistry、actionExecutor、action types 中注册新 action
  - ChatPanel 小红书模式简化为只发链接，由后端 orchestrator 通过 x_action 触发前端抓取

### Fixed
- **小红书图片显示修复（CORS/混合内容）**:
  - xhscdn 图片（`http://`）在 HTTPS 页面无法加载的问题，通过 background service worker 代理解决
  - `background.ts` 的 `fetchBlobAsDataUrl` 为 xhscdn 请求添加 Referer header
  - `background.ts` 的 `scrapeXiaohongshuNote` 预代理图片为 base64（`proxiedImages` 字段供前端显示）
  - `EditableImage` 组件新增 `onError` proxy fallback，图片加载失败时自动通过 background 代理重试
  - `ImageWithSkeleton` 组件同样新增 proxy fallback
  - 图片预览传递代理后的 URL，修复预览弹窗显示空白的问题
- **Thread（线程）类型响应渲染修复**:
  - `extractRewrittenTimeline` 现在同时识别 `"type": "thread"` 和 `"type": "rewritten_timeline"`
  - 新增 `convertThreadToTimeline` 函数，将 `original_media`（URL 数组）转换为 `media`（对象数组）
  - 流式传输中的 partial JSON 检测也支持 `thread` 类型
- **发布线程时图片上传失败修复**:
  - `tweetPoster.ts` 的 `fetchMediaBlob` 在直接 fetch 失败后，新增 background proxy（`FETCH_BLOB`）步骤
  - 解决 xhscdn 等跨域图片在 Twitter compose 上传时 CORS/403 的问题

## [0.4.17] - 2026-02-08

### Fixed
- **时间线广告过滤增强**:
  - 使用 `textContent` 替代 `innerText`，修复 DOM 未完全渲染时检测失败的问题
  - 新增结构化检测：识别 caret 按钮附近的广告标签，更精准匹配时间线广告
  - 新增延迟 200ms 重检机制，捕获 MutationObserver 回调时尚未渲染的广告
  - 隐藏父级 `cellInnerDiv` 容器，消除广告被隐藏后留下的空白占位
  - 新增误报防护：排除推文正文中出现 "Ad" 等词的误判
  - 扩展多语言广告标签支持（新增德/法/意/西/葡/韩/土/俄语）

### Added
- **Twitter 视频下载功能优化**:
  - 下载按钮移至分享菜单内（点击分享按钮后出现），不再显示在操作栏
  - 支持转发推文视频下载（interceptor 同时映射外层转发 ID 和原始视频 ID）
  - 支持推文详情页视频下载（新增 `threaded_conversation_with_injections_v2` 路径解析）
  - 点击下载按钮在新标签页打开视频 URL（移除 `chrome.downloads` 依赖）
  - 自动检测 Twitter 原生下载选项，避免重复注入
  - 下载按钮 SVG 图标与 Twitter 原生一致
  - 自动匹配菜单语言（中文/英文）
  - hover 效果与原生菜单项一致

### Changed
- **移除 `downloads` 权限**: 不再需要 `chrome.downloads` API，减少权限请求

### Fixed
- **转发推文 tweetId 不匹配**: `extractTweetId` 改为提取所有 ID 并优先匹配 videoMap 中已有的
- **推文详情页视频数据丢失**: interceptor 新增 `threaded_conversation_with_injections_v2` 路径支持


## [0.4.16] - 2026-02-08

### Added
- **Twitter 视频下载**: 自动在含视频的推文操作栏注入下载按钮，点击即可下载 MP4 视频
  - 通过拦截 Twitter GraphQL API 响应提取真实视频 URL（最高码率 MP4）
  - 支持所有页面：首页 Timeline、推文详情页、个人主页等
  - 下载按钮样式匹配 Twitter 原生操作栏风格
  - 支持普通视频和 GIF（animated_gif）

### Changed
- **Timeline Interceptor 全页面生效**: 移除仅 `/home` 页面的限制，interceptor 在所有 x.com 页面注入


## [0.4.15] - 2026-02-07

### Added
- **输入模式链接验证**: YouTube/TikTok/小红书/微信/推文搬运/Thread 模式下，发送前验证输入是否包含有效链接
  - 无效链接时右上角弹出提示，6 秒后自动消失
  - 支持中英文提示（根据系统语言自动切换）

### Fixed
- **BoostPanel 401 循环请求**: 移除 `fetchWithAuth` 中自动触发 `session_expired` 事件的逻辑，避免 401 → 重渲染 → 再请求的无限循环
- **BoostPanel 无用导入**: 清理残留的 `authService` 导入

### Changed
- **后端 Boost 列表接口公开化**: `GET /boost/` 接口改为无需登录即可访问，仅 `mine_only=true` 时需要登录


## [0.4.14] - 2026-02-07

### Added
- **LoginModal 弹窗登录**: 新增模态弹窗登录组件，用于在用户操作时（发送消息、点击 X Agent 功能）提示登录，无需跳转全屏登录页
  - 覆盖整个插件区域包括侧边栏
  - 支持 Google 登录和邮箱验证码登录
  - 点击遮罩层或关闭按钮可关闭
- **X Agent 登录检查**: 点击 X Agent 功能按钮（分析推文、AI 回复、图片回复等）时，未登录用户会弹出 LoginModal

### Fixed
- **LoginModal 不再自动弹出**: 修复页面加载/刷新时 LoginModal 自动弹出的 bug
  - 移除 session_expired 事件中自动弹出 LoginModal 的逻辑
  - 移除 BoostPanel 初始加载 401 错误时自动弹出 LoginModal 的逻辑
  - 现在只在用户主动操作（点击功能、发送消息）时才弹出
- **LoginModal 关闭按钮事件冒泡**: 修复点击关闭按钮后事件传播到下层按钮导致 modal 再次弹出的问题
- **输入模式横幅重叠**: 修复 TikTok/推文搬运模式切换时未关闭小红书模式横幅的问题
- **X Analytics 重复 AI 分析按钮**: 移除多余的 AI 分析按钮

### Changed
- **LoginModal UI 统一**: 按钮和输入框圆角改为 `9999px`（胶囊圆角），与 LoginPanel 风格一致
- **LoginModal 遮罩层**: 使用浅灰色半透明背景 `rgba(128, 128, 128, 0.25)`
- **X Analytics 默认时间范围**: 从 4W 改为 3M（3个月）
- **authService 存储优化**: 仅使用 `chrome.storage.local`，不再使用 `localStorage`，避免与 bnbot.ai 网页冲突
- **验证码输入提示文案**: "6位数字验证码" 改为 "6位数验证码"
## [0.4.13] - 2026-02-06

### Added
- **小红书 Repurpose 功能**: 支持将小红书笔记转发到 Twitter/X
  - 新增小红书抓取服务 (`xiaohongshuScraperService.ts`)
  - 支持抓取图片笔记和视频笔记
  - 自动提取标题、描述、标签、图片/视频
  - background.ts 新增 `XIAOHONGSHU_SCRAPE` 消息处理
  - ChatPanel 新增小红书输入模式，一键搬运笔记内容

### Fixed
- **小红书视频上传**: 通过 background 代理下载绕过 Mixed Content (HTTP/HTTPS) 限制
- **小红书封面显示**: 通过代理解决 xhscdn 图片的 CORS 问题
- **竖屏视频显示**: 小红书/TikTok 9:16 视频正确识别为竖屏
- **用户信息获取**: 使用 `xUserStore.getUserInfo()` 替代 DOM 抓取
- **console.log 刷屏**: 禁用 TweetDraftCard 调试日志

### Changed
- manifest.json 添加 xiaohongshu/xhscdn 相关权限


## [0.4.12] - 2026-02-05

### Added
- **X Analytics 分享截图功能**: 一键生成数据分析截图并分享到推特
  - 使用原生 Canvas API 绘制截图（避免 html2canvas 的 oklch 兼容性问题）
  - 截图包含：用户头像、显示名称、蓝V认证徽章（官方八角星样式）
  - 显示 Yearly Impressions 统计
  - 3 张图表：Followers Growth、Impressions、Reply Impressions
  - 底部营销文案（币安金色）和 Chrome Web Store 二维码
  - 预览弹窗：支持保存图片或直接发推
  - Post 按钮自动打开推文编辑器、填充随机营销文案、上传截图
  - 10 句中英文随机营销文案，自动 @BNBot_AI #BNBot

### Changed
- **Reply Impressions 时间范围统一**: 与主时间选择器联动（选择 1Y 时使用 3M 数据并标注）
- **移除 qrcode 依赖**: 使用预生成的 base64 二维码常量，减少 30 个包依赖


## [0.4.11] - 2026-02-05

### Added
- **Reply Impressions 分析**: 在 X Analytics 面板中新增回复曝光数据展示
  - 显示回复推文的曝光量、互动量统计
  - 支持 7D/2W/4W/3M 时间范围切换
  - 回复列表展示：显示内容预览、曝光数、互动数和发布时间
  - 点击回复可跳转到原推文
  - TwitterClient 新增 `getReplyImpressions` 方法，动态提取 ContentPostListQuery ID


## [0.4.10] - 2026-02-05

### Added
- **推文日历增强**:
  - 草稿选择模态框：支持搜索和类型筛选（推文/推文串）
  - 时间选择器：选择发布时间并预览推文
  - 日历显示已安排推文：点击查看详情
  - 计划推文详情模态框：支持预览和移除计划
  - 完整推文串预览：显示连接线和所有推文内容
  - 蓝V认证标志显示
- **草稿详情页删除按钮**: 在 Save 按钮左侧添加删除按钮，支持直接删除草稿
- **删除弹窗键盘支持**: 按 Enter 确认删除，按 Escape 取消

### Changed
- **乐观更新**: 安排/取消计划时立即更新 UI，后台异步保存
- **日历网格布局优化**: 使用 `minmax(0, 1fr)` 防止内容溢出
- **X Analytics 数据缓存**: 添加 5 分钟缓存机制，减少 API 请求频率
- **X Analytics 面板优化**: 移除顶部返回箭头，缩小刷新按钮
- **X Balance 面板样式统一**: 标题字体大小、用户卡片布局与 X Analytics 保持一致
- **草稿列表日期显示**: 显示创建时间而非更新时间
- **删除弹窗样式优化**: 使用与 Create Task 相同的遮罩层方案，修复白线问题

### Fixed
- **定时发布接口修复**: 使用专用的 `/schedule` 和 `/unschedule` 接口替代通用更新接口，确保定时计划正确保存到数据库


## [0.4.9] - 2026-02-05

### Changed
- **X Analytics 图表重构**:
  - 使用纯 SVG 实现图表，替换 Recharts（解决 Shadow DOM 兼容性问题）
  - 添加鼠标交互：悬停显示 Tooltip、高亮圆点、垂直参考线
  - 图表数据改为显示总量（总粉丝数、累计曝光量）
  - Tooltip 显示详细数字（带千分位分隔符）
- **用户信息卡片增强**:
  - 右侧显示年度 Impressions 总量
  - 数字递增动画效果（ease-out 缓动）
  - 等宽数字显示（tabular-nums），避免动画抖动
  - 显示蓝V认证标志
  - 用户信息从 xUserStore 获取


## [0.4.8] - 2026-02-05

### Added
- **X Analytics 面板**: 新增推特数据分析面板
- **推文日历模态框**: 新增 TweetCalendarModal 组件

### Fixed
- **特殊页面侧边栏行为优化**:
  - 进入 `/i/chat` 或 `/messages` 页面时自动收起 BNBot 面板
  - 进入 Grok (`/i/grok`) 和 Analytics (`/i/account_analytics`) 页面时收起 Twitter 左侧导航
  - 修复 Grok/Analytics 页面右上角开关按钮消失的问题
  - Grok 页面添加 primaryColumn 样式调整，避免内容被遮挡
- **修复 FollowDigestExecutor 导入错误**: 从 FeedReportExecutor 重命名后的引用修正


## [0.4.7] - 2026-02-04

### Added
- **通知处理任务设置增强**: 添加更多配置选项
  - 回复设置：语气选择、最大回复数、回复概率
  - 目标推文类型过滤
  - 自定义 AI 指令
  - 排除账号列表
  - 统一的点赞概率设置
  - 通知处理间隔时间配置

### Changed
- **设置面板布局优化**: 更紧凑的三列/两列网格布局
- **移除冗余设置**: 移除 Max Length（推特默认280）和分开的曝光预测阈值


## [0.4.6] - 2026-02-02

### Added
- **任务详情视图 (TaskDetailView)**: 点击任务卡片进入详情页
  - 显示任务名称、类型、状态
  - 调度设置：执行频率、下次执行时间、通知方式
  - 完整提示词内容展示
  - 统计数据：执行次数、上次执行时间、时区
  - 执行历史记录（最近10次）
  - 底部操作栏：暂停/恢复、立即执行、删除

### Changed
- **任务卡片简化**: 移除卡片上的操作按钮，点击进入详情页再操作
  - 卡片只显示任务信息，更简洁
  - 使用 SVG 图标替代 emoji（MessageSquare、BarChart2、Bot、Bell）
  - 状态徽章改为点+文字样式，去除背景色

- **任务列表缓存**: 从详情返回列表时不再重新请求
  - 缓存任务数据和配额信息
  - 执行操作后自动清除缓存，下次刷新
  - 提升返回列表的流畅度

- **Header 优化**: 移除详情页顶部返回箭头
  - 详情页右上角显示关闭按钮 (X)
  - 点击 Log 按钮时自动关闭设置面板

- **刷新按钮优化**: 刷新时 Header 保持显示
  - 只有任务卡片区域显示骨架屏
  - 刷新按钮显示旋转动画

### Fixed
- 修复设置面板和日志面板可能同时显示的问题


## [0.4.5] - 2026-02-02

### Added
- **自动打开 X 标签页**: 定时任务执行时如果没有打开 X 页面，自动在后台打开一个
  - 新增 `tabs` 权限到 manifest.json
  - 优化 `sendToOneXTab` 函数，支持三级优先级：活跃 X 标签页 > 任意 X 标签页 > 自动打开新标签页
  - 新标签页在后台打开（`active: false`），不打扰用户当前工作
  - 等待页面加载完成 + 1.5 秒延迟确保 content script 初始化
  - 15 秒超时保护，防止卡死
  - 解决用户未打开 X 页面时定时任务静默失败的问题


## [0.4.4] - 2026-02-02

### Added
- **Auto Pilot Panel 重构**: 新增任务列表视图与会话视图双模式
  - 首页显示后端定时任务列表（从 `/scheduled-tasks` API 加载）
  - 任务卡片展示：图标、名称、状态徽章、频率、执行时间、上次执行、执行次数
  - 任务操作：暂停/恢复、立即执行、删除
  - 点击任务可查看详情（预留扩展）
  - "快速启动会话" 区域用于启动手动自动回复

- **LogsModal 组件**: 日志从底部区域移至独立弹窗
  - Header 新增日志按钮（带数量徽章）
  - 支持自动滚动、手动滚动检测、清空日志
  - 日志按类型颜色编码（错误红色、成功绿色等）

- **TaskCreateModal 组件**: 创建定时任务弹窗
  - 支持任务名称、类型、提示词、频率、执行时间、通知方式配置
  - 周任务支持选择星期几，月任务支持选择日期

- **TaskList 组件**: 任务列表管理
  - 显示任务配额使用情况
  - 支持刷新、创建任务
  - 空状态友好提示

- **TaskCard 组件**: 任务卡片展示
  - 根据 graph_name 显示不同图标（💬自动回复、📝定时发推、📊刷推报告、🤝目标互动、🤖生成推文）
  - 状态徽章颜色区分（ACTIVE=绿色、PAUSED=黄色、FAILED=红色）
  - 相对时间显示（刚刚、x分钟前、x小时前等）

### Changed
- **Header 布局调整**: 移除顶部控制按钮，改为会话视图内显示
  - 新增返回按钮（会话视图 → 任务列表）
  - 日志按钮放在设置按钮左边
  - 保留 WebSocket 连接指示器

- **视图模式切换**: 启动会话时自动切换到会话视图，支持返回任务列表


## [0.4.3] - 2026-02-02

### Added
- **Tab Keep-Alive 机制**: 防止 Chrome 冻结后台 X 标签页
  - WebSocket 连接时自动设置 `autoDiscardable: false`
  - 新打开的 X 标签页自动应用保活设置
  - 断开连接时恢复默认行为

### Fixed
- **多标签页重复执行问题**: Action 消息优先发送到当前活跃的 X 标签页
  - 避免用户开多个 X 页面时同一操作执行多次
- **Action 结果未返回后端**: 改用 API `/api/v1/ai/resume` 发送结果
  - 比 WebSocket 更可靠，支持大数据传输
  - 后端自动发送响应到 Telegram

### Changed
- `sendActionResult` 改用 HTTP API 替代 WebSocket
- 更新 `docs/COMMAND_SERVICE.md` 文档


## [0.4.2] - 2026-02-01

### Added
- **Offscreen Document WebSocket 架构**: 多 Tab 共享单一 WebSocket 连接
  - 新增 `offscreen.html` 和 `offscreen.ts` 维护持久 WebSocket 连接
  - 解决 Manifest V3 Service Worker 无法维持长连接的问题
  - 所有 Twitter Tab 共享同一个 WebSocket，减少服务器负载
  - 无限重连 + 指数退避（3s → 6s → 12s → 24s → 30s max）
  - 页面可见性检测 - 用户切回 Tab 时自动重连
  - 定期健康检查（每 60 秒）
- **Telegram 新命令**:
  - `/credits` - 查询积分余额
  - `/drafts` - 查看草稿箱列表
  - `/publish <n>` - 发布第 n 个草稿
  - `/scheduled` - 查看定时发布任务
- **预览码系统**: 草稿安全分享链接
  - `TweetDraft.preview_code` 字段（16 位随机码）
  - `POST /drafts/{id}/preview-code` 生成预览码
  - `GET /drafts/preview/{code}` 公开访问草稿
- **AutoPilot 结果推送**: 运行结束后发送汇总到 Telegram
  - 扫描推文数、发送回复数、运行时长
  - 精选回复列表
- **通知设置 API**:
  - `notify_viral_threshold` - 热度阈值通知
  - `notify_reply_received` - 收到回复通知
  - `report_include_stats` / `report_include_top_replies` / `report_max_replies` - 报告定制

### Changed
- **manifest.json**: 添加 `offscreen` 权限和 `wss://api.bnbot.ai` CSP
- **commandService.ts**: 改为通过 Offscreen Document 通信
- **AutoPilotPanel.tsx**: 使用异步 `getStatus()` 获取真实连接状态

### Fixed
- WebSocket 连接状态显示不一致问题（AutoPilot 面板 vs Telegram /status）


## [0.4.1] - 2026-01-31

### Added
- **Home Timeline Boost 检测**: Money Vision 开启后检测 Home Timeline 上有 Boost 的推文
  - 新增 `utils/HomeBoostChecker.ts` 核心检测类
  - 使用 IntersectionObserver 监控可见推文
  - 批量调用 `boostService.checkTweets()` API（1秒防抖）
  - 金色闪电 Badge 注入（匹配 Twitter action button 样式）
  - 金色边框高亮有 Boost 的推文
  - 点击 Badge 打开 Boost Panel 查看详情
  - 缓存已检查和有 Boost 的推文 ID，避免重复请求

### Changed
- **Money Vision 开关增强**: 现在同时控制 TweetObserver 和 HomeBoostChecker
  - 开启时在 /home 页面自动启动 Boost 检测
  - 离开 /home 或关闭时暂停检测

## [0.4.0] - 2026-01-30

### Added
- **Autopilot V2 本地曝光预测**: TweetEvaluator 从 AI 评估改为本地 `predictExposure` 算法
  - 零 API 成本（不再调用后端 AI）
  - 即时评估（<10ms vs 原来 2-5s）
  - 一致的评分标准
  - 基于 score ≥ 50 且 timing ≠ 'dead' 判断是否回复
- **最低曝光阈值设置**: AutoReplyPanel 新增 `minExpectedExposure` 配置项
  - 只处理预期曝光量大于阈值的推文
  - 默认值 0 表示不过滤
- **ApiDataCache 缓存系统**: 新增 `utils/ApiDataCache.ts`
  - 监听 Twitter API 响应，缓存推文完整数据
  - 为曝光预测提供 followers、bio 等信息
  - AutoReplyService 启动时自动开启，停止时关闭
- **XUserStore 增强**: 从 `__INITIAL_STATE__` 解析更多用户信息
  - 新增字段: `followersCount`, `friendsCount`, `statusesCount`, `favouritesCount`, `description`, `createdAt`
  - `verified` 重命名为 `isBlueVerified`（更准确反映蓝V状态）
  - 优先使用 `session.user_id` 获取正确的用户 ID

### Changed
- **TimelineScroller 自动刷新**: 滚动超过 20 条推文后自动回到顶部点击「显示 X 帖子」加载新内容
- **AutoReplyService Home 模式优化**:
  - 如果 ApiDataCache 已有数据（如曝光预测已开启），跳过点击 Home 刷新
  - 否则点击 Home 并等待 API 数据到达（最多 10 秒）
- **开关样式统一**: AutoReplyPanel 所有开关从黑白色改为绿色 (`peer-checked:bg-green-500`)
- **TweetEvaluator 重构**: 移除 `fetchAuthorDetails` hover 获取粉丝数逻辑，改用 ApiDataCache

### Fixed
- **Monitor 启动不滚动**: `monitor.start(true)` 传入 `skipRefresh` 参数，避免返回 /home 时滚动到顶部

## [0.3.45] - 2026-01-30

### Added
- **评论密度惩罚**: 评论越多，新评论能获得的曝光越少
  - < 10 评论: 无惩罚
  - 50-200 评论: 惩罚 60%
  - 500-1000 评论: 惩罚 90%
  - 1000+ 评论: 惩罚 95%（马斯克级别）
- **超大V修正系数**: 对粉丝数极高的账号使用更保守预测
  - 100万-1000万粉丝: 减半
  - 1000万-5000万粉丝: 打2折
  - 1亿+ 粉丝: 打0.5折
- **曝光上限**: 单条评论设置曝光天花板
  - 1亿+ 粉丝作者: 上限 1万
  - 评论 > 500: 上限 5000
- **媒体类型检测**: 识别推文中的视频/图片/无媒体
  - 在控制台日志中显示 `mediaType` 字段

### Changed
- **数字格式化规则优化**:
  - < 100: 显示 `< 100`
  - 100-999: 显示 `< 1k`
  - 1k-10k: 保留一位小数（如 `1.2k`, `5.5k`）
  - 10k-100k: 取整到千（如 `15k`, `56k`）
  - 100k+: 用万（如 `15万`, `150万`）
- **曝光预测开关控制**: Monitor 只在用户开启开关时启动，离开 /home 时自动停止

### Fixed
- **超大V预测过高问题**: 修复马斯克等超大V推文预测曝光过高的 bug（原本 5.5万+ 现在更合理）

## [0.3.44] - 2026-01-30

### Added
- **曝光预测 Badge**: 在推文操作栏显示预测曝光量徽章
  - 插入到书签按钮左侧，使用望远镜图标
  - 显示格式化数字（如 5,715 或 1.5万）
  - 悬浮显示完整预测信息（评分、时机、生命周期、渗透率、建议）
  - 支持中英文国际化
- **曝光阈值设置**: 在设置面板中添加阈值输入框
  - 仅当预测曝光 >= 阈值时显示绿色高亮
  - 低于阈值显示 Twitter 默认灰色 (#536471)
  - 修改阈值后立即更新所有已显示的 Badge 颜色
- **月相图标系统**: 用月相 emoji 表达推文生命周期
  - 🌕 黄金时机 / 起飞中
  - 🌖 值得评论 / 加速中
  - 🌗 较晚 / 峰值期
  - 🌘 衰退中 / 尾声

### Changed
- **exposurePredictionService**: reason 字段改为 `{ en: string; zh: string }` 支持国际化
- **数字格式化**: 千位数使用逗号分隔（5,715）而非 k 格式

### Fixed
- **颜色判断 Bug**: 修复 `getScoreColor` 传入 `prediction.score` 而非 `prediction.expected` 导致高亮判断错误

### Removed
- **Save Draft 按钮**: 移除 TwitterInjector 中的草稿保存按钮注入功能

## [0.3.43] - 2026-01-29

### Added
- **转发推文支持**: HomeTimelineMonitor 现在能正确解析和预测转发推文（Retweet）
  - 解析 `retweeted_status_result` 获取原始推文数据
  - 使用原作者信息进行曝光预测
  - 同时缓存转发 ID 和原始推文 ID

### Fixed
- **页面滚动问题**: 修复从推文详情返回 /home 时页面自动滚动到顶部的 bug
  - `start()` 方法新增 `skipRefresh` 参数
  - 返回 /home 时跳过 `triggerHomeRefresh()`，保持滚动位置
  - 直接扫描当前可见推文并输出预测

## [0.3.42] - 2026-01-29

### Added
- **评论曝光预测算法 v1.1**: 预测用户评论推文后能获得的曝光量范围
  - 新增 `services/exposurePredictionService.ts` - 曝光预测服务
  - 新增 `docs/EXPOSURE_PREDICTION_ALGORITHM.md` - 完整算法文档
  - 核心公式: `E = (V_future × R_rank) × B_gate × A_health + (V_now × K_scroll)`
  - **渗透率模型**: 基于 `viewCount/followers` 判断推文生命周期阶段 (launching/accelerating/peaking/decaying/dead)
  - **加权互动率**: RT×30 + Reply×20 + Like×1 (基于 X 算法权重)
  - **蓝标门槛 (B_gate)**: 非蓝标用户曝光砍 85%
  - **账号健康度 (A_health)**: 基于账号年龄 (<7天=0.1, <30天=0.4, <90天=0.7, ≥90天=1.0)
  - **分段排名转化率**: 黄金区(1-3名)/白银区(4-10名)/青铜区(11-30名)/折叠区(30+)
  - 输出预测范围 (min-max)、评分 (0-100)、行动建议

### Changed
- **HomeTimelineMonitor 集成曝光预测**:
  - 推文可见时同时输出曝光预测到 Console
  - Cache 更新后立即扫描当前可见推文并输出预测
  - 新增 URL 变化检测，从推文详情返回 /home 时自动重启 Monitor
  - 新增 `logCurrentlyVisibleTweets()` 方法，主动扫描可见推文
  - 新增 `onReturnToHome()` 方法，处理 SPA 路由变化
- **XUserStore 新增 createdAt**: 获取账号创建时间，用于计算账号健康度

### Fixed
- **SPA 路由问题**: 修复从推文详情返回 /home 后 Monitor 不工作的 bug
  - 使用 `monitorWasEnabled` 标志追踪 Monitor 状态
  - 返回 /home 时自动重启 Monitor 并恢复监听

## [0.3.41] - 2026-01-29

### Changed
- **HomeTimelineMonitor 逻辑重构**: 改用点击 Home 按钮触发 API 刷新
  - 开关打开时自动点击左侧导航的 Home 按钮，触发 Twitter 重新请求 HomeTimeline API
  - 通过 API 拦截器获取完整的用户数据（包含 followers、following、bio）
  - 新增 `triggerHomeRefresh()` 方法，支持多种方式触发刷新：
    - 优先点击 `data-testid="AppTabBar_Home_Link"` 导航按钮
    - 备选点击 header 中的 X logo
    - 备选点击 header 中任意 `/home` 链接
  - 简化 `onTweetElementVisible()` 方法，只使用 API 缓存数据

### Removed
- 移除 DOM 解析相关方法（不再需要从 DOM 提取数据）
  - `extractBasicDataFromElement()`
  - `extractMetricsFromElement()`
  - `parseMetricValue()`
  - `processVisibleTweetsFromDOM()`
  - `findShowPostsButton()`
- 移除 `hasApiData` 状态标志（现在只使用 API 模式）

## [0.3.40] - 2026-01-28

### Added
- **Home Timeline Monitor**: 监听 Twitter 首页时间线并检测可见推文
  - 新增 `utils/HomeTimelineMonitor.ts` - 主监控类，整合 API 拦截和可见性检测
  - 新增 `public/timeline-interceptor.js` - 注入脚本，拦截 fetch/XHR 请求捕获 HomeTimeline API 数据
  - 使用双轨策略：API 拦截获取完整推文数据 + IntersectionObserver 检测可见推文
  - 当用户滚动到推文时，Console 输出完整信息（用户名、粉丝数、推文内容、互动数据、发布时间等）
  - 只在 `/home` 页面启用，离开时自动停止
  - 缓存限制 500 条防止内存泄漏

## [0.3.39] - 2026-01-28

### Fixed
- **简化文章编辑器拖拽上传**: 移除文章正文区域的拖拽上传功能，只保留封面图片拖拽上传
  - 移除 `uploadImageToArticleBody` 函数
  - 移除 `copyImageToClipboard` 和 `convertBlobToPng` 函数
  - 简化拖拽事件处理，只处理封面图片区域

### Improved
- **图片粘贴检测**: 优化 MarkdownPasteProcessor，当剪贴板包含图片文件时直接放行给 DraftJS 原生处理，避免干扰图片粘贴

## [0.3.38] - 2026-01-28

### Fixed
- **文章编辑器拖拽蓝框残留**: 修复拖拽图片到文章编辑器后蓝色边框不消失的问题
  - 新增 `clearDragVisualState` 函数清理拖拽视觉状态
  - 移除蓝色边框 CSS 类 (`r-vhj8yc`, `r-17gur6a`)
  - 发送 `dragleave` 和 `dragend` 事件重置组件状态

### Added
- **Imagine 页面侧边栏收起**: `https://x.com/i/imagine` 页面现在也会像文章编辑器一样，展开 BNBot 面板时自动收起左侧导航栏

## [0.3.37] - 2026-01-27

### Fixed
- **文章重复创建问题**: 修复从非 articles 页面点击发布时创建两篇文章的问题
  - 导航后重新检查当前 URL 状态
  - 检测是否已有空白编辑器，避免重复点击创建按钮
- **图片占位符删除不完整**: 修复上传图片时占位符只删除 `[` 的问题
  - 占位符格式从 `[🌉IMAGE_N]` 改为 `[IMG_N]`（纯 ASCII，避免 emoji 选择问题）
  - 增加选择和删除的等待时间，确保操作完成
  - 支持新旧两种占位符格式的匹配

## [0.3.36] - 2026-01-27

### Fixed
- **Reasoning 显示问题**: 修复 TikTok 搬运等 interrupt 操作后 reasoning 区域自动关闭的问题
- **视频占位符**: 视频加载前显示占位符（缩略图+播放按钮），而不是空白
- **骨架屏空白条**: 修复推文/文章骨架屏上方多余空白条的问题
- **TikTok 搬运蓝色遮挡层**: `fetch_tiktok_video`、`fetch_wechat_article` 等不操作 DOM 的 action 不再显示蓝色指示器

### Changed
- **英文功能描述优化**:
  - WeChat Repurpose: "Convert article to content" → "Repost articles to X"
  - TikTok Repurpose: "Convert short video" → "Short videos to tweets"
  - Thread Summary: "Extract key insights" → "Merge thread into one"

## [0.3.35] - 2026-01-27

### Added
- **Extension 架构技术文档**: 新增 `docs/EXTENSION_ARCHITECTURE.md`
  - Background Script 和 Content Script 通信机制详解
  - Chrome Extension 消息传递 (`chrome.runtime.sendMessage`) 使用示例
  - Twitter API 认证机制：如何获取 CSRF Token (`ct0` cookie)
  - `credentials: 'include'` 携带 Session Cookie 的原理
  - 动态提取 Twitter GraphQL QueryID 的方法
  - 跨域请求 vs 同域请求的场景分析

### Fixed
- **Markdown `<br>` 标签渲染**: 安装 `rehype-raw` 插件，修复表格中 `<br>` 标签不渲染的问题
- **书签总结按钮**: 修复点击"书签总结"显示 Coming Soon 的问题，现在正确发送总结请求
- **书签总结消息本地化**: 支持中英文切换（"帮我总结我的书签（最近50条）" / "Summarize my bookmarks (last 50)"）

## [0.3.34] - 2026-01-26

### Added
- **文章图片上传功能**: 支持发布文章时自动处理图片占位符
  - 从 Markdown 中提取 `[📷 图片N](url)` 格式的图片链接
  - 转换为 `[🌉IMAGE_N]` 占位符显示在编辑器中
  - 浮动面板显示待上传图片列表，支持单个或批量上传
  - 通过 background.ts 的 `FETCH_IMAGE` 下载图片绕过 CORS

### Changed
- **图片上传面板 UI 优化**:
  - 上传按钮改为 X 风格黑色 (#0f1419) 子弹头圆角
  - "全部上传"按钮居中显示上传图标
  - 上传时显示 loading spinner 替代 "上传中..." 文字
  - 移除关闭按钮，改为可折叠面板（点击标题栏折叠/展开）
  - 面板只在离开页面时自动消失

## [0.3.33] - 2026-01-26

### Changed
- **书签总结功能重构**: 使用 Twitter GraphQL API 替代 DOM 抓取
  - 新增 `TwitterClient.getBookmarks()` - 单页书签获取，支持分页 cursor
  - 新增 `TwitterClient.getAllBookmarks()` - 自动分页获取指定数量书签
  - 新增 `TwitterClient.parseTweetResult()` - 解析 GraphQL 推文数据
  - 新增 `BookmarksResult` 接口定义
  - 动态提取 Bookmarks QueryID（从 Twitter 页面脚本）
  - 请求频率控制：分页请求间隔 1-1.5 秒随机延迟
  - 数据格式完全匹配后端期望结构（id, text, author, stats, media, url）
  - 支持图片、视频、GIF 媒体类型解析
  - 支持 verified 用户标识

## [0.3.32] - 2026-01-26

### Added
- **视频预缓存系统**: 新增 `services/videoCacheService.ts`
  - Action 获取到视频链接时立即开始后台下载
  - 视频下载完成后缓存 blob URL
  - 组件渲染时直接使用缓存，无需等待下载

### Changed
- **TikTok 视频播放体验优化**:
  - 视频默认显示封面图 + 播放按钮，点击后才开始播放（类似推特风格）
  - 竖屏视频（TikTok）容器高度自适应视频实际尺寸
  - 删除按钮仅在视频播放时显示，封面状态下隐藏
  - 优化竖屏视频检测逻辑，支持检测 `tiktokcdn` URL 和 `original_url`

## [0.3.31] - 2026-01-25

### Added
- **TikTok 视频搬运功能**: 对接后端 `fetch_tiktok_video` interrupt 流程
  - 新增 `TikTokVideoData` 接口，匹配后端 API 文档要求的数据结构
  - 新增 `fetchTikTokVideoData()` 函数，获取符合后端格式的视频数据
  - 新增 `isTikTokUrl()` URL 验证函数，支持多种 TikTok 链接格式
  - 新增 `extractVideoId()` 从 URL 提取视频 ID
  - 新增 `downloadTikTokVideoWithProgress()` 支持进度回调的视频下载
  - 新增 `convertToVideoData()` 旧版接口转换函数
  - 新增 `fetchTiktokVideoHandler` Action Handler
  - 新增 `FETCH_TIKTOK_VIDEO` ActionDefinition
  - 新增 `TIKTOK_FETCH_V2` 消息类型处理（background.ts）
  - 添加 `fetch_tiktok_video` 到 INTERRUPT_ACTIONS
  - 支持的 URL 格式：标准视频链接、短链接、分享链接、移动端链接

## [0.3.30] - 2026-01-25

### Added
- **媒体文件上传功能**: 保存草稿时自动上传媒体文件到 Cloudflare R2
  - 新增 `services/mediaService.ts` 媒体上传服务
  - 支持 presigned URL 直接上传，绕过后端服务器
  - 支持 base64 图片自动转换并上传（如 AI 生成的图片）
  - 支持上传进度回调
  - ArticleCard: 保存草稿时自动上传 header_image
  - DraftsPanel: 保存推文/Thread 草稿时自动上传所有媒体

- **微信公众号文章搬运功能**: 对接后端 `fetch_wechat_article` interrupt 流程
  - 抓取文章标题、作者、公众号名、发布时间、正文、封面图、图片列表
  - 新增 `WeChatArticleData` 接口
  - 新增 `scrapeWechatArticleForBackend()` 函数
  - 新增 `fetchWechatArticleHandler` Action Handler
  - 注册 `FETCH_WECHAT_ARTICLE` ActionDefinition
  - 添加 `fetch_wechat_article` 到 INTERRUPT_ACTIONS
  - Markdown 格式转换和搬运模式由后端处理

## [0.3.29] - 2026-01-25

### Added
- **Chat 文件上传功能**: 支持上传 PDF 和其他文档文件与 AI 对话
  - 支持的文件类型: PDF、图片 (JPEG/PNG/GIF/WebP)、纯文本、CSV、JSON
  - 图片最大 5MB，文档最大 20MB
  - 新增文件预览 UI，显示文件名和大小
  - 更新附件按钮图标为回形针 (Paperclip)，支持多文件选择
  - 聊天消息中显示已附加的文件列表

## [0.3.28] - 2026-01-25

### Fixed
- **ArticleCard 发布到 X 文章编辑器代码块插入**:
  - 修复代码块插入被重复触发的问题（添加静态 `isInsertingCodeBlocks` 标志防止并发执行）
  - 修复点击"插入"按钮后菜单未找到的问题（使用 `#toolbar-styling-buttons` 精准定位，等待 `[role="menu"]` 出现）
  - 修复点击"代码"菜单后弹窗未找到的问题（增加重试逻辑）
  - 修复 handlePublish 中 fillContent 被重复调用的问题（改用 async/await 替代 setInterval）
  - 如果当前已在空的文章编辑页面，直接粘贴内容而不是创建新文章

### Added
- **微信公众号文章搬运功能**: 对接后端 `fetch_wechat_article` interrupt 流程
  - 新增 `WeChatArticleData` 接口，返回后端要求的结构化数据格式
  - 新增 `scrapeWechatArticleForBackend()` 函数，专门为后端 API 抓取文章
  - 新增 `isValidWechatUrl()` URL 验证函数
  - 新增 `checkArticleErrors()` 错误检测（文章删除、需要登录、付费内容等）
  - 新增 `fetchWechatArticleHandler` Action Handler
  - 注册 `FETCH_WECHAT_ARTICLE` ActionDefinition
  - 添加 `fetch_wechat_article` 到 INTERRUPT_ACTIONS

### Changed
- **ArticleCard 编辑器迁移**: 从 Lexical 切换到 TipTap
  - 移除 `@lexical/react` 和 `lexical` 依赖
  - 安装 `@tiptap/react`、`@tiptap/starter-kit`、`@tiptap/extension-placeholder`、`@tiptap/extension-typography`
  - 实现 Notion 风格的实时 Markdown 渲染
  - 支持 `# ` 自动标题、`**文字**` 自动加粗、列表、引用等快捷方式
  - 内置撤销/重做 (Ctrl+Z / Ctrl+Shift+Z)
  - 优化暗色/亮色主题支持

## [0.3.27] - 2026-01-23

### Changed
- **Chrome Web Store 文案优化**: 精简 STORE_LISTING.md 详细描述
  - 移除所有表情符号，保持专业简洁
  - 移除分割线，适合直接复制到商店
  - 去掉 "(Twitter)" 提及，统一使用 X
  - 英文和中文版本保持适中长度，功能描述完整但不冗长

## [0.3.26] - 2026-01-21

### Added
- **Native X Boost Modal**: Implemented a native-style modal for X Boost functionality
  - **Single-Step Budget Configuration**: Simplified flow to directly show the Budget & Duration screen
  - **Native Look & Feel**: Uses Twitter's native styles, colors, and fonts via React Portal rendering
  - **Binance Gold Branding**: Sliders uses custom Binance Gold (`#F0B90B`) color
  - **Z-Index Priority**: max-safe-integer z-index to ensure visibility above all other elements

### Changed
- **Modal Architecture**: Moved from shadow DOM based modal to `document.body` React Portal for better style inheritance and layering
- **Infrastructure**: Updated extension container to allow full-screen overlay interaction
- **X Balance Panel**: Added X Balance menu and dedicated panel
  - **New Panel**: Dedicated X Balance panel to view user's current balance
  - **Sidebar Integration**: Added clickable "X Balance" menu item in user profile menu
  - **Refresh Functionality**: Added refresh button to fetch latest balance data
  - **App Routing**: Full integration with app routing system via `X_BALANCE` tab

## [0.3.25] - 2026-01-21


### Added
- **Boost Search Feature**: Added full search and filter functionality to BoostPanel
  - **Search API**: New `searchBoosts()` method in boostService with `q` parameter for unified search
  - **Unified Search (q param)**: Searches across author name, username, tweet content, and tweet ID (OR logic)
  - **Filter Dropdown**: Status filter (Active/Pending/Distributing/Completed), Token filter (BNB/USDT/USDC), Quick filters (Ending Soon/Has Budget)
  - **Refresh Button**: Replaced settings button with refresh button to reload search results

### Changed
- **BoostPanel UI Improvements**:
  - Search input now functional with 300ms debounce
  - Filter dropdown with shadow effect for better visibility
  - Empty state stays inline (keeps search bar visible) when no results found
  - Search skeleton only shows in list area, header remains interactive
  - Back button from Boost Info preserves search/filter state
  - Added cursor-pointer to filter and refresh buttons

### Fixed
- **Search Loading State**: Fixed issue where entire panel showed skeleton during search; now only list area shows skeleton while header stays visible
- **Empty State Coverage**: Fixed empty state covering search bar; now displays inline within content area
- **Back Navigation**: Fixed back button losing search state; now uses current searchParams

## [0.3.24] - 2026-01-21

### Changed
- **BoostChecker 主动请求替代拦截方案**: 完全重构 Boost 检测机制，改用主动调用 Twitter 内部 GraphQL API
  - **问题背景**: 之前使用 `interceptor.js` 拦截 Twitter 网络请求，但直接刷新页面时拦截器可能还没注入完成，导致错过首屏数据
  - **新方案**: 主动发起 `UserTweets` GraphQL 请求获取推文数据，完全不依赖拦截时机

- **TwitterClient.ts** - 新增 Twitter 内部 API 客户端
  - `getUserTweets(userId, count, cursor)`: 获取用户推文列表，支持分页
  - 动态提取 QueryID: 从 Twitter 页面脚本中提取 `TweetDetail`、`UserByScreenName`、`UserTweets` 的 QueryID
  - 动态提取 Bearer Token: 从页面脚本中提取认证 token
  - 返回 `quoteMap`: 主推文 ID → 被引用推文 ID 的映射关系

- **BoostChecker.ts** - 完全重构
  - 从 DOM 提取 userId: 通过 `profile_banners` 图片 URL 获取，无需额外 API 请求
  - PerformanceObserver 监听: 检测 Twitter 发起的分页请求，跟随加载下一页
  - 预填充 quoteCache: 用于 badge 注入时的反向查找
  - 预检查机制: 页面加载时立即发送 `check-tweets` 请求，不等用户滚动

- **check-tweets API 支持 include_completed 参数**: 个人主页检查时同时返回已完成的 Boost 活动
  - `boostService.checkTweets()` 新增 `includeCompleted` 参数
  - 个人主页默认传入 `include_completed=true`，显示 ACTIVE + COMPLETED 状态的 Boost

### Technical Details
- 详细技术文档见 `docs/BOOST_CHECKER_ARCHITECTURE.md`

### Removed
- 移除 `interceptor.js` 网络拦截器注入逻辑
- 移除 `index.tsx` 中的 `timelineBuffer` 早期消息缓冲机制
- 移除 `TwitterInterceptor.ts` 导入（保留文件作为备用）

## [0.3.23] - 2026-01-19

### Changed
- **Thread Merge feature**: Renamed "Long Tweet Summary" to "Thread Merge" to clarify it merges original text, not summarizes
  - English: "Thread Merge" / "Combine into one tweet"
  - Chinese: "长推合并" / "多条推文合为一条"
  - Query explicitly states to keep original text when merging thread tweets

### Fixed
- **Single line breaks not rendering**: Added `remark-breaks` plugin to ReactMarkdown
  - Single `\n` now renders as line breaks (previously only `\n\n` created paragraph breaks)
  - Fixes issue where merged thread content lost its original line formatting

- **Reasoning section line breaks**: Fixed newlines not rendering in ThinkingSection
  - Changed CSS class from `markdown-content` to `chat-markdown-content` to apply paragraph styles

- **Chat session interruption**: Fixed issue where old chat sessions weren't interrupted when starting a new conversation
  - Renamed `interruptSession()` to `interruptThread()` to match backend API naming (LangGraph terminology)
  - Updated endpoint from `/api/v1/ai/interrupt-session` to `/api/v1/ai/interrupt-thread`
  - Changed request body field from `session_id` to `thread_id`
  - Properly interrupts both frontend fetch requests and backend processing
  - Applies to both X Agent mode and regular Chat Panel

- **Video playback in rewrite feature**: Fixed video not playing in tweet draft preview
  - Added `transformOriginalMedia()` helper to convert Twitter API media format to component format
  - Properly extracts MP4 video URL from `video_info.variants` (selects highest bitrate)
  - Sets `media_url_https` as thumbnail and actual video URL as `video_url`
  - Fixes issue where `media_url` contained thumbnail instead of playable video URL

### Added
- **Boost Backend API Integration**: Complete integration with X Boost backend API
  - New `services/boostService.ts`: Full API client for boost operations
    - `getBoostSummary()`: Get plugin summary for tweet (no auth required)
    - `getBoostsByTweet()`: Get all boosts for a specific tweet
    - `getBoost()`: Get boost details by ID
    - `listBoosts()`: List boosts with filtering (auth required)
    - `createBoost()`: Create new boost campaign (auth required)
    - `activateBoost()`: Activate boost after on-chain deposit
    - `addBudget()`: Add budget to existing boost (auth required)
    - `completeBoost()`: Mark boost as completed (auth required)
    - `getActiveBoosts()`: Get all active boost campaigns
    - `getMyBoosts()`: Get user's own boosts (auth required)
  - Helper functions: `weiToToken()`, `tokenToWei()`, `extractTweetId()`, `formatRemainingTime()`
  - Full TypeScript types: `Boost`, `BoostPluginSummary`, `BoostCreate`, `TweetSnapshot`, etc.

### Changed
- **BoostPanel Complete Refactor**: Replaced mock data with real API integration
  - Fetches real boost data from backend on mount
  - Loading state with spinner while fetching
  - Error state with retry button
  - Empty state when no active boosts
  - Dynamic display of tweet author info, verified badge, content preview
  - **Media display support**: Shows images and videos from tweet snapshots
    - Responsive grid layout (1-4 media items)
    - Video play button overlay
    - "+N" indicator for additional media beyond 4
    - Thumbnail previews in list view
  - Real-time remaining budget and time calculations
  - Pool distribution display (quoter/retweeter percentages)
  - Status badges (active, pending, completed, etc.)
  - "View Tweet" button to open original tweet
  - Participant counts from actual data
- **Type exports**: Added boost types re-export from `types.ts` for convenience
- **Localization**: Added new boost-related strings
  - `loading`, `errorLoading`, `retry`, `noBoosts`, `noBoostsDesc`
  - `noContentPreview`, `active`, `viewTweet`, `poolDistribution`
  - `quoters`, `retweeters`

## [0.3.22] - 2026-01-18

### Changed
- **Sidebar Settings 整合**: 将主题切换、推文高亮、语言切换整合到统一的设置弹窗
  - 新增设置按钮（齿轮图标），hover 时显示设置弹窗
  - 设置弹窗包含：深色模式开关、Money Vision 开关、语言切换
  - 移除独立的主题切换和语言切换按钮，界面更简洁
  - 新增 `TextSwitch` 组件用于设置项开关
- **DraftsPanel 详情页重构**: 从 Modal 弹窗改为全页面视图
  - 移除 `DraftDetailModal` 组件，新增 `DraftDetailView` 组件
  - 使用返回按钮导航，替代关闭按钮
  - 详情页占据整个面板空间，提供更好的阅读体验
- **ThemeToggle 组件增强**: 支持 `displayMode` 属性
  - `icon` 模式：原有的图标按钮样式
  - `list` 模式：列表项样式，带文字标签和标准开关 UI
- **功能重命名**: "Tweet Highlight" 改名为 "Money Vision"（EN）/ "奖励高亮"（ZH）

## [0.3.21] - 2026-01-17

### Changed
- **DraftsPanel UI 重构**: 草稿卡片样式升级，与 AnalysisPanel 推文卡片保持一致
  - 添加用户头像显示（优先使用 Twitter 页面当前用户头像，回退使用 dicebear 生成）
  - 添加用户名、handle、认证徽章显示
  - 添加推文内容格式化（@mentions、#hashtags、URLs 高亮可点击）
  - 媒体预览改为 grid 布局，支持 1-4 张图片响应式显示
  - 图片加载添加 skeleton 骨架屏效果
  - 删除按钮改为 hover 时显示，放在卡片右下角
  - 删除确认改为 Modal 弹窗（Twitter 风格），不再使用 browser confirm
  - 点击卡片可直接跳转到原推文
  - 移除单独的 "View Original" 按钮，简化操作
- **草稿 API 自动 token 刷新**: `draftService` 改用 `authService.fetchWithAuth()`
  - 当收到 401 错误时自动使用 refresh token 刷新 access token
  - 刷新成功后自动重试原请求，无需用户手动重新登录
  - 只有在 refresh token 也失效时才提示用户重新登录
- **草稿功能登录检查**: 未登录用户点击草稿 tab 时自动显示登录页面

## [0.3.20] - 2026-01-17

### Added
- **Tweet Draft Feature**: Save any tweet from timeline/feed to drafts for later reference
  - New save button on all tweet cards in timeline (bookmark icon)
  - `services/draftService.ts`: API integration for saving, loading, and deleting drafts
  - `components/Toast.tsx`: Toast notification component for user feedback
  - `components/panels/DraftsPanel.tsx`: Full-featured draft manager with list view
  - Draft cards display author info, tweet content, media preview, and creation time
  - View original tweet button to open tweet in new tab
  - Delete draft functionality with confirmation
  - Auto-refresh draft list when new tweets are saved
  - Toast notifications for save success/error feedback
  - Localization support (English and Chinese) for all draft-related strings

### Changed
- `utils/TwitterInjector.ts`: Extended to inject save draft buttons on all tweets (not just user's own tweets)
  - Added `injectSaveDraftButton()` method for injecting save buttons
  - Added `handleSaveDraft()` method for saving tweet data to backend
  - Added `showToast()` method for displaying notifications
  - Save button uses bookmark icon with hover effects matching Twitter's UI style
- **Backend API Migration: session_id → thread_id**: Adapted frontend to backend SSE event field changes
  - `services/chatService.ts`: Updated `StreamEvent` interface to use `thread_id` instead of `session_id`
  - Updated `handleEvent()` method to parse `thread_id` from `session_start` events
  - Updated `ChatStreamCallback` interface parameter name from `sessionId` to `threadId` for consistency
  - `docs/ACTION_SYSTEM.md`: Updated SSE event examples to reflect new field name
  - Aligns with LangGraph framework and industry conventions

### Fixed
- **Draft loading error handling**: Fixed `draftService.getAllDrafts()` not properly detecting HTTP error responses
  - Added HTTP status code checking before error field checking
  - Now properly throws errors for non-200 status codes (especially 401 authentication failures)
  - Displays user-friendly error messages in DraftsPanel instead of silent failures
  - Added comprehensive debug logging for troubleshooting API issues

## [0.3.19] - 2026-01-16

### Added
- **Interrupt/Resume 流程支持**: 适配后端新的 interrupt/resume 机制，用于数据采集类 action
  - 新增 `interrupt` 事件类型处理，当后端需要前端执行 DOM 操作时触发
  - 新增 `resumeGraph()` 方法，用于在 action 执行完成后恢复 AI 对话流程
  - 新增 `onInterrupt` 回调，处理 interrupt 事件并执行相应 action
  - 新增 `INTERRUPT_ACTIONS` 常量，定义使用 interrupt 流程的 action 列表
  - 新增 thread ID 管理（`getCurrentThreadId`, `setCurrentThreadId`, `clearThreadId`）
  - 支持嵌套 interrupt（多个连续的数据采集操作）

### Changed
- `StreamEvent` 类型新增 `action_type`, `action_input`, `thread_id` 字段
- `ChatStreamCallback` 新增 `onInterrupt` 可选回调
- `startNewChat()` 现在会清除 thread ID
- **移除 twitter.com 权限**: manifest.json 只保留 x.com，减少不必要的权限请求

### Fixed
- **修复 action 执行时 loading 状态消失问题**: `complete` 事件后如果有 action 正在执行，保持 loading 状态
- **修复思考过程重复显示问题**: `sendActionResult`/`resumeGraph` 后不再创建新消息，继续更新当前消息
- **搜索页加载等待时间优化**: 导航到搜索页后等待时间固定为 2 秒
- **AI 操作可视化指示器**: 所有 Action 执行时自动显示蓝色呼吸发光效果
  - 指示器逻辑移至 ActionExecutor，统一管理所有 action 的视觉反馈
  - 使用 overlay 覆盖层 + inset box-shadow 实现内侧渐变发光
  - 覆盖范围：从左侧菜单栏到 primaryColumn 右边缘
  - 动态响应窗口大小变化，自动调整覆盖宽度
  - 呼吸动画效果（1.5秒周期），上下左右四边渐变发光
  - 点击中断按钮时自动取消 action 并隐藏蓝色框
- **修复拼音输入法回车误发送问题**: 使用 IME 输入法选字时按回车不再发送消息
- **Reasoning 区域优化**:
  - 默认高度改为 130px
  - 默认展开状态
  - reasoning 结束后自动收起
  - reasoning 内容为空时只显示 loading 和标题，不显示内容框
- **消息列表底部留白**: 发送消息后底部留出 60% 视口高度的空白，让新消息显示在更上方位置（仅在有消息时生效，不影响首页）

## [0.3.18] - 2026-01-16

### Changed
- **搜索抓取滚动优化**:
  - 滚动方式改为丝滑滚动（smooth），让用户看到 AI 在操作
  - 每次滚动 2-3 倍视口高度，距离适中确保动画流畅不卡顿
  - 滚动动画等待时间增加到 600ms，确保动画完成
  - 滚动间隔增加到 1000-1500ms，模拟人类行为避免 Twitter 检测
  - 提前退出条件放宽：连续 5 次没有新推文才退出（原来是 3 次）
  - 最大滚动次数增加到 40 次（原来是 25 次），确保能抓到 50 条
- **Coming Soon 提示位置优化**: 显示在插件面板右上角（距离边缘 16px），不再使用全局 NotificationToast

## [0.3.17] - 2026-01-16

### Changed
- **书签总结功能**: 点击"书签总结"卡片时显示 "Coming Soon" 提示，功能开发中
- **搜索模式开关默认值**: "用后端API高级搜索"开关默认关闭
  - 关闭时发送消息带上 "(use browser)" 后缀
  - 开启时发送消息带上 "（用后端 API 搜索）" 后缀

## [0.3.16] - 2026-01-16

### Changed
- **高级搜索结果回传**: `advanced_search` action 现在会自动抓取搜索结果并返回给后端 AI
  - 导航到搜索页后自动抓取推文数据（默认50条）
  - 显示实时抓取进度（如 "已抓取 10/50 条"）
  - 返回完整推文数据（包含 tweetId, authorHandle, content, metrics 等）
  - 支持通过 `limit` 参数自定义抓取数量
  - 支持中止操作（通过 abortController）

### Fixed
- 修复 `advanced_search` action 超时问题：将超时时间从 15 秒增加到 180 秒（3分钟），确保有足够时间抓取推文
- 优化抓取速度：滚动后等待时间从 1-2 秒减少到 0.3-0.5 秒，导航等待时间也相应缩短

## [0.3.15] - 2026-01-16

### Added
- **智能搜索模式**: 点击智能搜索卡片后显示专用输入提示框
  - 底部输入框上方显示"输入你想要搜索的内容"提示
  - 右侧添加开关控制是否使用后端 API 高级搜索（默认开启）
  - 搜索关键词的 placeholder 提示
  - 搜索时自动添加后缀 `（用后端 API 搜索）`（当开关开启时）

### Changed
- **YouTube 视频输入提示框优化**:
  - 左侧添加 YouTube 视频图标（红色品牌色）
  - 移除右侧关闭按钮，简化界面
  - 搜索模式和 YouTube 模式使用不同的提示文本和 placeholder，避免重复
- **搜索输入提示框优化**:
  - 左侧添加放大镜图标（主题色）
  - 移除右侧关闭按钮，简化界面
- **Web3趋势 和 AI 趋势卡片优化**:
  - 点击时自动在发送消息中添加"（直接调用 API）"后缀
  - 后缀仅用于后端识别，不在UI上显示给用户

### Fixed
- 修复点击不同功能卡片时提示框重叠的问题：YouTube 模式和搜索模式现在互斥切换
- 修复点击"图片创作"卡片后没有显示 Prompt Picker Modal（提示词选择器）的问题

## [0.3.13] - 2025-01-16

### Changed
- 字幕上传时机优化：改为视频上传进度达到10%时开始上传字幕（此时字幕按钮可见）
- 字幕上传逻辑大幅改进：
  - 支持多种选择器查找字幕上传按钮（addSubtitlesLabel, addCaptionsLabel 等）
  - 支持通过文本内容查找字幕按钮（"字幕"、"subtitle"、"caption"、".srt"）
  - 支持多种文件输入选择器（.srt, .vtt, subtitle, caption）
  - 添加最多 3 次重试机制
  - 增加等待时间确保模态框完全加载
  - SRT 文件添加 UTF-8 BOM 以提高兼容性
  - 使用 application/x-subrip MIME 类型
  - 同时触发 change 和 input 事件确保文件被检测到
  - 支持多种返回按钮选择器（back, close, done）

### Fixed
- 修复字幕上传在视频上传过程中触发导致的失败问题
- 修复字幕上传按钮找不到时没有重试的问题

## [0.3.12] - 2025-01-15

### Added
- **Action System**: Unified action framework for backend AI to trigger frontend DOM operations
  - `types/action.ts`: Action system type definitions (ActionDefinition, ActionContext, ActionHandler, etc.)
  - `services/actionExecutor.ts`: Singleton action executor with support for atomic and composite actions
  - `services/actionRegistry.ts`: Registry with 34 built-in action definitions across 9 categories
  - `services/actionIntegration.ts`: Integration helper for ChatPanel
  - `utils/BookmarkScraper.ts`: DOM scraper for Twitter bookmarks page

- **Action Handlers** (`services/actions/`):
  - Navigation: navigate_to_tweet, navigate_to_bookmarks, navigate_to_notifications, navigate_to_search, return_to_timeline
  - Reply: open_reply_composer, fill_reply_text, upload_image_to_reply, submit_reply
  - Tweet: open_tweet_composer, post_tweet, post_thread
  - Article: open_article_editor, fill_article_title, fill_article_body, upload_article_header_image, publish_article
  - Scrape: scrape_timeline, scrape_bookmarks, scrape_current_view, scrape_search_results
  - Notification: process_notifications, click_notification
  - Search: advanced_search (with Twitter search syntax support)
  - Scroll: scroll_and_collect, continuous_scroll
  - Composite: bookmark_summary, reply_with_image, search_and_analyze, timeline_analysis, create_thread, create_article

- **Localization**: Added action-related strings to en.ts and zh.ts
- **Documentation**: Added `docs/ACTION_SYSTEM.md` - Complete Action system documentation for backend AI integration

### Changed
- ChatPanel now initializes Action system on mount and handles `action_*` tool calls from backend
- YouTube 视频搬运模式改进：
  - 提示条文字改为 "输入你的YouTube视频链接 👇（建议5分钟以内）"
  - 输入框 placeholder 改为示例链接格式 `https://www.youtube.com/watch?v=xxx`
  - 发送时自动添加后缀 "搬运这个视频并输出推文"
  - 视频上传开始后立即自动上传字幕文件（从 analyze_youtube_transcript 获取的 bilingual_srt），无需等待视频上传完成
- Reasoning 思考过程显示优化：
  - 降低 reasoning 框的最大高度（从 256px 降至 150px）
  - 当 reasoning 流式输出结束后自动收起（如果用户之前展开了）
  - 没有 reasoning 内容时点击标题不再展开空白框
- `navigate_to_communities` action 改进：username 参数改为可选，不传则自动从页面获取当前登录用户名

### Fixed
- Fixed subtitle file encoding issue: now explicitly uses UTF-8 charset to ensure proper display
- Fixed subtitle line break handling: normalizes line breaks to Unix-style (\n) before creating SRT file
- Fixed reasoning box expansion: prevents expanding when there's no content yet (during initial "BNBot is thinking..." phase)

## [0.3.11] - 2025-01-15

### Added
- Auto-switch to Tweet Context panel (boost mode) when entering tweet detail page with Tweet Highlight enabled

## [0.3.10] - 2025-01-15

### Fixed
- Fixed CORS errors by routing all API calls through background script proxy
- Auth endpoints (google-oauth, email-login, send-verification-code) now use background script messaging
- Chat service cached tweet info endpoint now uses authenticated fetch

### Changed
- Cleaned up host_permissions: removed unused twitter.com, x.com, youtube.com (only api.bnbot.ai and googlevideo.com needed)

## [0.3.9] - 2025-01-12

### Added
- Code block insertion UI panel with two modes:
  - **Auto Insert**: Click "⚡ 自动插入全部" to automatically insert all code blocks
  - **Manual Insert**: Copy code individually and use toolbar Insert → Code
- Progress indicator during auto-insertion showing current/total count
- Success/failure feedback with retry option

### Changed
- Improved markdown paste workflow: code blocks are now automatically inserted at placeholder positions
- Enhanced toast notifications for code block insertion progress (inserting/completed states)

## [0.3.8] - 2025-01-11

### Added
- Article editor page support with adaptive left navigation
- Inject "BNBot" button into article editor header (next to Publish button) when panel is collapsed
- Focus mode dialog offset to prevent overlap with BNBot panel
- Drag-and-drop image upload support for article editor page (drag AI-generated images into article editor)
- Markdown paste support for article editor: paste markdown text, it converts to HTML and prompts to paste again for proper formatting
- Multi-language toast notification support (Chinese/English) for markdown paste feature

### Changed
- Left navigation collapses to icons-only when panel is expanded on article editor pages
- Left navigation restores to normal when panel is collapsed on article editor pages
- Hide default collapse button on article editor pages in favor of injected button
- Improved code block handling in markdown paste: now renders as blockquotes (Twitter's native code block requires manual Insert menu)
- Added informative toast message when pasting markdown with code blocks, guiding users to use Insert → Code block for proper code formatting

## [0.3.7] - 2025-01-10

### Added
- Drag-and-drop image upload from Chat panel to Twitter reply composer
- Support for dragging AI-generated images directly into Twitter posts
- Auto-expand collapsed reply boxes when dropping images

## [0.3.6] - 2025-01-09

### Changed
- Improved thinking section UI with shimmer animation effect
- Changed loading indicator from dots to ball style
- Updated tagline display in welcome screen
- Refined chat UI spacing for tighter, cleaner layout (message padding, draft cards, action buttons)

### Fixed
- Fixed `chrome.identity.clearAllCache` to use correct API `clearAllCachedAuthTokens`
- Fixed TypeScript configuration for better type checking
- Fixed thinking section parsing for bold headers
- Improved streaming indicator visibility logic
- Fixed YouTube video processing "ArrayBuffer detached" error by cloning data before FFmpeg writeFile

## [0.3.5] - 2025-01-08

### Added
- FFmpeg integration for video/audio processing
- YouTubeProcessor component for YouTube content handling
- TweetContentEditor component for editing tweet content
- Video to Tweet feature - convert YouTube content to posts

### Changed
- Extension name updated to "BNBot: Your AI Growth Agent for X"
- Updated welcome tagline to "Your AI Growth Agent for X" (EN) / "你在 X 上的 AI 增长智能体" (ZH)
- Removed BNB Chain branding from welcome screen
- Removed waving animation from hand emoji in greeting
- Improved media utilities with download progress tracking
- Vite config now uses manifest.json name instead of hardcoded value

### Fixed
- Fixed infinite polling loop in user handle resolution (was causing console spam)
- Fixed scroll behavior when expanding thinking/reasoning section
- Fixed URL text wrapping in user message bubbles (long URLs now break correctly)
- Fixed previous messages showing loading state when sending new message or regenerating
- Show "BNBot is thinking..." immediately when model starts processing (on model_start event)
- Auto-scroll reasoning section to bottom when streaming new content

### Removed
- Removed MediaTestPanel (dev-only test UI)

## [0.3.4] - 2025-01-07

### Added
- New image size options (Small, Medium, Large, Original)
- Language support improvements for chat interface

### Changed
- Updated logo design and assets structure
- Improved build configuration for better asset handling
- Enhanced authentication flow with better error handling

### Fixed
- Fixed tweet draft video media not displaying (now supports new `media` object format from backend)

## [0.3.3] - 2025-01-07

### Fixed
- Fixed tweet draft video media not displaying (now supports new `media` object format from backend)

## [0.3.2] - 2025-01-07

### Fixed
- Increased post confirmation timeout from 10s to 30s for image uploads

## [0.3.1] - 2025-01-06

### Changed
- Removed logo from ChatPanel welcome screen

## [0.3.0] - 2025-01-06

### Changed
- Updated logo design
- Removed unused logo files to reduce package size

## [0.2.0]

### Added
- Auto-reply feature
- Tweet analysis panel
- Image generation support

## [0.1.0]

### Added
- Initial release
- AI chat with BNBOT API
- Google OAuth login
- Boost panel
- Credits management
