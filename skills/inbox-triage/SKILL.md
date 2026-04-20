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

If that CLI verb doesn't exist yet, fall back to the debugger inspect
path we built — navigate the pooled tab to `https://x.com/notifications`
and read the DOM. (TODO: add `scrape notifications` to bnbot-cli if
missing — check with `bnbot x scrape --help`.)

### 2. Classify each notification

Parse each notification into one of:

| Type | Identifying signals | Suggested action |
|---|---|---|
| `mention` | "@you" in body, quoted reply | **reply** (Claude drafts) |
| `reply_to_my_tweet` | someone replied under user's post | reply if substantive, else like |
| `like` | "liked your post" | skip (no action) |
| `retweet` | "reposted your post" | skip (or like-back if relationship) |
| `follow` | "followed you" | follow back if mutual-niche, else skip |
| `quote_tweet` | "quoted your post" | reply if substantive |
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

### 5. Mark processed

Write seen notifications to `~/.bnbot/state/inbox-seen.json`:
```json
{
  "notificationId": {"ts": "...", "type": "mention", "action": "reply"}
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

## Scheduling

Pair with `/schedule` for daily automation:

```
/schedule 每天 9 点自动清通知
```

Claude registers a launchd plist running:

```bash
cd ~/Projects/bnbot && bun run src/entrypoints/cli.tsx -p \
  "/inbox-triage — 清今天的通知，常规决策可以批量处理；模糊的留给我看" \
  --model=sonnet
```

Without `--model=sonnet` this may pick whatever the default is; Sonnet
is a good balance of judgment quality + cost for this loop.

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
