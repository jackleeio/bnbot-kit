# BNBot

AI-powered growth agent for X/Twitter. Create tweets, schedule posts, auto-reply, and scrape trends from 30+ platforms — all driven by your AI agent.

## Quick Start

```bash
npx @bnbot/cli setup
```

Works with [Claude Code](https://claude.ai/code), [Codex](https://codex.openai.com), [Gemini CLI](https://gemini.google.com), and any MCP-compatible agent.

## What's Inside

| Package | Description |
|---------|-------------|
| [extension/](./extension) | Chrome extension — AI sidebar for X/Twitter |
| [cli/](./cli) | `@bnbot/cli` — draft management, scheduling, bridge to extension |
| [skill/](./skill) | Claude Code skill — AI agent prompts and workflows |
| [web/](./web) | [bnbot.ai](https://bnbot.ai) — landing page and draft previews |

## Features

**AI Content Creation**
- Generate tweets, threads, and articles with AI
- Cross-platform repost: TikTok, YouTube, WeChat, Xiaohongshu, and more
- Image generation with DALL-E / Flux

**Scheduling & Publishing**
- `bnbot draft add "your tweet" --auto` — create and auto-schedule
- Calendar view with mobile preview at bnbot.ai/s/
- chrome.alarms auto-publish at scheduled times

**Smart Engagement**
- Auto-reply to timeline tweets with AI-generated responses
- Notification handler for mentions and replies
- X Boost — reward-based engagement campaigns

**30+ Platform Scraping**
- Scrape trends from Twitter, TikTok, Reddit, YouTube, Bilibili, Zhihu, and more
- Works via extension (browser login) or CLI (public APIs)

## Architecture

```
CLI (entry)                Backend (storage)           Extension (execution)
bnbot draft add "text" →  POST /api/v1/drafts    →   WebSocket bridge sync
bnbot draft schedule   →  PUT /drafts/{id}/schedule → chrome.alarms.create()
                                                      → auto-publish at time
                                                      → failure → notification

bnbot.ai/s/:shareKey   ←  GET /api/v1/public/schedule/:shareKey
```

## Development

```bash
# Extension
cd extension && npm install && npm run dev

# CLI
cd cli && npm install && npm run build

# Web
cd web && npm install && npm run dev
```

## Links

- [Chrome Extension](https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln)
- [Website](https://bnbot.ai)
- [Skill](https://bnbot.ai/skill.md)

## License

MIT
