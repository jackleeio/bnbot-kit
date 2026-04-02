# BNBOT MCP 工具测试清单

更新时间：2026-03-06

状态说明：`✅ 已通过` / `⚠️ 部分通过` / `⏳ 待回归` / `❌ 失败`

## 0. 前置环境

- MCP Server：`/Users/jacklee/Projects/bnbot-mcp-server` 启动（默认 `18900`）
- 插件：`/Users/jacklee/Projects/bnbot-extension-new` 已加载，OpenClaw/MCP 开关开启，端口一致
- X 页面：已登录
- 后端：`/Users/jacklee/Projects/BNBOT` 可用（内容搬运/下载类工具建议开启）

## 1. 全部工具测试结果（30 个）

### 状态类

| 工具 | 结果 | 备注 |
|---|---|---|
| `get_extension_status` | ✅ | |
| `get_current_page_info` | ✅ | |

### 导航类

| 工具 | 结果 | 备注 |
|---|---|---|
| `navigate_to_tweet` | ✅ | 含 URL 验证 |
| `navigate_to_search` | ✅ | 支持 sort 参数 |
| `navigate_to_bookmarks` | ✅ | |
| `navigate_to_notifications` | ✅ | |
| `navigate_to_following` | ✅ | |
| `return_to_timeline` | ✅ | |

### 发推类

| 工具 | 结果 | 备注 |
|---|---|---|
| `post_tweet` | ✅ | 支持文本/媒体/draftOnly |
| `post_thread` | ✅ | 修复 Compose/Add 流程后，纯文本/图片/视频已验证 |
| `submit_reply` | ✅ | 含导航+双重验证 |

### 互动类

| 工具 | 结果 | 备注 |
|---|---|---|
| `like_tweet` | ✅ | |
| `retweet` | ✅ | |
| `quote_tweet` | ✅ | 支持 draftOnly |
| `follow_user` | ✅ | 支持 username 参数 |

### 抓取类

| 工具 | 结果 | 备注 |
|---|---|---|
| `scrape_timeline` | ✅ | |
| `scrape_bookmarks` | ✅ | |
| `scrape_current_view` | ✅ | |
| `scrape_search_results` | ✅ | |
| `scrape_thread` | ✅ | |
| `account_analytics` | ✅ | 已修复参数映射为 fromTime/toTime |

### 内容获取类

| 工具 | 结果 | 备注 |
|---|---|---|
| `fetch_wechat_article` | ✅ | |
| `fetch_tiktok_video` | ✅ | |
| `fetch_xiaohongshu_note` | ✅ | |

### 文章工具（新增）

| 工具 | 结果 | 备注 |
|---|---|---|
| `open_article_editor` | ✅ | 先到 `/compose/articles` 再点击创建 |
| `fill_article_title` | ✅ | 已修复误写正文问题 |
| `fill_article_body` | ✅ | 纯文本/图片/Markdown 均可用；改用 ClipboardEvent+DataTransfer 让 Draft.js 原生处理 |
| `upload_article_header_image` | ✅ | 已补 `applyButton` 点击流程 |
| `publish_article` | ⏳ | 待单独回归（仅自动保存草稿路径已覆盖） |
| `create_article` | ✅ | 支持 format 参数（plain/markdown/html），Markdown 格式已验证 |

## 2. 仍需重点回归

- `publish_article` 独立发布路径

## 3. 已移除工具

- `fetch_youtube_video` — 已移除
- `download_youtube_video` — 已移除

## 4. 总结

- 共 28 个工具（移除 2 个 YouTube 工具）：
- `✅ 27` 个已通过
- `⏳ 1` 个待回归（`publish_article`）
