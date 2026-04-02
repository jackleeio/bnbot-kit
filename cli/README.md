# @bnbot/cli

**BNBot (Brand & Bot)** — AI-powered personal branding toolkit for X. Discover trends from 30+ platforms, create content with AI, and automate your growth.

## Quick Start

```bash
npx @bnbot/cli setup
```

This installs the CLI globally and sets up the Claude Code skill (`/bnbot`).

Then install the [BNBot Chrome Extension](https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln) for browser automation.

## Architecture

```
Terminal
    -> bnbot x post "Hello!"
    | WebSocket (ws://localhost:18900)
BNBot Chrome Extension
    | chrome.scripting / DOM / Internal APIs
X + 30 platforms (TikTok, YouTube, Reddit, Bilibili, etc.)
```

## Commands

### Setup & Status

```bash
bnbot setup                     # Install CLI + Claude skill
bnbot serve                     # Start WebSocket server
bnbot login                     # Login to BNBot
bnbot status                    # Check extension connection
```

### X Platform — Tweet & Engage

```bash
bnbot x post "Hello!"                          # Post a tweet
bnbot x post "Look" -m ./photo.png             # Post with media
bnbot x post "Draft" -d                        # Draft mode
bnbot x thread '[{"text":"1"},{"text":"2"}]'   # Post a thread
bnbot x reply <url> "Great post!"              # Reply to a tweet
bnbot x quote <url> "My thoughts"              # Quote tweet
bnbot x like <url>                             # Like a tweet
bnbot x unlike <url>                           # Unlike
bnbot x retweet <url>                          # Retweet
bnbot x unretweet <url>                        # Unretweet
bnbot x follow elonmusk                        # Follow a user
bnbot x unfollow elonmusk                      # Unfollow
bnbot x delete <url>                           # Delete a tweet
bnbot x bookmark <url>                         # Bookmark
bnbot x unbookmark <url>                       # Unbookmark
bnbot x close                                  # Close composer
```

### X Platform — Scrape

```bash
bnbot x scrape timeline                        # Scrape home timeline
bnbot x scrape timeline -l 50                  # With limit
bnbot x scrape bookmarks                       # Scrape bookmarks
bnbot x scrape search "AI agents"              # Search tweets
bnbot x scrape search "AI" -t latest -l 50     # Latest tab, 50 results
bnbot x scrape search "AI" --from user --since 2025-01-01
bnbot x scrape user-tweets elonmusk            # User's tweets
bnbot x scrape user-profile elonmusk           # User profile
bnbot x scrape thread <url>                    # Scrape a thread
bnbot x analytics                              # Account analytics
```

### X Platform — Navigate

```bash
bnbot x navigate <url>                         # Navigate to URL
bnbot x navigate search "AI agents"            # Go to search
bnbot x navigate bookmarks                     # Go to bookmarks
bnbot x navigate notifications                 # Go to notifications
```

### Public Data Scrapers (no extension needed)

```bash
bnbot hackernews search "AI agents" -l 20      # Hacker News
bnbot stackoverflow search "react hooks"       # Stack Overflow
bnbot wikipedia search "ChatGPT" --lang zh     # Wikipedia
bnbot apple-podcasts search "tech"             # Apple Podcasts
bnbot substack search "AI newsletter"          # Substack
bnbot v2ex hot                                 # V2EX hot topics
bnbot bloomberg news                           # Bloomberg
bnbot bbc news                                 # BBC
bnbot sinafinance news --type 1                # Sina Finance 7x24
bnbot sinablog search "AI"                     # Sina Blog
bnbot xiaoyuzhou podcast <id>                  # Xiaoyuzhou FM
```

### Content Fetching (via extension)

```bash
bnbot weixin article <url>                     # WeChat article
bnbot tiktok fetch <url>                       # TikTok video
bnbot xiaohongshu fetch <url>                  # Xiaohongshu note
```

### Backward Compatibility

Legacy kebab-case commands still work:

```bash
bnbot post-tweet --text "Hello"                # -> bnbot x post "Hello"
bnbot scrape-timeline --limit 10               # -> bnbot x scrape timeline -l 10
bnbot search-hackernews --query "AI"           # -> bnbot hackernews search "AI"
```

## Login

```bash
# Auto-login via clawmoney API key
bnbot login

# Or via email
bnbot login --email you@example.com
```

## Full Command Reference

See [docs/COMMANDS.md](docs/COMMANDS.md) for the complete command reference with all options.

## Links

- [BNBot Chrome Extension](https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln)
- [BNBot Website](https://bnbot.ai)
- Twitter: [@BNBOT_AI](https://x.com/BNBOT_AI)

## License

MIT
