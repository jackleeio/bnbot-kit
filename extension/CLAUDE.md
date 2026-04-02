# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

BNBOT is a Chrome extension that injects an AI-powered sidebar into Twitter/X. It provides features like AI chat, auto-reply, tweet analysis, and content boosting for social media growth.

## Related Projects

| Project | Path | Description |
|---------|------|-------------|
| Extension (this) | `/Users/jacklee/Projects/bnbot-extension` | Chrome 扩展 |
| CLI | `/Users/jacklee/Projects/bnbot-cli` | @bnbot/cli npm 包 |
| Skill | `/Users/jacklee/Projects/bnbot` | /bnbot Claude Code skill |
| Frontend | `/Users/jacklee/Projects/bnbot-frontend` | 官网 bnbot.ai (Next.js) |
| OpenCLI source | `/Users/jacklee/Projects/opencli-source` | opencli 上游参考代码 |
| Backend | `/Users/jacklee/Projects/BNBOT` | 后端 API (FastAPI, LangGraph) |

**数据库迁移**: 在 `/Users/jacklee/Projects/BNBOT/backend` 目录下执行：
```bash
.venv/bin/python -m alembic upgrade head
```

## Build Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server with HMR (port 3030)
npm run build        # Production build to dist/
npm run watch        # Build with watch mode
```

After building, load the `dist/` folder as an unpacked extension in Chrome.

## Architecture

### Extension Entry Points
- `manifest.json` - Chrome MV3 manifest
- `background.ts` - Service worker handling OAuth and API proxy
- `index.tsx` - Content script entry, injects React app into Twitter via Shadow DOM

### Core Structure
```
App.tsx                    # Main app with tab navigation and state management
├── components/Sidebar.tsx # Tab navigation sidebar
├── components/panels/     # Feature panels (ChatPanel, AutoReplyPanel, etc.)
├── services/             # Backend API integration
│   ├── authService.ts    # Google OAuth + session management
│   ├── chatService.ts    # AI chat with BNBOT API
│   └── autoReplyService.ts # Auto-reply orchestration
└── utils/                # Twitter DOM manipulation
    ├── ReplyPoster.ts    # Post replies with images
    ├── TweetEvaluator.ts # Evaluate tweets for auto-reply
    ├── TimelineScroller.ts # Timeline navigation
    └── TwitterInjector.ts # Inject UI into Twitter
```

### Key Patterns

**Shadow DOM Isolation**: The extension uses Shadow DOM (`index.tsx:50`) to prevent CSS conflicts with Twitter.

**Twitter DOM Selectors**: Utils like `ReplyPoster.ts` and `TwitterInjector.ts` use `data-testid` selectors to interact with Twitter's UI. These may break if Twitter updates their markup.

**API Communication**: Content scripts can't make cross-origin requests directly. All API calls go through `background.ts` via Chrome messaging (`API_REQUEST` message type).

**Tab System**: Defined in `types.ts` as `Tab` enum. State managed in `App.tsx`, persisted to `chrome.storage.local`.

**Twitter 页面内导航**: 在 Twitter 内跳转链接时，**必须使用点击链接的方式（router push）**，而不是 `window.location.href`。直接设置 href 会导致页面刷新，破坏 SPA 体验。正确做法：
```typescript
// ✅ 正确：创建临时链接并点击（不刷新页面）
const tempLink = document.createElement('a');
tempLink.href = targetUrl;
tempLink.style.display = 'none';
document.body.appendChild(tempLink);
tempLink.click();
document.body.removeChild(tempLink);

