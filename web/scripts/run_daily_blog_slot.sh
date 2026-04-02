#!/usr/bin/env bash
set -euo pipefail

TOPIC="${1:-ai}"
REPO="/home/jacklee/.openclaw/workspace/bnbot-frontend"
DEVTO_API_KEY="${DEVTO_API_KEY:-sJyKEJKNMFrUCjftAiDtoxe2}"
LOG_DIR="$REPO/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/daily-blog-${TOPIC}.log"

{
  echo "[$(date -u +'%F %T UTC')] start topic=$TOPIC"
  cd "$REPO"

  # 1) Collect signals (Twitter fixed feed + proactive search + community search + GitHub)
  python3 scripts/collect_signals.py \
    --twitter-endpoint "https://api.bnbot.ai/api/v1/ai/kol-recent-data" \
    --twitter-search-endpoint "https://twitter-api47.p.rapidapi.com/v3/search" \
    --twitter-search-provider "rapidapi-twitter47" \
    --twitter-search-queries "AI agents,web3 infra,indie hacker,solopreneur SaaS,global growth,出海" \
    --twitter-community-search-endpoint "https://twitter-api47.p.rapidapi.com/v3/community/search" \
    --twitter-community-queries "AI,Web3,indie hacker,solopreneur,出海,openclaw" \
    --out data/daily-signals.json

  # 2) Generate one topic article for this slot
  python3 scripts/generate_topic_posts.py \
    --signals data/daily-signals.json \
    --date "$(date -u +%F)" \
    --topics "$TOPIC"

  # 3) Deploy to production
  vercel --prod --yes

  # 4) Publish to Dev.to (direct publish) if key exists
  TODAY="$(date -u +%F)"
  YEAR="$(date -u +%Y)"
  MONTH="$(date -u +%m)"
  POST_PATH="src/content/blog/${YEAR}/${MONTH}/${TOPIC}-${TODAY}.md"

  if [[ -n "${DEVTO_API_KEY:-}" && -f "$POST_PATH" ]]; then
    python3 scripts/publish_to_devto.py --input "$POST_PATH" --site-url "https://bnbot.ai" --published
  else
    echo "[$(date -u +'%F %T UTC')] skip dev.to publish (missing DEVTO_API_KEY or post file)"
  fi

  echo "[$(date -u +'%F %T UTC')] done topic=$TOPIC"
} >> "$LOG_FILE" 2>&1
