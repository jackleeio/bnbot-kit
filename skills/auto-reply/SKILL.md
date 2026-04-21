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

1. **Scrape** recent items from the source:
   - `notifications` (best for reactive engagement): `bnbot x scrape notifications --limit 40`
     Returns mixed types — filter to `type ∈ {mention, reply, quote}` for
     reply candidates, optionally also `like` with `targetTweet` if you
     want to like-back. Skip `follow`, `new_post`, `other`.
   - `following` (best for proactive engagement on your circle): `bnbot x scrape timeline --type=following --limit 20`
     Chronological feed of accounts you follow — what they JUST posted,
     not algorithmic For-You. Best signal for "real things happening in
     my circle right now". Use this to find tweets worth like / reply.
   - `for-you`: `bnbot x scrape timeline --limit 20` (algorithmic)
   - `@user`: `bnbot x scrape user-tweets <handle> --limit 20`

   Combined strategy (recommended for full inbox + circle coverage):
   first run `notifications` (must-handle items), then `following`
   (opportunistic engagement), dedupe by tweet id.
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
3. **Max 30 replies per 24h** — check log count before posting. Hard
   ceiling based on what X tolerates for active organic-growth accounts
   without triggering shadowban heuristics. Can lower per session for
   new accounts (<500 followers: 10/day).
4. **Max 5 replies per 30min session** — don't drain the daily cap in
   one sitting.
5. **Skip tweets older than 4 hours** — feed moves fast; stale replies
   look bot-ish. Use `createdAt` field in scrape output.
6. **Skip tweets with < 5 likes** from accounts with < 500 followers —
   avoid replying into dead conversations that make us look like spam.
   Use `authorFollowers` + `likes` fields.
7. **Always jitter the cadence** — 90–180s between posts, random.
8. **Stop on CDP errors ≥3 in a row** — extension may be dead.
9. **MUST read the FULL targetTweet.text before drafting a reply.**
   Never draft from a truncated preview (`text[:200]`, summary cards,
   timeline list view). X long-form notes can be 4000 chars; the
   author's real point is often in the second half. Print the full text
   verbatim, summarize the 3 key points yourself, *then* draft. Past
   incident: drafted a Celsius/AAVE comparison after only seeing first
   200 chars, missed the author's own "10/10 vs this" framing and the
   "bot 几秒抢光 25万 USDC" detail that was the real punchline.

## Traffic / growth strategy layer (on top of safety)

Auto-pilot mode is primarily for **traffic and lead-gen via reply
exposure on viral tweets**. The scoring layer below decides which
candidates are worth engaging.

### Exposure score formula (Claude applies inline on scrape data)

Each candidate has: `likes, retweets, replies, views, createdAt,
authorFollowers, isBlue`. Compute a 0–100 score before drafting:

```
# 1. Tweet age (hours since posted)
ageHours = (now - createdAt) / 3600

# 2. Timing — fresher = more reach
if ageHours < 1:     timingScore = 40    # golden window
elif ageHours < 3:   timingScore = 25    # good
elif ageHours < 12:  timingScore = 10    # late
else:                timingScore = 0     # dead, skip

# 3. Engagement velocity (L/hr + RT×10/hr + reply×5/hr)
velocity = (likes + retweets*10 + replies*5) / max(ageHours, 0.25)
velocityScore = min(30, log10(velocity + 1) * 15)

# 4. Author reach
if authorFollowers > 100_000: authorScore = 30    # mega — but Claude
                                                   # should consider the
                                                   # rank penalty (many
                                                   # replies, yours buried)
elif authorFollowers > 10_000: authorScore = 20
elif authorFollowers > 1_000:  authorScore = 12
elif authorFollowers > 200:    authorScore = 5
else:                          authorScore = 0    # dead-end

# 5. Blue penalty (non-blue reply = -50% reach)
blueMultiplier = 1.0 if userIsBlue else 0.5

# 6. Reply density penalty (if replies > 100, your reply drowns)
if replies < 5:        rankBonus = 1.0
elif replies < 20:     rankBonus = 0.8
elif replies < 100:    rankBonus = 0.5
else:                  rankBonus = 0.2

totalScore = (timingScore + velocityScore + authorScore) * blueMultiplier * rankBonus
```

**Decision thresholds**:
- score ≥ 50 → `reply` (substantive draft)
- 30 ≤ score < 50 → `like` only (engagement breadcrumb)
- score < 30 → `skip` (not worth the quota)

### Niche lock (use profile.domains)

Load `<skill-path>/config/profiles/<handle>.json`. If `profile.domains`
is set, reject any tweet whose text doesn't contain at least one domain
keyword. For personal accounts with empty domains, Claude infers niche
from `profile.sampleTweets` style / topic.

### Diversity

- Same author ≤ 1 reply / 24h (harder than the 6h cooldown)
- Same general topic (by keyword cluster) ≤ 2 replies / 24h — don't
  look like an issue-campaigner

### Like vs reply mix (anti-bot signature)

For candidates that pass the score threshold, roll dice:
- **60% `like` only** (cheap, supportive)
- **40% `reply`** (substantive draft via the normal flow)

A real person doesn't reply to everything they like. Pure reply-only
history patterns shadowban faster.

## Running the loop

Three modes:

### A. Interactive (user reviews each draft)

```
/auto-reply 跑 5 分钟，源=following，最多 2 条回复
```

Claude scrapes, evaluates, drafts, then **asks user to approve each
reply** before posting. Use for first-time testing and high-stakes
accounts. Session window must stay open for the full duration.

### B. Auto-pilot (hands-off, no approval)

```
/auto-reply --auto --source=following --duration=30m --max=3
```

Claude runs the full loop headless. For each candidate:

1. scrape once at session start (50 tweets)
2. filter by safety + niche
3. score each via the formula above
4. pick top scoring, read FULL text
5. if score ≥ 50: draft → post reply (no approval)
6. if 30 ≤ score < 50: post like only
7. sleep 90–180s jitter
8. repeat until duration or max hit

Session auto-exits when done. State persists across sessions via
`~/.bnbot/state/auto-reply-*.json`.

**Auto mode skips user approval but applies ALL safety + strategy
rules strictly.** If profile voice isn't loaded → abort immediately.

### C. Scheduled auto-pilot (the flagship use case)

Launch via `/schedule` — macOS launchd fires a headless bnbot session
at each engagement window, running the `--auto` flow:

```
/schedule 每天 9:00 / 13:30 / 19:30 跑 auto-reply 30 分钟，源=following，最多 3 条
```

`/schedule` generates three launchd plists. Each fires at its time
with prompt body:

```bash
cd ~/Projects/bnbot && $BNBOT_ROOT/dist/cli.js -p \
  "/auto-reply --auto --source=following --duration=30m --max=3" \
  --model=sonnet
```

Three sessions × max 3 replies = **up to 9 replies per day**, well
under the 30/day hard cap. Add sessions (noon / 22:00) to scale up to
~20/day if the account tolerates it.

Dedup (`seen.json`) and rate (`rate.json`) state persists across
sessions — no risk of double-replying or hammering one user.

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