// ❌ 错误：直接设置 href（会刷新页面）
window.location.href = targetUrl;
```

**Modal 实现规范**: 扩展侧边栏内的所有 Modal 必须遵循以下模式（参考实现：`TaskCreateModal.tsx`）：
1. **必须降低侧边栏 z-index**：Modal 打开时注入 CSS 将 `[data-testid="bnbot-sidebar"]` 的 z-index 设为 0，关闭时移除。否则侧边栏图标仍可点击、hover 提示会穿透 modal、边框会透过半透明遮罩显示为白线。
2. **Overlay 结构**：`position: fixed; top: 0; right: 0; width: 486px; height: 100vh; zIndex: 9999; backgroundColor: rgba(128, 128, 128, 0.25)`
3. **卡片样式**：使用 `w-full max-w-[SIZE]`（不要 `w-[SIZE]`），必须有 `overflow-hidden` 配合 `rounded-2xl`
4. **原因**：App.tsx 主容器的 `transform: translateX()` 会让 `position: fixed` 相对于容器而非视口定位，侧边栏导航是同级元素有独立 z-index 层叠

```tsx
// 每个 modal 必须加这个 useEffect（id 要唯一）
useEffect(() => {
  if (isOpen) {
    const style = document.createElement('style');
    style.id = 'my-modal-sidebar-fix';
    style.textContent = `[data-testid="bnbot-sidebar"] { z-index: 0 !important; } [data-testid="bnbot-sidebar"] * { z-index: 0 !important; }`;
    const shadowContainer = document.getElementById('x-sidekick-container');
    const target = shadowContainer?.shadowRoot || document.head;
    target.appendChild(style);
    return () => { (shadowContainer?.shadowRoot || document).getElementById('my-modal-sidebar-fix')?.remove(); };
  }
}, [isOpen]);
```

### Panels
- `ChatPanel` - Main AI chat interface with tool calling support
- `AutoReplyPanel` - Configure and run automated replies
- `BoostPanel` - Content promotion tasks
- `AnalysisPanel` - Tweet/account analytics
- `CreditsPanel` - Usage and subscription management

## Feature Comparison (vs twitter-cli, bb-browser, opencli)

### Twitter Operations

| Feature | BNBOT (Extension + CLI) | twitter-cli | bb-browser | opencli |
|---------|:-:|:-:|:-:|:-:|
| Read timeline | API intercept | GraphQL API | fetch/eval | GraphQL |
| Post tweet | DOM + media | GraphQL API | eval | DOM |
| Post thread | DOM | - | - | - |
| Post with images/video | DOM | API (4 imgs) | - | - |
| Reply | DOM | GraphQL API | eval | DOM |
| Delete tweet | DOM | API | - | DOM |
| Like / Unlike | DOM | API | eval | DOM |
| Retweet / Unretweet | DOM | API | eval | - |
| Quote tweet | DOM | API | - | - |
| Bookmark / Unbookmark | DOM | API | - | GraphQL |
| Follow / Unfollow | DOM | API | - | - |
| Search (top/latest/people/media/lists) | DOM + navigate | API | adapter | GraphQL |
| Search filters (from/since/until/lang/min_faves) | URL params | API params | - | - |
| User profile | GraphQL API | API | fetch | GraphQL |
| User tweets | GraphQL API | API | adapter | - |
| Followers / Following list | - (needs x-client-transaction-id) | API | - | GraphQL |
| Twitter Lists | - | API | - | - |
| Account analytics | GraphQL API | - | - | - |
| Thread scraping | DOM | API | - | - |
| Article (long-form) creation | DOM | - | - | - |
| WeChat/TikTok/Xiaohongshu | Extension + CLI | - | adapter | adapter |

### Architecture Comparison

| Aspect | BNBOT | twitter-cli | bb-browser | opencli |
|--------|-------|------------|------------|---------|
| Type | Chrome Extension + MCP CLI | Python CLI | CLI + Extension + Daemon | CLI + Playwright |
| Auth | Browser session (cookies) | Cookie extraction + curl_cffi TLS | Browser session | Browser session |
| Anti-detection | Best (native extension, no fingerprint) | Good (TLS impersonation, x-client-transaction-id) | Good (real browser) | Good (real browser) |
| AI integration | MCP protocol | CLI output | MCP protocol | CLI output |
| Server/headless | No (needs browser) | Yes | No | No |
| Multi-platform | Twitter only + WeChat/TikTok/XHS | Twitter only | 36 platforms | 17 platforms |

### Key Differences

- **BNBOT**: Safest (Chrome extension = invisible to Twitter), richest write operations (thread, article, media), MCP for AI agents. Limitation: cannot make direct API calls requiring x-client-transaction-id (followers/following).
- **twitter-cli**: Most complete Twitter API coverage (all read/write ops), works headless on servers, but higher detection risk (direct API calls outside browser).
- **bb-browser**: Most platforms (36+), general-purpose browser automation, but Twitter-specific features are basic.
- **opencli**: Good balance of platforms and features, YAML pipeline system, but limited Twitter write operations.

## Scraper Service

内置数据抓取服务（`services/scraperService.ts`），通过 `chrome.scripting.executeScript()` 在目标页面上下文中调用网站内部 API 获取数据。不需要 `debugger` 权限。

### 工作原理
- 使用 `chrome.scripting.executeScript({ world: 'MAIN' })` 在页面主世界执行 JS
- 在页面上下文中调用网站自己的内部 API（带 `credentials: 'include'` 借用用户登录态）
- Tab 池化复用：同一域名的 tab 会被复用，30 秒空闲后自动关闭

### 已支持的平台（扩展 — 需要浏览器登录态）

| 平台 | 函数 | 方式 |
|------|------|------|
| TikTok | `searchTikTok` | 内部 API `/api/search/general/full/` |
| YouTube | `searchYouTube` | InnerTube API `/youtubei/v1/search` |
| Reddit | `searchReddit` | JSON API `/search.json` |
| Bilibili | `searchBilibili` | WBI 签名 API `/x/web-interface/wbi/search/type` |
| 知乎 | `searchZhihu` | API `/api/v4/search_v3` |
| 雪球 | `searchXueqiu` | API `/stock/search.json` |
| Instagram | `searchInstagram` | API `/web/search/topsearch/` |
| Linux.do | `searchLinuxDo` | Discourse API `/search.json` |
| 即刻 | `searchJike` | React fiber DOM 提取 |
| 小红书 | `searchXiaohongshu` | DOM 解析 `.note-item` |
| 微博 | `searchWeibo` | DOM 解析 `.card-wrap` |
| 豆瓣 | `searchDouban` | DOM 解析 `.item-root` |
| Medium | `searchMedium` | DOM 解析 article 元素 |
| Google | `searchGoogle` | DOM 解析 `#rso` |
| Facebook | `searchFacebook` | DOM 解析 `[role="article"]` |
| LinkedIn | `searchLinkedInJobs` | Voyager API + CSRF |
| 36氪 | `search36Kr` | DOM 解析 `.article-item-title` |
| Product Hunt | `fetchProductHuntHot` | DOM 解析产品卡片 |
| 微信 | `fetchWeixinArticle` | DOM 提取文章内容 |
| Yahoo Finance | `fetchYahooFinanceQuote` | v8 chart API + DOM fallback |

