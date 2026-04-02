# Scraper 扩展命令实现计划

对标 opencli 的每个平台命令，补全缺失的。分三层：扩展 scraper → CLI commander → 测试。

## 需要新增的命令

### 浏览器抓取（扩展 + CLI）

| 平台 | 已有 | 需新增 |
|------|------|--------|
| TikTok | search | explore(热门) |
| YouTube | search | video(视频详情), transcript(字幕) |
| Reddit | search | hot(热帖), frontpage |
| Bilibili | search | hot(热门), ranking(排行) |
| 知乎 | search | hot(热榜) |
| 雪球 | search | hot(热帖), hot-stock(热股) |
| Instagram | search | explore(发现) |
| Linux.do | search | feed(最新), tags(标签) |
| 即刻 | search | feed(动态) |
| 小红书 | search, fetch | feed(推荐) |
| 微博 | search | hot(热搜榜) |
| 豆瓣 | search | top250, movie-hot, book-hot |
| Medium | search | feed(推荐) |
| Google | search | news(新闻), trends(趋势) |
| Facebook | search | feed(动态) |
| LinkedIn | search | — (够用) |
| 36氪 | search | hot(热榜), news(快讯) |
| ProductHunt | hot | — (够用) |

### 公开 API（仅 CLI）

| 平台 | 已有 | 需新增 |
|------|------|--------|
| HackerNews | search | top, new, best, show, jobs |
| V2EX | hot | latest |
| StackOverflow | search | hot |
| Wikipedia | search | summary(摘要), trending |
| Bloomberg | news | markets, tech |
| 小宇宙 | podcast | episodes(单集列表) |
| Apple Podcasts | search | — (够用) |
| Substack | search | — (够用) |
| 新浪财经 | news | — (够用) |
| 新浪博客 | search | — (够用) |
| BBC | news | — (够用) |

## 实现步骤

1. **扩展端**：在 `services/scrapers/browser/` 各文件中新增函数，注册到 `background.ts` 的 `scraperHandlers`
2. **CLI 端**：在 `src/commands/scraperActions.ts` 新增 handler，在 `src/index.ts` 注册 commander 子命令
3. **公开 API**：在 `src/publicScrapers.ts` 新增，在 `src/index.ts` 注册
