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

1. `bnbot status` — extension ✓ connected. **Skip when source data is
   already in the prompt** (see step 1 below) — that flow guarantees
   the extension was just connected and responsive seconds ago.
2. Voice profile loaded
3. Persona rules from `~/.claude/skills/bnbot/references/persona.md`

## Core flow

### 1. Get source (read prompt OR scrape)

**Decide first — don't scrape blindly.** Check whether the caller has
already attached the source in the prompt:

- If the prompt contains a `<source>...</source>` block (or any
  structured payload with `tweet_url`, `text`, `author_handle`,
  `media`, etc.) **plus** a `<viewer>...</viewer>` block, that's the
  share-menu / desktop UI entry path: the extension already captured
  everything. **Read those fields directly. Do NOT call
  `bnbot x scrape thread` or `bnbot x status` — it wastes a tool turn
  and may even re-fetch stale data.**
- If the caller only gave you a tweet URL with no inline payload (e.g.
  CLI invocation, dry chat command), then scrape:

  ```bash
  bnbot x scrape thread "<tweet-url>" > /tmp/quote-source.json
  ```

Either way, before drafting: confirm you have full text + author
handle + media list. If a chart / image is present, a good quote often
comments on the visual, not just the text.

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

Output the three candidates as `bnbot_tweet_draft` JSON cards so the
desktop preview can render each one with the original tweet embedded
below the comment. **Every card must carry the `quote` field with the
full source tweet data** — text, author, avatar, URL, media — pulled
verbatim from step 1's scrape. Without `quote` the UI shows a bare
comment with no context.

For each candidate, emit a fenced JSON block:

````
```json
{
  "type": "bnbot_tweet_draft",
  "text": "<my short comment, ≤220 chars>",
  "media": [],
  "quote": {
    "type": "bnbot_source_tweet",
    "text": "<full source tweet text>",
    "authorName": "<source author display name>",
    "authorHandle": "<source author handle, no leading @>",
    "authorAvatar": "<source avatar URL if scraped>",
    "tweetUrl": "<canonical https://x.com/.../status/... URL>",
    "media": [
      { "type": "photo|video|gif", "url": "<media URL>", "thumbnail": "<optional poster>", "alt": "<optional>" }
    ]
  }
}
```
````

Rules:

- `text` only carries MY commentary — never paste the source body into
  it, the embed shows the original below.
- **`quote.tweetUrl` is mandatory** — must be the canonical
  `https://x.com/<handle>/status/<id>` URL. `bnbot x quote` and the
  desktop publish path both fail with "missing tweetUrl" without it.
  Use the URL the user passed in / the one returned by
  `bnbot x scrape thread`. Never empty, never a placeholder.
- **`quote.text` and `quote.authorHandle` are mandatory** — original
  tweet body verbatim, handle without leading `@`. If the scraper
  returns `author: "unknown"`, extract the handle from the source URL
  path instead; never leave "unknown".
- `quote.media` carries the source's media (charts, screenshots, video
  preview). Skip when source has none; do not invent.
- All three candidates share the same `quote` object — only `text`
  differs across stances.
- After the three JSON blocks, append a one-line summary:
  `Pick [1|2|3], [edit N], [redraft], or [skip]?`

Per-candidate voice annotation (lowercase / em-dash / char count) stays
out of the JSON — it goes in a short prose line **above** each fence,
not inside the payload.

### 5. Post (or stage)

If the user picks a candidate and says publish / send / 发出去:

```bash
bnbot x quote --engine debugger -- "<source-url>" "<picked draft>"
```

If the user says 先写入计划 / 加入草稿 / 不要发, call `SaveDraftToPlan`
with the picked candidate **including its `quote` object** (the
desktop card reads it back from the markdown frontmatter):

```
SaveDraftToPlan({
  project: "<slug>",
  platform: "twitter",
  status: "scheduled",  // or "draft" if user said 草稿
  time: "<HH:MM>",
  title: "<short title>",
  body: "<picked text — only my commentary, no source body>",
  source: "<source tweet URL>",
  quote: {
    text: "<source tweet text>",
    authorName: "...",
    authorHandle: "...",
    authorAvatar: "...",
    tweetUrl: "...",
    media: [...]
  }
})
```

Do NOT inline the source tweet into `body` — `quote` is the structured
field the desktop UI reads to render the embedded original.

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