### CLI PUBLIC API（不需要浏览器，在 bnbot-cli 中）
HackerNews, StackOverflow, Wikipedia, Apple Podcasts, Substack, V2EX, Bloomberg, BBC, 新浪财经, 新浪博客, 小宇宙

### 注意事项
- 所有 `func` 内部用 try-catch 包裹，返回 `{ error }` 而不是 throw（防止 Promise 挂住）
- 未登录检测：两层（URL redirect + DOM 内容检查）
- 30 秒全局超时兜底
- 不要用 `new Function()` 或 `eval()`，会被目标网站的 CSP 拦截
- Tab 池化复用，30 秒空闲自动关闭

### 添加新平台
1. 在 `services/scrapers/browser/` 创建新文件
2. Import `getTab, checkLoginRedirect` from `../../scraperService`
3. 用 `func` + `args` 模式，func 内部 try-catch
4. 在 `services/scrapers/browser/index.ts` 导出
5. 在 `background.ts` 注册消息处理和 console testing
6. 在 `manifest.json` 的 `host_permissions` 中添加目标域名

## Environment Variables

Create `.env` with:
```
GEMINI_API_KEY=your_key
```

## Localization

Translations in `locales/` (en.ts, zh.ts). Use `useLanguage()` hook to access `t()` function.

