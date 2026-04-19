# OpenCLI Sync Log

Track updates synced from opencli (https://github.com/jackwener/opencli) to BNBot.
Review every 3 weeks. Source: `/Users/jacklee/Projects/opencli-source/`

## 2026-04-18 — opencli v1.7.4 Sync

**opencli version:** v1.7.4
**BNBot extension:** v0.7.6

### Changes synced

**YouTube 全量操作（新增）:**
- 写操作: like/unlike video (InnerTube + SAPISIDHASH auth), subscribe/unsubscribe channel (with @handle → channelId resolution)
- 读操作: feed (homepage recommendations), history (watch history), watch-later (WL playlist), subscriptions (channel list)
- Message handlers: `YOUTUBE_LIKE`, `YOUTUBE_UNLIKE`, `YOUTUBE_SUBSCRIBE`, `YOUTUBE_UNSUBSCRIBE`, `YOUTUBE_FEED`, `YOUTUBE_HISTORY`, `YOUTUBE_WATCH_LATER`, `YOUTUBE_SUBSCRIPTIONS`

**Bug fix:**
- Twitter 视频下载: `VideoDownloadManager.downloadVideo` 从 `window.open()` 改为 `chrome.runtime.sendMessage({type: 'DOWNLOAD_VIDEO', ...})`，触发 chrome.downloads API

**Skill 新爬虫 (opencli 新增平台):**
- 东方财富热股榜 (`crawl-eastmoney.js`) — 通过 opencli `eastmoney hot-rank`
- 牛客网热搜 (`crawl-nowcoder.js`) — opencli + 直连公开 API 双策略

### Not synced this cycle
- eastmoney/tdx/ths stock hot-ranks in extension browser scrapers (skill script already covers)
- xiaoyuzhou auth/download/transcript: niche use case, CLI approach better
- twitter lists updates: existing implementation sufficient
- nowcoder/baidu-scholar/google-scholar/gov-law/gov-policy: added to skill only

## 2026-04-01 — Initial Sync

**opencli version:** v1.5.7
**BNBot extension:** v0.7.1
**@bnbot/cli:** v0.3.4

### Platforms synced (33 total)

**Browser scrapers (extension, 19 platforms):**
TikTok (search, explore), YouTube (search with --type/--upload/--sort, Shorts support), Reddit (search, hot), Bilibili (search, hot, ranking), Zhihu (search, hot), Xueqiu (search, hot), Instagram (search, explore), Linux.do (search), Jike (search), Xiaohongshu (search, fetch), Weibo (search, hot), Douban (search, movie-hot, book-hot, top250), Medium (search), Google (search, news), Facebook (search), LinkedIn (search), 36Kr (search, hot, news), ProductHunt (hot), WeChat (article), Yahoo Finance (quote)

**CLI public scrapers (11 platforms):**
HackerNews (search, top, new, best, show, jobs), StackOverflow (search, hot), Wikipedia (search, summary), Apple Podcasts (search), Substack (search), V2EX (hot, latest), Bloomberg (news), BBC (news), Sina Finance (news), Sina Blog (search), Xiaoyuzhou (podcast, episodes)

### Key changes from opencli
- YouTube: ported PR #616 — search filters (--type shorts/video, --upload, --sort views/date), reelItemRenderer parsing, published time field
- TikTok: ported explore.yaml — multi-API fallback (explore, recommend, search)
- All scrapers: use chrome.scripting instead of CDP (no debugger permission)

### Not synced (by design)
- Spotify: API blocks extension requests, needs OAuth
- ONES: requires specific team environment
- Desktop adapters (Cursor, ChatGPT, etc.): not applicable to browser extension
- Write operations (follow, like, comment on non-X platforms): future work

---

## Next Review: 2026-04-22

**Checklist:**
- [ ] `git pull` opencli-source to latest
- [ ] Compare each platform's search.ts/yaml against our implementation
- [ ] Check for new platforms added to opencli
- [ ] Check for API endpoint changes
- [ ] Check for new commands (e.g., new "trending" endpoints)
- [ ] Update and test changed scrapers
- [ ] Update this log
