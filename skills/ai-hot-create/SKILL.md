---
name: ai-hot-create
version: "0.1.0"
description: "Research-first content creation from an AI Hot feed item — multi-source web search, synthesize, draft 2-3 angles, wait for user pick, only publish when user explicitly says 发/publish."
argument-hint: 'ai-hot-create with source material below'
allowed-tools: WebSearch, WebFetch, Bash, Read, Write
user-invocable: true
trigger: /ai-hot-create
---

# /ai-hot-create — turn an AI dynamics item into a publishable draft

Triggered from the desktop's AI 动态 panel `✨ 创作` button. The user
hands you a single feed item (title / source / URL / summary / reason)
and expects you to **research broadly, draft thoughtfully, and never
publish without explicit consent**.

## When to use

- User clicks `✨ 创作` on an AI 动态 card → desktop sends
  `/ai-hot-create` plus the source material.
- User says "based on this AI item, write a tweet…" with a feed item.

For arbitrary URLs or non-feed sources, use `/remix` instead — that
skill is tuned for direct rewrite of a single tweet, not editorial
synthesis from multiple sources.

## Hard rules

1. **Never call a posting tool** (`bnbot x post`, `bnbot xhs note`,
   `bnbot wxmp`, etc.) until the user literally says one of:
   `发` / `发出去` / `publish` / `post it` / `发推` / `ship it`.
   Until then output is plain text only.
2. **No em-dashes** in any draft. Use commas, periods, or "..."
   for breaks. Em-dash and "——" are AI tone signals.
3. **Voice profile** — load `~/.bnbot/skills/bnbot/config/profiles/<handle>.json`
   if a default profile exists. Without a profile, ask the user once
   which voice to draft in (their X handle), don't guess.

## Workflow

### 1. Research (3-4 web searches, different angles)

Don't write anything yet. Search broadly to ground the draft in what
actually happened and how others are framing it.

Suggested angles (run at least one query per angle that applies):

- **Mainstream coverage** — `WebSearch <subject> <recent date>`
  (e.g. "庄钩堂 离职 xAI 2026", "xAI Juntang Zhuang leaving").
- **Reactions on X** — `WebSearch site:x.com <handle> <subject>` or
  use `bnbot x scrape user <handle>` if the user is already in our
  KOL list. Get the principals and at least one non-principal commentator.
- **Historical analogues** — `WebSearch "<event class>" 2024 OR 2025`
  to find how similar events played out (e.g. "OpenAI cofounder
  exodus 2023" if the topic is xAI exits).
- **Industry / KOL takes** — `WebSearch <subject> opinion analysis`
  filtered to credible analysts (SemiAnalysis, swyx, Gary Marcus,
  Nathan Lambert, 宝玉, 歸藏, etc.).

Cap at ~5 searches total. If you have enough signal earlier, stop.

### 2. Synthesize (research note, 200-400 chars)

Output a short markdown block titled `## Research notes`, with:

- **Key facts** — 3-5 bullets, each with the URL it came from.
- **Surprising angles** — 2-3 bullets capturing the non-obvious takes
  you found (contrarian POV, historical pattern, missed implication).

Keep it under 400 chars total. The user is going to skim this to pick
a direction.

### 3. Drafts (2-3 angles)

Propose 2-3 distinct angles, one short draft per angle.

Format each angle as:

```
### 角度 N: <one-line label>
<draft text>
```

Defaults:

- **X (Twitter) single tweet** — ≤280 characters. Mandarin or English
  matching the user's profile language.
- **X thread** — only if the angle genuinely needs more than 280 chars.
  Cap at 4 tweets. Number them `1/`, `2/`, etc.
- Skip the headline link unless it's the news hook itself; users
  embed media via `bnbot` later.

Voice rules (also baked into bnbot persona):

- No em-dash, no "——", no "重磅 / 炸裂 / 必看 / 干货".
- No leading "I think" / "我觉得" hedges. Lead with the claim.
- Numbers, names, concrete details > generic adjectives.
- If the user's voice profile defines specific lexicon / style, honor it.

### 4. Wait for the user

After the draft block, end with a single line:

> 选哪个角度？或者你想我换思路再写。

Do NOT proceed to publishing on your own. Do NOT auto-pick.

### 5. Final version + publish (only after explicit "发")

When the user picks ("第二个" / "angle 2" / "go with the historical
one"), polish that draft into a final version. Show the final
version, then ask one more time:

> 这版可以发了吗？(说"发"/"publish" 我就调 bnbot 发出去)

When the user replies "发" / "publish" / equivalent, call:

```bash
bnbot x post "<final tweet text>"
# or for a thread:
bnbot x post "<tweet 1>" --thread "<tweet 2>" "<tweet 3>"
```

Show the bnbot response (post URL or error). On error, surface the
error and stop. Don't retry without confirmation.

## Platform switching

If the user says "小红书" / "xhs" anywhere in the conversation, switch
the draft format to a Xiaohongshu note:

- **Hook title** ≤ 20 chars with one emoji.
- **Body** 200-400 chars, broken into short paragraphs (one idea each)
  separated by blank lines.
- **Tags** 4-6 hashtags relevant to the niche.
- Tone: like sharing with a friend, not a lecture.

Publishing for XHS goes through `bnbot xhs note` instead of
`bnbot x post`. Same explicit-consent rule.

## Don't

- Don't run `bnbot x post` "as a test" or "to draft" — there is no
  draft mode for posting from this skill.
- Don't dump the raw research as the tweet. The research is for *you*
  to ground the draft; the user wants the synthesis, not the bibliography.
- Don't include URLs in the tweet body unless the URL IS the news
  (e.g. a paper link). Most cases: cite by name in the prose.
- Don't reuse the AI Hot summary as the tweet — that's editorial
  shorthand, not a tweet. Write a fresh tweet that earns the angle.
