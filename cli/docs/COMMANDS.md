# BNBot CLI Command Reference

## Overview

```
bnbot <command> [subcommand] [args] [options]
```

BNBot CLI communicates with the BNBot Chrome Extension via WebSocket to control Twitter/X. Public data scrapers work standalone without the extension.

## Setup & Authentication

| Command | Description |
|---------|-------------|
| `bnbot setup` | Install CLI globally + Claude Code skill |
| `bnbot login` | Login (auto-detects clawmoney API key) |
| `bnbot login --email you@example.com` | Login via email verification |
| `bnbot serve` | Start WebSocket server |
| `bnbot serve --port 18901` | Start on custom port |
| `bnbot status` | Check extension connection |

## X Platform Commands

All X commands require the Chrome extension to be connected (`bnbot serve` running + extension open on Twitter).

### Post & Compose

```bash
# Post a tweet
bnbot x post "Hello from BNBot!"

# Post with media (local file or URL)
bnbot x post "Check this out" -m ./photo.png
bnbot x post "Look" -m https://example.com/image.jpg

# Multiple media (auto-splits into thread if >4)
bnbot x post "Gallery" -m img1.png -m img2.png -m img3.png

# Draft mode (fill composer without posting)
bnbot x post "Draft tweet" -d

# Post a thread (JSON array)
bnbot x thread '[{"text":"First tweet"},{"text":"Second tweet"}]'

# Close composer
bnbot x close
bnbot x close --save  # Save as draft
```

### Engage

```bash
# Reply to a tweet
bnbot x reply https://x.com/user/status/123 "Great post!"
bnbot x reply https://x.com/user/status/123 "With media" -m photo.jpg

# Quote tweet
bnbot x quote https://x.com/user/status/123 "My thoughts on this"

# Like / Unlike
bnbot x like https://x.com/user/status/123
bnbot x unlike https://x.com/user/status/123

# Retweet / Unretweet
bnbot x retweet https://x.com/user/status/123
bnbot x unretweet https://x.com/user/status/123

# Follow / Unfollow
bnbot x follow elonmusk
bnbot x unfollow elonmusk

# Delete a tweet
bnbot x delete https://x.com/user/status/123

# Bookmark / Unbookmark
bnbot x bookmark https://x.com/user/status/123
bnbot x unbookmark https://x.com/user/status/123
```

### Scrape

```bash
# Scrape home timeline
bnbot x scrape timeline
bnbot x scrape timeline -l 50

# Scrape bookmarks
bnbot x scrape bookmarks
bnbot x scrape bookmarks -l 10

# Search and scrape
bnbot x scrape search "AI agents"
bnbot x scrape search "AI agents" -t latest -l 50
bnbot x scrape search "AI" --from elonmusk --since 2025-01-01 --until 2025-12-31
bnbot x scrape search "AI" --lang en --minLikes 100 --has images

# Scrape user tweets
bnbot x scrape user-tweets elonmusk
bnbot x scrape user-tweets elonmusk -l 50

# Scrape user profile
bnbot x scrape user-profile elonmusk

# Scrape a thread
bnbot x scrape thread https://x.com/user/status/123
```

**Search options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --tab <tab>` | Search tab: `top`, `latest`, `people`, `media` | `top` |
| `-l, --limit <n>` | Max results | `20` |
| `--from <username>` | Filter by author | |
| `--since <date>` | Start date (YYYY-MM-DD) | |
| `--until <date>` | End date (YYYY-MM-DD) | |
| `--lang <code>` | Language filter (`en`, `zh`, etc.) | |
| `--minLikes <n>` | Minimum likes | |
| `--minRetweets <n>` | Minimum retweets | |
| `--has <type>` | Media filter: `images`, `videos`, `links` | |

### Analytics

```bash
bnbot x analytics
```

### Navigate

```bash
# Navigate to a URL
bnbot x navigate https://x.com/elonmusk/status/123

# Navigate to search
bnbot x navigate search "AI agents"

# Navigate to bookmarks
bnbot x navigate bookmarks

# Navigate to notifications
bnbot x navigate notifications
```

## Public Data Scrapers

These commands fetch data directly from public APIs. No Chrome extension or WebSocket server needed.

### Hacker News

```bash
bnbot hackernews search "AI agents"
bnbot hackernews search "LLM" -l 10
bnbot hackernews search "startup" --sort date
```

### Stack Overflow

```bash
bnbot stackoverflow search "react hooks"
bnbot stackoverflow search "typescript generics" -l 5
```

### Wikipedia

```bash
bnbot wikipedia search "artificial intelligence"
bnbot wikipedia search "ChatGPT" --lang zh
```

### Apple Podcasts

```bash
bnbot apple-podcasts search "tech news"
```

### Substack

```bash
bnbot substack search "AI newsletter"
```

### V2EX

```bash
bnbot v2ex hot
```

### Bloomberg

```bash
bnbot bloomberg news
bnbot bloomberg news -l 10
```

### BBC

```bash
bnbot bbc news
bnbot bbc news -l 10
```

### Sina Finance

```bash
bnbot sinafinance news
bnbot sinafinance news --type 1 -l 10
```

### Sina Blog

```bash
bnbot sinablog search "AI"
```

### Xiaoyuzhou FM

```bash
bnbot xiaoyuzhou podcast 6021f949ee2c6723b18a13b4
```

## Content Fetching (via Extension)

These commands require the Chrome extension.

```bash
# WeChat article
bnbot weixin article https://mp.weixin.qq.com/s/xxx

# TikTok video
bnbot tiktok fetch https://www.tiktok.com/@user/video/xxx

# Xiaohongshu note
bnbot xiaohongshu fetch https://www.xiaohongshu.com/explore/xxx
```

## Backward Compatibility

Legacy kebab-case commands from previous versions still work:

```bash
# These are equivalent:
bnbot post-tweet --text "Hello"    # legacy
bnbot x post "Hello"               # new

bnbot scrape-timeline --limit 10   # legacy
bnbot x scrape timeline -l 10      # new

bnbot like-tweet --tweetUrl <url>  # legacy
bnbot x like <url>                 # new

bnbot search-hackernews --query "AI"  # legacy
bnbot hackernews search "AI"          # new
```

## Architecture

```
bnbot serve                    ← Start WebSocket server on ws://localhost:18900
    ↑
bnbot x post "Hello"           ← CLI client connects, sends action, exits
    ↓
Chrome Extension (BNBot)       ← Executes action in browser, returns result
    ↓
Twitter / X                    ← DOM manipulation / API calls
```

- `bnbot serve` starts a persistent WebSocket server
- CLI commands (`bnbot x ...`) connect as transient clients
- The Chrome extension connects to the server and executes actions
- Public scrapers (`bnbot hackernews ...`) bypass WebSocket entirely
