# BNBOT Feature Comparison

How BNBOT (Extension + CLI) compares with twitter-cli, bb-browser, opencli, and other Twitter automation tools.

## Twitter Operations

| Feature | BNBOT | twitter-cli | bb-browser | opencli | chrome-cdp-skill |
|---------|:-----:|:-----------:|:----------:|:-------:|:---------------:|
| **Read** | | | | | |
| Read timeline | API intercept | GraphQL | fetch/eval | GraphQL | eval |
| User profile | GraphQL API | API | fetch | GraphQL | eval |
| User tweets | GraphQL API | API | adapter | - | eval |
| Search (top/latest/people/media/lists) | DOM + URL | API | adapter | GraphQL | - |
| Search filters (from/since/until/lang/min_faves) | URL params | API params | - | - | - |
| Bookmarks | GraphQL API | API | - | GraphQL | - |
| Thread scraping | DOM | API | - | - | - |
| Account analytics | GraphQL API | - | - | - | - |
| Followers / Following | - | API | - | GraphQL | - |
| Twitter Lists | - | API | - | - | - |
| Tweet scoring / ranking | - | Weighted scoring | - | - | - |
| **Write** | | | | | |
| Post tweet | DOM | API | eval | DOM | click+type |
| Post with images | DOM | API (max 4) | - | - | - |
| Post with video | DOM | - | - | - | - |
| Post thread | DOM | - | - | - | - |
| Reply (with images) | DOM | API | eval | DOM | click+type |
| Delete tweet | DOM | API | - | DOM | - |
| Like / Unlike | DOM | API | eval | DOM | - |
| Retweet / Unretweet | DOM | API | eval | - | - |
| Quote tweet (with media) | DOM | API | - | - | - |
| Bookmark / Unbookmark | DOM | API | - | GraphQL | - |
| Follow / Unfollow | DOM | API | - | - | - |
| Create article (long-form) | DOM | - | - | - | - |
| **Other Platforms** | | | | | |
| WeChat article scraping | Extension | - | adapter | - | - |
| TikTok video download | Extension | - | adapter | - | - |
| Xiaohongshu content | Extension | - | adapter | adapter | - |
| Multi-platform support | Twitter + 3 | Twitter only | 36 platforms | 17 platforms | Any website |

## Safety & Anti-Detection

| Aspect | BNBOT | twitter-cli | bb-browser | opencli | chrome-cdp-skill |
|--------|:-----:|:-----------:|:----------:|:-------:|:---------------:|
| Detection risk | Lowest | Higher | Low | Low | Medium |
| TLS fingerprint | Real browser | curl_cffi impersonation | Real browser | Real browser | Real browser |
| Browser fingerprint | No anomaly | No browser | No anomaly | No anomaly | No anomaly |
| Behavior simulation | HumanBehaviorSimulator | Request jitter | Manual | 1-3s delays | None |
| Request pattern | Passive intercept / DOM | Direct API calls | In-browser fetch | In-browser fetch | CDP eval |
| x-client-transaction-id | Not needed (DOM) | Generated via xclienttransaction | Not needed | Not needed | Not needed |

**Why BNBOT is safest**: Chrome extensions are a native browser mechanism. Twitter cannot distinguish extension-driven DOM operations from real user clicks. No extra network requests, no automation fingerprints.

## Architecture

| Aspect | BNBOT | twitter-cli | bb-browser | opencli | chrome-cdp-skill |
|--------|-------|-------------|------------|---------|------------------|
| Type | Chrome Extension + MCP Server | Python CLI | CLI + Extension + Daemon | CLI + Playwright/CDP | CLI (pure CDP) |
| Language | TypeScript | Python | TypeScript | TypeScript | JavaScript |
| Auth method | Browser cookies (automatic) | Cookie extraction from browser | Browser cookies | Browser cookies | Browser cookies |
| AI integration | MCP protocol (Claude/OpenClaw) | CLI output (YAML/JSON) | MCP protocol | CLI output | Skill (Claude Code) |
| Headless/server | No (needs browser) | Yes | No | No | No |
| Install | Chrome Web Store / npm | pip install | npm install | npm install | npx |

## When to Use What

| Use Case | Best Tool |
|----------|-----------|
| Daily Twitter + AI auto-reply | **BNBOT** — built-in auto-reply, sidebar UI |
| AI agent controlling Twitter | **BNBOT CLI** — MCP protocol, 35+ tools |
| Server-side batch operations | **twitter-cli** — headless, full API |
| Multi-platform automation | **bb-browser** — 36 platforms, one tool |
| Quick CLI queries | **opencli** — YAML pipelines, 17 sites |
| One-off browser control | **chrome-cdp-skill** — lightweight, any site |

## BNBOT Tool List (35 tools)

### Engagement (11)
`like_tweet` `unlike_tweet` `retweet` `unretweet` `follow_user` `unfollow_user` `quote_tweet` `delete_tweet` `bookmark_tweet` `unbookmark_tweet` `submit_reply`

### Content Creation (5)
`post_tweet` `post_thread` `open_article_editor` `fill_article_title` `fill_article_body` `upload_article_header_image` `publish_article`

### Data Collection (8)
`scrape_timeline` `scrape_bookmarks` `scrape_search_results` `scrape_current_view` `scrape_thread` `scrape_user_profile` `scrape_user_tweets` `account_analytics`

### Navigation (7)
`navigate_to_tweet` `navigate_to_search` `navigate_to_bookmarks` `navigate_to_notifications` `navigate_to_following` `return_to_timeline` `get_current_page_info`

### External Content (3)
`fetch_wechat_article` `fetch_tiktok_video` `fetch_xiaohongshu_note`

### Status (1)
`get_extension_status`
