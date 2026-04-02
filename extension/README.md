# BNBot Chrome Extension

AI-powered sidebar for X/Twitter. Injects into Twitter's UI via Shadow DOM, providing AI chat, auto-reply, tweet scheduling, content boosting, and 30+ platform scraping.

## Install

[Chrome Web Store](https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln)

## Development

```bash
npm install
npm run dev          # Dev server with HMR (port 3030)
npm run build        # Production build to dist/
```

Load `dist/` as an unpacked extension in `chrome://extensions`.

## Key Features

- **AI Chat** — Chat with BNBot agent, tool calling support
- **Auto Reply** — Automated timeline replies with AI
- **Schedule** — Calendar view, draft preview, chrome.alarms auto-publish
- **Boost** — Reward-based engagement campaigns
- **Scraper** — 30+ platform data scraping via browser login context
- **Analysis** — Tweet and account analytics

## Architecture

- **Chrome MV3** manifest with service worker
- **Shadow DOM** isolation to prevent CSS conflicts with Twitter
- **Background.ts** — OAuth, API proxy, WebSocket bridge, alarm scheduler
- **Content Script** — React app injected into Twitter pages