## Version Management

**每次修改代码后必须更新 CHANGELOG.md**，记录改动内容。

```bash
npm run bump        # bug fix: 0.3.2 → 0.3.3
npm run bump:minor  # new feature: 0.3.2 → 0.4.0
npm run bump:major  # breaking change: 0.3.2 → 1.0.0
```

CHANGELOG 格式：
```markdown
## [x.x.x] - YYYY-MM-DD

### Added/Changed/Fixed/Removed
- 具体改动描述
```

## Release 打包

**发布新版本时，必须将打包文件放到 `releases/` 目录**。

⚠️ **重要：**
1. **必须用 `npm run build:release`**（不是 `npm run build`），否则名称会有 "(Dev)" 后缀
2. **`host_permissions` 中的 localhost 已由 `vite.config.ts` 在 production 构建时自动移除，无需手动处理**
3. **`content_security_policy` 中的 `ws://localhost:*` 和 `http://localhost:*` 必须保留！** 这是 opencli bridge 和 bnbot-cli bridge 的 WebSocket/HTTP 连接所必需的，删除会导致本地 CLI 工具无法连接扩展

### 完整发布流程：

```bash
# 1. 更新 CHANGELOG.md 和版本号
npm run bump  # 或 npm run bump:minor

# 2. 提交代码
git add -A && git commit -m "feat: ..."

# 3. 用 production 模式构建（重要！）
# vite.config.ts 会自动从 host_permissions 移除 localhost
# content_security_policy 中的 localhost 保留（bridge 需要）
npm run build:release

# 4. 打包到 releases 目录
cd dist && zip -r ../releases/bnbot-v{VERSION}.zip . && cd ..

# 5. 上传 releases/bnbot-v{VERSION}.zip 到 Chrome Web Store
```

打包文件命名格式：`bnbot-v{VERSION}.zip`（如 `bnbot-v0.4.12.zip`）

## Git Commit 规则

**自主判断 commit 时机，不要频繁询问：**

适合 commit 的时机（满足任一即可询问用户）：
- 一个完整功能开发完成
- 一个 bug 修复完成并验证
- 一次有意义的重构完成
- 多个相关的小改动累积成一个逻辑单元

**不要在以下情况询问：**
- 只改了一两行代码
- 还在调试/迭代中
- 用户明显还要继续改

提交前确保：
1. 更新 CHANGELOG.md（按版本管理规范）
2. 使用 `npm run bump` 或 `npm run bump:minor` 更新版本号
3. Commit message 风格：conventional commits（feat:, fix:, refactor:, docs: 等）

## Git Worktree 工作流程

**每次修改代码前，必须在 worktree 中进行，不要直接修改 main 分支。**

### Worktree 目录
```
/Users/jacklee/Projects/bnbot-extension-worktrees/<branch-name>/
```

### 工作流程

1. **开始任务** - 创建 worktree 和临时分支：
```bash
# 生成分支名（格式：wt-日期-简短描述）
git worktree add ../bnbot-extension-worktrees/wt-20260205-feature-name -b wt-20260205-feature-name
cd ../bnbot-extension-worktrees/wt-20260205-feature-name
npm install  # 如需要
```

2. **在 worktree 中开发**：
```bash
# 正常开发、测试
npm run dev
# 完成后 commit
git add .
git commit -m "feat: ..."
```

3. **合并回 main 并清理**：
```bash
# 回到主仓库
cd /Users/jacklee/Projects/bnbot-extension-new
# 合并分支
git merge wt-20260205-feature-name
# 删除 worktree 和分支
git worktree remove ../bnbot-extension-worktrees/wt-20260205-feature-name
git branch -d wt-20260205-feature-name
```

### 注意事项
- 每个 worktree 必须关联独立分支，不能与其他 worktree 共享
- 完成任务后及时清理 worktree，避免积累
- 如有未提交的修改需要切换任务，先 commit 或 stash

## Git Push 代理

遇到网络问题时，使用代理提交：
```bash
export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7890
git push
```
