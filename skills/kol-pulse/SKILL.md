---
name: kol-pulse
version: "0.1.0"
description: "What crypto / AI KOLs are talking about right now. Pulls recent tweets from curated bnbot-api KOL lists (crypto, AI) and produces a thematic briefing — top themes + emerging topics, each grounded in verbatim KOL quotes. PROACTIVELY use when the user asks 'what are KOLs discussing', 'crypto KOL 在聊什么', 'AI 圈最近什么趋势', '今天 KOL 在讨论什么', '看看 crypto/AI 趋势', 'crypto trends today', 'AI trends today', 'KOL pulse', or any variation. Argument: 'crypto' / 'ai' / omit for both. Replaces the extension's 趋势 panel."
argument-hint: 'kol-pulse, kol-pulse crypto, kol-pulse ai'
allowed-tools: Bash, Read, Write
user-invocable: true
trigger: /kol-pulse
---

# /kol-pulse — what KOLs are discussing

Pull the most recent tweets from a curated KOL list (crypto + AI) via
`bnbot-api`, cluster into 3-5 themes per category, and emit a tight
briefing the user can scan in 30 seconds.

## When to use

- "今天 crypto KOL 在讨论什么" → `/kol-pulse crypto`
- "AI 圈最近什么新趋势" → `/kol-pulse ai`
- "看看 KOL 都在聊啥" (没指定) → `/kol-pulse` (default: both)

## When NOT to use

- "我自己关注的人发了什么" — that's the timeline, not the KOL list.
  Use `bnbot x scrape timeline` instead.
- "X 平台热搜" — that's `FetchTrends` (Twitter trends panel), not this.

## Inputs

| Arg | Default | Notes |
|---|---|---|
| Type | both | `crypto` / `ai` / (omit = run both, in that order) |

## Preflight

1. `bnbot status` — extension connected
2. User logged into bnbot — KOL endpoint requires auth tokens stored
   in the extension. If 401, tell user to run `bnbot login`.

## Core flow

### 1. Fetch raw KOL tweets

```bash
# single category
bnbot kol pulse crypto > /tmp/kol-crypto.json

# both categories — run sequentially, don't parallelize (extension's
# scrape worker is single-flight)
bnbot kol pulse crypto > /tmp/kol-crypto.json
bnbot kol pulse ai > /tmp/kol-ai.json
```

The action result wraps a `data` array of tweet objects:

```ts
{
  data: [
    {
      id_str, text, text_en?, text_zh?, created_at,
      reply_count, retweet_count, like_count, view_count,
      user: { username, name, is_blue_verified },
      is_retweet, is_quote,
      retweeted_tweet?: { text, text_en?, text_zh?, username },
      quoted_tweet?: ...recursive
    }
  ],
  total_tweets
}
```

### 2. Read and cluster

For each category:

1. Filter out pure retweets (`is_retweet === true` with no original
   commentary) — they'd double-count signal. Keep quote-tweets, the
   commentary on the quote is the signal.
2. For non-English text, prefer `text_en` if present; else translate
   the gist mentally without quoting verbatim.
3. Cluster into **3-5 themes**. A theme requires at least 2 distinct
   KOLs touched on it. One-offs are noise unless their `view_count`
   is exceptional (>500K).
4. Rank themes by:
   - Number of KOLs covering it (more = stronger signal)
   - Total `view_count` across the cluster
   - Engagement-to-view ratio (replies + likes / views) — high ratio
     means it's actually moving the needle, not just impressions

### 3. Pick representative tweets per theme

For each theme, cite **2-3 tweets**. Selection criteria:

- Different KOLs (don't cite @alice three times for the same theme)
- The most quotable line — short, specific, original take
- Highest `view_count` if otherwise tied

### 4. Emerging topics

After top themes, scan the long tail for tweets that:
- Have unusually high engagement-to-view ratio (early signal)
- Use vocabulary that didn't appear in the top themes
- Are from KOLs known for early calls (you can't tell this from data
  alone, so use cluster size of 1-2 + high engagement as the proxy)

Pick **2-3** emerging topics, one line each.

## Output format

Single-category mode:

```markdown
# KOL Pulse · {Crypto | AI} · {YYYY-MM-DD}
> {N} tweets from {M} KOLs · pulled {HH:MM}

## 🔥 Top themes

### 1. {Theme name — short noun phrase, not a sentence}
- @{handle} — "{verbatim one-line quote}" ({views} views)
- @{handle} — "{verbatim one-line quote}"
- @{handle} — "{verbatim one-line quote}"

### 2. ...

## 🌱 What's emerging
- {one-line take} — @{handle}
- {one-line take} — @{handle}
```

Both-category mode: prefix with two H1 sections (`# Crypto` / `# AI`),
each containing its own top themes + emerging.

## Voice rules

- **Quote verbatim.** Don't paraphrase the KOL's words inside the
  quote marks. If the original is too long, ellipsize at a sentence
  boundary and add "...".
- **Author handles literal.** `@vitalik` not "Vitalik Buterin".
- **Stay neutral.** No "this is bullish/bearish", no "exciting times",
  no "interesting development". Theme names are descriptive, not
  editorial.
- **No filler.** Skip "in summary", "the situation is", "it's worth
  noting that". The structure already conveys hierarchy.
- **No emojis inside themes.** The 🔥 / 🌱 section markers are fine
  (they navigate the doc); don't sprinkle others throughout.

## Scheduling — pair with /schedule

This skill is well-suited to a daily cron:

```
/schedule "0 9 * * *" /kol-pulse
```

The output writes to chat — you can revisit / search / quote tweets
into a `/remix` or `/quote` follow-up the same morning.

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `Unknown action: kol_pulse` | Extension not reloaded after upgrade | Reload at `chrome://extensions` |
| `HTTP 401` in stderr | Auth tokens expired | `bnbot login` |
| Empty `data: []` | API returned no tweets — KOL list may be empty for that category | Try the other category, or report upstream |
| `extension_busy` | Another scrape running | Wait 5s and retry |
