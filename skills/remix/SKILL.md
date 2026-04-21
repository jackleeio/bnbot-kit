---
name: remix
version: "0.1.0"
description: "Remix an X tweet — read the original, draft 3 candidate rewrites in the user's voice, let the user pick, post via CDP. Replaces the extension's 二创 feature."
argument-hint: 'remix https://x.com/xxx/status/123, quote-remix this thread'
allowed-tools: Bash, Read, Write, Edit
user-invocable: true
trigger: /remix
---

# /remix — rewrite an X tweet in the user's voice

Take a tweet URL, pull the original content, draft 3 candidate remixes
that match the user's voice, let the user pick/edit, and post. Replaces
the Chrome extension's 二创 (tweetRepost / AI 复写) feature — the
intel moves to Claude, the execution stays as a thin CDP call.

## When to use

- User pastes a tweet URL and says "改写" / "二创" / "remix this"
- User says `/remix <url>` from the desktop chat
- Continuation of `/auto-reply` when a target tweet is better served by
  a standalone remix than a reply

For inline reply-in-thread, use `/auto-reply` style reply. Remix is for
**standalone re-posts** that reuse another tweet's angle.

## Preflight checks

Before any scrape or write:

1. **Extension + daemon online** — `bnbot status`. Extension must be
   "✓ connected". Without it, bail with a clear error.
2. **Voice profile loaded** — `~/.bnbot/skills/bnbot/config/profiles/<handle>.json`.
   Without a profile, abort — generic AI rewrites hurt the account.
3. **Persona rules** — load `~/.claude/skills/bnbot/references/persona.md`
   (anti-AI-tone list: no em-dash, no "what a great take", no hashtags).

## Inputs Claude needs

| Field | Default | Notes |
|---|---|---|
| Tweet URL | — | Required. Accept `x.com/status/...` or `twitter.com/status/...` |
| Mode | `standalone` | `standalone` (fresh post) / `quote` (quote-retweet) |
| Candidates | 3 | How many remix variants to draft |
| Max length | 260 | Leaves room for the quote-RT attribution |
| Niche filter | from profile | Skip if the source tweet is off-niche |

## Core flow

### 1. Scrape the source tweet

```bash
bnbot x scrape thread "<tweet-url>" > /tmp/remix-source.json
```

Parse: `{ text, author, authorFollowers, postedAt, media, engagement }`.
For a thread URL, the first entry is the target tweet; subsequent
entries are the author's follow-ups and can be used for additional
context when choosing an angle.

**Read the WHOLE tweet text.** Don't truncate to preview length — a
remix based on the first 200 chars of a long-form tweet will miss the
punchline. (Same rule as /auto-reply §9.)

### 2. Niche / safety gates (hard, non-negotiable)

Abort the remix and report back if:

- Source tweet text is < 20 chars (not enough substance to remix)
- Source is a pure repost / "this" / "+1" type content
- Off-niche per the voice profile
- Source is from a blocked / muted author
- Contains politics / NSFW / harassment keywords from profile's avoid list

Also refuse if author is the user themselves — remixing your own post
is just re-posting, use compose instead.

### 3. Draft N candidates

For each candidate 1..N, produce a JSON block:

```json
{
  "idx": 1,
  "angle": "reframe as contrarian take",
  "voiceCheckpoint": "matches <profile.style_markers>",
  "text": "<draft ≤ 260 chars>",
  "reason": "why this angle works for this tweet"
}
```

Angles to vary across candidates:

- **Condense** — compress the original's insight into one punchy line.
- **Reframe** — flip the framing (contrarian, first-principles, analogy).
- **Extend** — take the original's claim and push it one step further.
- **Personalize** — tie it to the user's documented niche/experience.
- **Counter** — respectful disagreement backed by a specific point.

Pick 3 angles that best fit THIS tweet. Don't cargo-cult all 5.

**Voice enforcement** (hard rules from persona.md):

- No em-dash (—)
- No "what a great take" / "100%" / "so this" openers
- No hashtags
- No "I'd argue" / "as an AI" / "let me unpack"
- Match the profile's punctuation habits (lowercase vs Title Case, etc.)
- If the profile uses CJK, match the right CJK register (not 书面语 for a 朋友圈式 profile)

### 4. Present to user

Stream candidates one-at-a-time, not a wall of text:

```
📎 Source · @alice · 2h · 142 L / 18 RT / 9 RP
  > "<first 180 chars of source>"

[1/3] Condense
  voice: ✓ lowercase, ✓ no em-dash, 152 chars
  > "<draft 1>"
  reason: distills the "X beats Y" insight into one line

[2/3] Reframe (contrarian)
  voice: ✓ all checks pass, 198 chars
  > "<draft 2>"
  reason: flips the framing — same insight, higher-stakes angle

[3/3] Extend
  voice: ✓ all checks pass, 211 chars
  > "<draft 3>"
  reason: takes it one step further into implications
```

End with: `Pick [1|2|3], [edit N], [redraft], or [skip].`

### 5. Post

For **standalone** mode:

```bash
bnbot x post --engine debugger -- "<picked draft>"
```

With attached media (images / video / gif):

```bash
bnbot x post --engine debugger --media /tmp/remix-media.mp4 -- "<picked draft>"
```

For **quote** mode (attributes the source tweet automatically):

```bash
bnbot x quote --engine debugger -- "<source-url>" "<picked draft>"
```

> **Commander gotcha**: `--media` is variadic (accepts multiple URLs),
> so the text positional argument **must** be separated with `--`.
> Without it, commander swallows the text into `--media`, and you get
> `Error · Exit code 1` with no useful message. Always use `--` before
> the text.

If the source tweet has media you want to remix (image / video):

1. Download from `media[0].url` (photo) or `media[0].variants[0]`
   (video, highest bitrate MP4) into `/tmp/remix-media.<ext>`.
2. Pass it with `--media /tmp/remix-media.<ext>`.
3. Don't `--media` a URL pointing at `video.twimg.com` directly — the
   CDP upload path needs a local file.

After success, `bnbot x post` / `bnbot x quote` prints JSON
`{success: true, tweetId: "...", durationMs: N}`. Echo
`https://x.com/<handle>/status/<tweetId>` back to the user.

**Only write to `remix-seen.json` after confirming `success: true` in
stdout.** If the command timed out or returned `success: false`, don't
pretend it worked — report the raw output honestly. Fake success
poisons the dedup file and leaves the user thinking the retry limit is
exhausted.

### 6. Log

Append to `~/.bnbot/logs/remix-$(date +%Y%m%d).jsonl`:

```jsonl
{"ts":"...","sourceUrl":"...","sourceAuthor":"...","mode":"standalone","picked":2,"candidates":3,"draftedText":"...","postedId":"...","postedUrl":"..."}
```

Also update `~/.bnbot/state/remix-seen.json` so the same source URL
isn't re-remixed within 30 days:

```json
{
  "<source-tweet-id>": {"ts": "...", "remixedAs": "<new-tweet-id>"}
}
```

## Safety rules (hard, don't break)

1. **Never post without explicit user pick** — even in an `--auto` run,
   stop at candidate presentation and wait. Remix is a public-visible
   action; unconditional auto-post = spam risk.
2. **Never remix the user's own tweets** — refuse at step 2.
3. **Never remix a tweet already in `remix-seen.json` within 30d**.
4. **Read full source text** before drafting (no 200-char truncation).
5. **Keep voice rules from persona.md** — one failure = re-draft that
   candidate, don't ship.
6. **Max 5 remixes per 24h** — tweeting remixes looks spammy past that.
7. **If `bnbot x scrape thread` returns empty / no text** (deleted or
   protected tweet), abort. Don't draft from the URL alone.

## Don't do

- Don't remix reply-threads as a standalone — the context is lost and
  the remix reads like out-of-context quoting. Use `mode: quote` instead.
- Don't append "via @original_author" manually — `bnbot x quote`
  already does the attribution. Adding it in `compose` mode looks like
  low-effort stealing.
- Don't remix tweets < 30 min old — feels like fast-follow farming.
  Wait for the original to settle.
- Don't include a link to the source in `standalone` mode unless the
  user explicitly asked — it just dilutes your exposure.

## State files

```
~/.bnbot/state/
└── remix-seen.json             # rolling 30-day dedup by source tweet id

~/.bnbot/logs/
└── remix-YYYYMMDD.jsonl        # full audit trail
```

## Integration with desktop app

The bnbot desktop app's chat pane invokes this skill via `bnbot -p '/remix <url>'`.
When the skill needs a user decision (step 4), it streams candidate
blocks to stdout; the desktop chat UI surfaces those blocks and sends
back the pick. No special UI hooks — plain stdin/stdout chat.
