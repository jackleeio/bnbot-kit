---
name: inbox-triage
version: "0.1.0"
description: "Read X notifications inbox, classify mentions / likes / follows / replies, batch-decide actions. Replaces the extension's notificationActions."
argument-hint: 'triage inbox, show pending mentions, batch follow-back'
allowed-tools: Bash, Read, Write, Edit
user-invocable: true
trigger: /inbox-triage
---

# /inbox-triage — X notifications inbox triage

Read X's notifications tab, classify every new item, then decide a batch
of actions (reply, like, follow back, skip). Replaces the extension's
`notificationActions` handler.

Unlike `/auto-reply` which crawls a **feed** proactively, this skill
consumes the **inbox** reactively — things that happened TO the user
that may need a response.

## When to use

- User asks "有什么新通知" / "what's in my inbox"
- Daily "清通知" routine (run once a day, handle backlog)
- After being away from X for a while

Pairs well with `/schedule` for recurring triage (e.g. every morning at
9am).

## Core flow

### 1. Scrape notifications

```bash
bnbot x scrape notifications --limit 50 > /tmp/inbox-raw.json
```

The CLI returns a JSON array of items, each pre-classified by the
extension's GraphQL scraper into one of these `type` values.

### 2. Classify each notification

Each item already has `type`, `fromUsers`, `targetTweet`, `text`, `ts`.
Map type → action:

| `type` | Meaning | Default action |
|---|---|---|
| `mention` | someone @-mentioned user in a new post | **reply** (Claude drafts) |
| `reply` | someone replied to user's post | reply if substantive, else like |
| `quote` | someone quote-tweeted user's post | reply if substantive |
| `like` | someone liked user's post | skip (FYI only) |
| `retweet` | someone reposted user's post | skip (or like-back if relationship) |
| `follow` | someone followed user | follow back if niche-aligned, else skip |
| `new_post` | accounts user follows posted (single or aggregated) | **score & evaluate** — see §"new_post engagement" below |
| `other` | unclassified | skip |

### 2b. new_post engagement (in-line with `/auto-reply`)

A `new_post` notification is X telling you "an account you follow just
posted RIGHT NOW". This is high-value:

