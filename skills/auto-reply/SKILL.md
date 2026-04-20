---
name: auto-reply
version: "0.1.0"
description: "Autonomous X reply loop — scrape recent target-tweets, evaluate, Claude-draft replies in user's voice, post via CDP. Replaces the Chrome extension's autoReplyService."
argument-hint: 'run auto-reply for 30 min, auto-reply to mentions, stop auto-reply'
allowed-tools: Bash, Read, Write, Edit, WebFetch
user-invocable: true
trigger: /auto-reply
---

# /auto-reply — autonomous X engagement loop

Periodically scrape a feed (timeline / mentions / a target user's tweets),
pick high-value tweets to engage with, draft replies in the user's voice,
and post via CDP. This skill replaces the Chrome extension's
`autoReplyService` (1542 LOC) — the intel moves to Claude, the execution
stays as a thin CDP call.

## Inputs Claude needs to gather

Before starting, ask the user (or use defaults from saved profile):

| Field | Default | Notes |
|---|---|---|
| Source feed | `mentions` | `mentions` (notifications tab), `timeline`, or `@username` |
| Duration | 30 min | How long to run the loop |
| Reply cadence | 1 / 90–180s | Jitter around this to look human |
| Max replies | 10 | Stop early once hit |
| Voice | loaded profile | `<skill-path>/config/profiles/<handle>.json` from /bnbot |
| Topics to avoid | — | Keywords Claude should skip (politics, NSFW, etc.) |

Save the session config to `~/.bnbot/state/auto-reply-session.json` so
`/auto-reply status` can read it.

## Loop structure

Outer loop (duration-bound):

1. **Scrape** recent tweets from the source:
   - `mentions`: `bnbot x scrape mentions --limit 20`
   - `timeline`: `bnbot x scrape timeline --limit 20`
   - `@user`: `bnbot x scrape user --handle <user> --limit 20`
2. **Dedup** against `~/.bnbot/state/auto-reply-seen.json` (rolling 7-day
   set of tweet_ids we've already reviewed).
3. For each fresh tweet (limit to top 3–5 per cycle):
   - **Evaluate** via Claude. Output: `{ action: 'reply' | 'skip' | 'like', reason, draft? }`
   - Evaluation rubric:
     - `skip` if: too short, another bot-like tweet, promotional, out of user's niche, already replied to this user recently, spam-signaling language
     - `like` if: low-effort engagement (show support), or borderline reply candidates
     - `reply` if: substantive + on-topic + would genuinely interest the user
   - **Draft** the reply in the user's voice (load
     `<skill-path>/references/persona.md` from the `/bnbot` skill for
     anti-AI-tone rules).
   - **Post** via CDP:
     ```bash
     bnbot x reply --engine debugger "<tweet-url>" "<draft>"
     ```
     Or `bnbot x like --engine debugger "<tweet-url>"` for the like path.
4. **Log** the decision + result to
   `~/.bnbot/logs/auto-reply-$(date +%Y%m%d).jsonl`:
   ```jsonl
   {"ts":"...","tweetId":"...","author":"...","action":"reply","draft":"...","posted":true,"replyId":"..."}
   ```
5. **Sleep** for jittered cadence: `bash -c 'sleep $((RANDOM % 90 + 90))'`
6. Update `auto-reply-seen.json` with the processed tweet_id.
7. Loop until duration expires or max_replies hit.

## State files

```
~/.bnbot/state/
├── auto-reply-session.json    # current session config + running flag
├── auto-reply-seen.json       # { tweetId: {ts, action} } rolling 7-day dedup
└── auto-reply-rate.json       # per-user cooldown: don't reply to same user twice within 6h

~/.bnbot/logs/
└── auto-reply-YYYYMMDD.jsonl  # structured per-action log
```

## Safety rules (hard-coded, don't break)

1. **Never reply to own tweets** — filter by authorHandle.
2. **Never reply to same user twice within 6 hours** — check rate file.
3. **Max 10 replies per 24h** — check log count before posting.
4. **Skip tweets older than 4 hours** — feed moves fast; stale replies look bot-ish.
5. **Skip tweets with < 5 likes** from accounts with < 500 followers — avoid
   replying into dead conversations that make us look like a spam bot.
6. **Always jitter the cadence** — `90 + RANDOM % 90` seconds minimum.
7. **Stop immediately on repeated CDP errors** (3 in a row) — extension
   may be dead. Surface a notification and bail.

## Running the loop

### One-shot (run for N minutes now)

```
/auto-reply 跑 30 分钟
```

Claude:
1. Writes session config
2. Enters the loop, looping until 30 min elapsed or 10 replies hit
3. Reports final summary

Note: the conversation window must stay open for the full 30 min.
Use `/loop` with short intervals to free up the window between
iterations — but that's noisier than just holding the session open.

### Scheduled (run every day at 9–11am)

```
/auto-reply 每天早上 9 点到 11 点自动回复
```

Use `/schedule` to create a launchd entry that fires at 9am and runs:

```bash
cd ~/Projects/bnbot && bun run src/entrypoints/cli.tsx -p \
  "/auto-reply 跑 2 小时，源=mentions" \
  --model=sonnet
```

The `-p` invocation spawns a fresh bnbot session with the auto-reply
prompt baked in. When the 2-hour run ends, that session exits cleanly.
This is the pattern for "self-driving" engagement on a schedule.

## Stopping / pausing

```
/auto-reply stop
```

Write `stopped: true` into `auto-reply-session.json`. The loop checks
this flag every iteration and exits gracefully.

## Status / history

```
/auto-reply status    # read session.json + tail log
/auto-reply history   # summarize last 7 days from logs/
```

Format:
```
📊 Auto-reply · last 7 days
  mon 2 replies · 3 likes · 8 skips
  tue 4 replies · 1 like  · 12 skips
  ...
  engagement rate: 18% reply / 24% like / 58% skip
```

## Evaluation prompt (use when scoring a tweet)

```
Given this tweet and the user's voice profile, decide whether to reply.

Tweet:
  author: @<handle>  (followers: <N>, verified: <bool>)
  text: """<text>"""
  engagement: <likes>L / <retweets>RT / <replies>RP
  posted: <relative time>

User voice profile: <summary>
User's do-not-reply topics: <list>

Recent replies (last 6h to this user): <bool>

Decide:
  action: reply | like | skip
  reason: 1 sentence
  draft:  if action=reply, write the draft (≤ 240 chars, matches voice,
          no AI-tone words from persona.md, no em-dash, no "I'd argue",
          no "what a great take", etc.)
```

## Don't do

- Don't reply with generic affirmations ("great point!", "100% agree").
  If Claude can't say something substantive, skip.
- Don't include hashtags in replies — looks bot-ish on X.
- Don't reply to tweets that are already 2+ hours old unless they're
  genuinely evergreen content.
- Don't run without a loaded voice profile — loud generic-AI replies
  hurt the account's reputation.
- Don't bypass the 6h per-user cooldown — feels like harassment.
