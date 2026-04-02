# BNBot Monorepo

AI-powered growth agent for X/Twitter.

## Structure

| Directory | Description | Tech |
|-----------|-------------|------|
| `extension/` | Chrome 扩展 — sidebar, auto-reply, boost, scraper | React, Vite, Chrome MV3 |
| `cli/` | `@bnbot/cli` npm 包 — draft management, bridge | TypeScript, Commander |
| `skill/` | `/bnbot` Claude Code skill — AI agent prompts | Markdown |
| `web/` | bnbot.ai 官网 — landing page, preview pages | Next.js |

## Related Projects (external)

| Project | Path | Description |
|---------|------|-------------|
| Backend API | `/Users/jacklee/Projects/bnbot-api` | FastAPI, LangGraph |
| OpenCLI source | `/Users/jacklee/Projects/opencli-source` | Upstream scraper reference |

## Quick Commands

```bash
# Extension
cd extension && npm install && npm run dev    # Dev server (port 3030)
cd extension && npm run build                 # Production build

# CLI
cd cli && npm install && npm run build        # Build CLI

# Web
cd web && npm install && npm run dev          # Dev server (port 3000)

# Skill
cat skill/SKILL.md                            # View skill prompt
```

## Key Patterns

- **Extension ↔ CLI bridge**: WebSocket on localhost:18900
- **Draft system**: CLI creates drafts → backend stores → extension publishes via chrome.alarms
- **Device key**: Anonymous auth via `~/.bnbot/device.key`, synced to extension via bridge
- **API**: Extension proxies all API calls through background.ts (`API_REQUEST` message type)
- **AutoPilot tasks**: Fully local (chrome.storage.local), no backend dependency