- highest freshness window (minutes after posting → reply rank 1-3)
- pre-curated by X (only accounts you follow, often big V's)
- best traffic-leverage moment per the rank-share curve

So `/inbox-triage` SHOULD evaluate these for reply / quote / like /
skip — same scoring + persona fit + endorsement gates as
`/auto-reply`. Don't drop them just because they came via the
notifications endpoint.

**Evaluation steps for each new_post item with a `targetTweet`:**

1. Compute exposure-prediction scores using the same formula as
   `/auto-reply` (`reply_expected_views`, `quote_expected_views`)
2. Compute `persona_fit` using profile.domains + sampleTweets cluster
3. Apply the same final decision rule:
   - quote if core-niche + EV high + daily quota left
   - reply if EV ≥ 5,000 + fit ∈ {core-niche, adjacent}
   - like if core-niche + Claude endorses the take + daily quota left
   - else skip
4. **Aggregated new_post entries** (those without a single
   targetTweet — X grouped multiple users like "qinbafrank 和另外 8
   人的新帖子通知"): skip in this cycle, defer to
   `/auto-reply --source=following` for those (because we don't have
   the actual tweet text to score).

For new_post items, present drafts for approval the same way as
mentions/replies — show the parent tweet, the predicted exposure, and
the proposed action.

### Daily caps shared with `/auto-reply`

The same global state (`~/.bnbot/state/auto-reply-rate.json`,
`~/.bnbot/state/auto-reply-seen.json`, daily quota counters) applies.
A reply done via `/inbox-triage` counts against the same 30/day cap
as `/auto-reply`. Don't double-engage the same author across the two
skills within the 6h cooldown.
| `mention_in_reply_chain` | user was @'d in a thread | reply if relevant |

Output a table first for user approval:

```
📬 Inbox · 23 items
  5 mentions   → 3 draft replies ready, 2 skip
  4 replies    → 2 reply, 2 like
  8 likes      → skip (no action)
  3 retweets   → skip
  2 follows    → 1 follow back, 1 skip (account too new)
  1 quote      → 1 reply draft ready
```

### 3. Present drafts for user approval

For each action that creates content, show the draft with tweet context:

```
[1/6] @alice replied to your post about X:
  > "interesting take but have you considered Y?"

  Your draft reply:
  > "good point on Y — the trade-off is Z though"

  [approve] [edit] [skip]
```

User confirms batch or individual items.

### 4. Execute approved actions

```bash
# Reply
bnbot x reply --engine debugger "<tweet-url>" "<draft>"

# Like
bnbot x like --engine debugger "<tweet-url>"

# Follow back
bnbot x follow --engine debugger "<handle>"
```

Jitter between actions (30–60s sleep) to avoid rate-limit triggers.

### 5. Mark processed (ALWAYS — even if 0 actions)

Even if NO replies / likes / follows are executed this cycle, the
agent MUST still:

1. Update `~/.bnbot/state/inbox-seen.json` with EVERY scraped item's
   id (action='skip' for the no-op ones). Without this, the next run
   re-evaluates the same 37 like/follow notifications and burns model
   tokens repeating the analysis.
2. Update `~/.bnbot/state/inbox-lastrun.json` with `{lastRun, counts}`.
3. Write a session markdown report to
   `~/.bnbot/logs/inbox-session-<YYYYMMDD-HHMM>.md` — same format as
   `/auto-reply`'s session report (summary table + per-item decision +
   any drafts posted). User must be able to audit no-op runs as
   readily as active ones.

```json
// inbox-seen.json
{
  "notificationId": {"ts": "...", "type": "mention", "action": "reply"},
  "anotherId":      {"ts": "...", "type": "like",    "action": "skip"}
}
```

Keep a rolling 30-day window — anything older pruned on next run so the
file doesn't grow forever.

## Follow-back heuristic

When deciding whether to follow a new follower:

- **Follow back if** their bio matches user's niche AND they have ≥50
  followers AND their most recent 3 tweets look human (not reply spam).
- **Skip if**: obvious bot (egg avatar, numbers in handle, no tweets),
  irrelevant niche, or OF/crypto spam.
- **Ask user if**: ambiguous — maybe a real person but outside niche.

Load user's niche from the voice profile: `<skill-path>/config/profiles/<handle>.json`
→ `niche: [...]`.

## Safety rules

1. **Never auto-follow** without user approval on ambiguous cases.
2. **Batch actions** — ask user to confirm the whole batch before firing.
3. **Rate-limit protection**: max 10 follow-backs per day, max 15 replies
   per day (same as `/auto-reply`).
4. **Skip bot-looking accounts** silently — don't even show them.
5. **Don't reply to "likes" or "retweets"** — they're FYI, not
   conversational.

## State files

```
~/.bnbot/state/
├── inbox-seen.json              # rolling 30d set of handled notification_ids
├── inbox-lastrun.json           # { lastRun: "...", counts: {...} }
└── inbox-pending.json           # drafts awaiting user approval (if interrupted)

~/.bnbot/logs/
└── inbox-YYYYMMDD.jsonl         # full audit trail
```

## Auto-monitoring (15-min poller)

Persistent background polling for high-freshness reply opportunities.
A launchd agent (`com.bnbot.inbox-tick`) wakes every N minutes, scrapes
notifications via WS daemon (cheap, no Claude), and ONLY spawns a
headless `bnbot -p '/inbox-triage --auto'` session when fresh actionable
items (mention / reply / quote / new_post) appear.

### Lifecycle commands (Claude maps user intent → these)

| User says | Command |
|---|---|
| "开始自动监听 inbox" / "auto-monitor on" | `bnbot inbox install && bnbot inbox start` |
| "停一下自动监听" / "pause" | `bnbot inbox stop` (plist preserved, restart with start) |
| "彻底卸了" / "uninstall" | `bnbot inbox uninstall` |
| "看看在不在跑" / "status" | `bnbot inbox status` |
| "改成 5 分钟一次" | `bnbot inbox stop && bnbot inbox install --interval=300 && bnbot inbox start` |

Default interval is **15 min** (900s). Conservative — catches most
reply rank 1-3 opportunities while looking like a real person checking
notifications, not a polling bot. Tighten with `--interval` if user
wants more aggressive freshness chasing.

### Why install + start are separate

`install` writes the plist with `RunAtLoad=false` — agent is configured
but doesn't run. User has to explicitly say "start it" before any
auto-engagement happens. Prevents accidental "I just wanted to install
it to test" → 30 replies/day going out.

### What the tick does

```
tick wakes (every interval seconds)
  ↓
WS scrape notifications (200ms, no Claude)
  ↓
dedupe vs ~/.bnbot/state/inbox-seen.json
  ↓
for non-actionable fresh items (like/follow/retweet/other):
  mark seen with action=skip, write
  ↓
if 0 fresh actionable items: exit (cheap path, no spawn)
  ↓
else: spawn detached `bnbot -p '/inbox-triage --auto' --model=sonnet`
       which loads this skill, applies EV + persona-fit + endorsement
       gates, posts via CDP, writes session report
  ↓
tick exits (the spawned bnbot session runs to completion independently)
```

### Manual one-shot

User explicitly invoking `/inbox-triage` in their REPL still works the
same as before — interactive mode with draft approval. The tick is for
hands-off background polling; the skill itself stays interactive by
default.

## Don't do

- Don't handle mentions silently without showing draft. User's tone
  matters — surface it.
- Don't follow back en masse — X may flag it as bot behavior.
- Don't reply to your own notifications about your own posts — filter
  by author_handle == user.
- Don't drain the inbox in one shot — process ≤15 items per run, leave
  the rest for next cycle.
- Don't bypass `~/.bnbot/state/inbox-seen.json` dedup — same notif
  may reappear if X re-inserts.
