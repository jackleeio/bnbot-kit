---
name: quote
version: "0.1.0"
description: "Quote-tweet an X tweet — draft a short comment that frames / endorses / challenges the original, post via CDP. Lighter than /remix."
argument-hint: 'quote https://x.com/xxx/status/123, quote this with a snarky take'
allowed-tools: Bash, Read, Write, Edit
user-invocable: true
trigger: /quote
---

# /quote — quote-tweet an X tweet

Draft a short **comment** that goes on top of an embedded quote of the
source. Replaces the extension's 「AI 引用」 button.

## /quote vs /remix — pick the right one

- **`/quote`** — I agree / disagree / have a reaction. The source is
  the point; my comment frames it. Source embedded below my text.
- **`/remix`** — I'm taking the source's insight and expressing it as
  MY OWN post. Can be standalone (no quote embed) or quote-style (with
  embed) depending on how much I want to credit the origin.

Rule of thumb: if the user says "add my take to this" → `/quote`. If
they say "rewrite this as my own tweet" → `/remix`.

## Inputs

| Field | Default | Notes |
|---|---|---|
| Tweet URL | — | Required |
| Candidates | 3 | Different angles |
| Max length | 220 | Leaves room for the embedded quote to render |
| Stance | auto | `endorse` / `challenge` / `reframe` / `extend` |

## Preflight

1. `bnbot status` — extension ✓ connected
2. Voice profile loaded
3. Persona rules from `~/.claude/skills/bnbot/references/persona.md`

## Core flow

### 1. Scrape source

```bash
bnbot x scrape thread "<tweet-url>" > /tmp/quote-source.json
```

Read full text. Parse media[] — if the source has a chart / image, a
good quote often comments on the visual, not just the text.

### 2. Gates

Abort if:

- Source from current user (just RT or reply, don't quote yourself)
- Source is a quote-of-a-quote chain > 2 deep (makes the embed messy)
- Source is protected / deleted
- Already quoted this source in last 30d (`~/.bnbot/state/quote-seen.json`)

### 3. Draft 3 candidates

Different stances:

- **Endorse + extend** — "yes, and here's the implication"
- **Challenge specific point** — disagree with one claim, keep rest
- **Reframe** — same fact, different lens
- **Data/fact add** — add the missing number the source glossed over
- **Observational** — zoom out one level, comment on what the tweet represents

Pick 3 stances that fit THIS source. Don't cargo-cult all 5.

Each candidate ≤ 220 chars. Voice rules apply (no em-dash, no hashtags,
no generic openers).

### 4. Present

```
📎 Source · @alice · 2h · 142 L / 18 RT / 9 RP
  > "<first 180 chars of source>"

[1/3] Endorse + extend
  voice: ✓ lowercase, ✓ no em-dash, 168 chars
  > "<draft>"
  reason: picks up the "X beats Y" line and extends to Z

[2/3] Challenge specific point
  ...

Pick [1|2|3], [edit N], [redraft], or [skip]?
```

### 5. Post

```bash
bnbot x quote --engine debugger -- "<source-url>" "<picked draft>"
```

**Verify the command's stdout before claiming success.** `bnbot x quote`
returns JSON like `{"success": true, "tweetId": "...", "durationMs": N}`
on success, or `{"success": false, ...}` / exit-1 on failure. If
`success` is not `true`:

- Do NOT write to `quote-seen.json`.
- Do NOT tell the user "dedup recorded" or "posted, use timeline scrape
  to verify".
- Report the failure honestly: what the CLI said, what state was not
  updated, and suggest next steps (retry / check logs / confirm
  extension + daemon online).

The `/remix` feedback loop depends on honest failure reporting — faking
success contaminates downstream dedup data.

After a REAL success, return the new tweet URL to the user.

## State & logging

- `~/.bnbot/state/quote-seen.json` — rolling 30-day dedup by source id
- `~/.bnbot/logs/quote-YYYYMMDD.jsonl` — full audit trail

## Safety rules

1. **Never post without user pick** — quotes are public endorsements.
2. **Don't quote own tweets**.
3. **Max 5 quotes per day** — more looks spammy (people see quote-RTs
   in feed).
4. **Read full source** before drafting.
5. **Voice checks** — same persona rules as `/reply` / `/remix`.
6. **If source is promotional / ad / crypto shilling** — refuse,
   quoting gives them free distribution.

## Don't do

- Don't quote RTs (type=retweet) — quoting a pure RT embeds awkward.
- Don't quote tweets where the user is already in the reply tree —
  reply instead, keeps the conversation in one place.
- Don't add hashtags.
- Don't add "via @original" attribution manually — `bnbot x quote`
  does the embed automatically.
- Don't quote the same user twice within 24h — looks like stalking.

## Desktop integration

`bnbot -p '/quote <url>'`. Same streaming + pick pattern as /reply.
