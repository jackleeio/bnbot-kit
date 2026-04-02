# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

@bnbot/cli — CLI for BNBot. Subcommand format: `bnbot <platform> <action>`.

Published as `@bnbot/cli` on npm. Binary names: `bnbot`, `bnbot-cli` (both point to `dist/index.js`).

## Build & Dev

```bash
npm run build          # tsc → dist/
npm run dev            # tsx src/index.ts (no build needed)
npm version patch      # bump version
npm publish            # publish to npm (runs build via prepublishOnly)
```

No test suite or linter configured.

### Release

```bash
npm version patch      # or minor/major
npm publish            # auto-runs build via prepublishOnly
git add -A && git commit -m "chore: bump to vX.Y.Z"
git push
```

Then update global install: `npm i -g @bnbot/cli --ignore-scripts`

Note: `postinstall` script downloads Claude skill from bnbot.ai/skill.md. Use `--ignore-scripts` if network is unavailable.

## Architecture

Two execution paths based on whether a platform needs browser authentication:

```
Browser scrapers (X, TikTok, YouTube, Instagram, etc.):
  CLI → WebSocket (ws://localhost:18900) → Chrome Extension → chrome.scripting → platform DOM

Public scrapers (HackerNews, Wikipedia, StackOverflow, BBC, etc.):
  CLI → direct HTTP fetch (no extension needed)
```

### Key Modules

- **`src/index.ts`** — Entry point. Builds the commander program with all subcommands. Also handles legacy kebab-case routing (`bnbot post-tweet --text "Hi"`) for backward compat.
- **`src/wsServer.ts`** — `BnbotWsServer` class. WebSocket server on port 18900 that bridges CLI ↔ Chrome Extension. Handles request-response matching via `requestId`, auto-retry on busy, auth token relay.
- **`src/cli.ts`** — `runCliTool` / `runCliAction` functions. CLI client that connects to the WS server, sends an action, waits for result. The `TOOL_MAP` maps kebab-case CLI names to snake_case WS action types.
- **`src/publicScrapers.ts`** — `PUBLIC_SCRAPERS` map. All direct-fetch scrapers (no extension). Uses `undici` ProxyAgent to respect `http_proxy`/`https_proxy` env vars.
- **`src/commands/actions.ts`** — Commander action handlers for X platform (post, reply, like, scrape, navigate). Maps commander args → `runCliAction` calls.
- **`src/commands/scraperActions.ts`** — Commander action handlers for browser-based platform scrapers (TikTok, YouTube, Reddit, etc.). Each sends a `SCRAPER_*` action type via WebSocket.
- **`src/tools/mediaUtils.ts`** — Media file resolution utility (local files → data URLs, URL downloads). Used by post/reply commands for `--media` option.
- **`src/auth.ts`** — Login flow. Tries clawmoney API key from `~/.clawmoney/config.yaml`, falls back to email OTP via `api.bnbot.ai`.
- **`src/setup.ts`** — `bnbot setup` command. Installs CLI globally + downloads Claude Code skill from `bnbot.ai/skill.md` to `~/.claude/commands/bnbot.md`.

### Adding a New Platform

**Public scraper (no auth needed):** Add a function to `PUBLIC_SCRAPERS` map in `src/publicScrapers.ts`, then add commander subcommands in `src/index.ts`.

**Browser scraper (needs extension):** Add action handler in `src/commands/scraperActions.ts` using the `scrape()` helper with a `SCRAPER_*` action type, then add commander subcommands in `src/index.ts`. The actual scraping logic lives in the Chrome Extension repo.

## Related Projects

| Project | Path | Description |
|---------|------|-------------|
| CLI (this) | `/Users/jacklee/Projects/bnbot-cli` | @bnbot/cli npm package |
| Extension | `/Users/jacklee/Projects/bnbot-extension` | Chrome extension (browser scrapers) |
| Skill | `/Users/jacklee/Projects/bnbot` | /bnbot Claude Code skill |
| Frontend | `/Users/jacklee/Projects/bnbot-frontend` | bnbot.ai website |
| OpenCLI source | `/Users/jacklee/Projects/opencli-source` | opencli upstream reference |

## OpenCLI Sync

Every 3 weeks, diff against opencli upstream for API changes and new platforms. Sync log at `/Users/jacklee/Projects/bnbot-extension/docs/OPENCLI_SYNC_LOG.md`.
