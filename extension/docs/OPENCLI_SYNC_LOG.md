# OpenCLI Sync Log

Track updates synced from opencli (https://github.com/jackwener/opencli) to BNBot.
Review every 3 weeks. Source: `/Users/jacklee/Projects/opencli-source/`

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
