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

## Preflight checks (run at session start)

Before any scrape or write:

1. **Extension + daemon online** — `bnbot status` (NOT `curl :18900`;
   that port is pure WebSocket, doesn't respond to HTTP). Output should
   show "Server ✓" AND "Extension ✓ connected". If extension isn't
   connected, tell the user to load the Chrome extension, don't retry.

2. **Voice profile loaded** — preferred path
   `~/.bnbot/skills/bnbot/config/profiles/<handle>.json` (symlink to
   bnbot-kit/skill/config/profiles/). If no profile matches the current
   user, ABORT — auto mode without a voice profile produces generic
   AI slop that hurts the account.

3. **State directories exist** — `mkdir -p ~/.bnbot/state
   ~/.bnbot/logs`.

If any of these fails, abort with a clear error and do NOT proceed to
scrape. Don't burn the rate limit on broken plumbing.

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

### Expected-exposure formula (Claude applies inline on scrape data)

**Output is an ABSOLUTE predicted-view number for YOUR reply**, not a
0–100 relative score. Thresholds cut on impressions because that's the
actual traffic-farming metric. Formula ported from the extension's
`exposurePredictionService.ts` v1.1.

Each candidate has: `likes, retweets, replies, views, createdAt,
authorFollowers, isBlue`. Your own profile: `userFollowers`, `userIsBlue`.

```python
# ============ 0. Hard filters — skip before scoring ============
# a) Reply-in-thread: text starts with @handle — someone else's sub-reply,
#    tiny standalone reach.
if text.lstrip().startswith('@'): return SKIP

# b) Dead-on-arrival: 0 engagement after 15min grace → author's own
#    audience isn't engaging, ours won't either.
ageHours = (now - createdAt) / 3600
if ageHours > 0.25 and (likes + retweets + replies) == 0: return SKIP

# c) Tiny penetration (< 0.1% of author followers seeing it) after 30min
#    → tweet is getting algorithmically suppressed.
if ageHours > 0.5 and views < authorFollowers * 0.001: return SKIP

# ============ 1. Half-life decay (bigger accounts peak later) ============
if   authorFollowers > 500_000: halfLife = 4.0   # hrs
elif authorFollowers > 50_000:  halfLife = 2.5
elif authorFollowers > 5_000:   halfLife = 1.5
else:                            halfLife = 1.0

decay = 0.5 ** (ageHours / halfLife)   # future reach multiplier

# ============ 2. Projected parent total views ============
# Linear extrapolation + decay for remaining future.
observedVps = views / max(ageHours, 0.1)   # current views per hour
futureViews = observedVps * halfLife * decay * 2   # rough remaining
projectedParent = views + futureViews

# ============ 3. Predicted rank of YOUR reply ============
# Rank score: how far up the visible ladder your reply lands.
rankScore = 0
rankScore += min(0.15, log10(userFollowers + 1) / 20)
if userIsBlue: rankScore += 0.25
if replies < 5:    rankScore += 0.30
elif replies < 20: rankScore += 0.18
elif replies < 50: rankScore += 0.10
else:              rankScore += 0.03
rankScore = min(0.8, rankScore)

predictedRank = max(1, ceil(replies * (1 - rankScore)) + 1)

# ============ 4. Rank → share of parent views (X's actual curve) ============
def rankShare(r):
    if r <= 0: r = 1
    if r <= 3:   return [0.25, 0.18, 0.12][r-1]           # gold
    if r <= 10:  return 0.08 * (0.75 ** (r - 4))          # silver
    if r <= 30:  return 0.02 * (0.80 ** (r - 10))         # bronze
    return 0.005                                           # folded

# ============ 5. Expected views on YOUR reply ============
# Non-blue users take a -50% reach hit per X's own policy.
blueMult = 1.0 if userIsBlue else 0.5
expectedViews = projectedParent * rankShare(predictedRank) * blueMult
```

### Action set — 4 choices, not 3

Three exposure surfaces, each with a different reach profile. Always
pick the action with the highest **expected views** that also passes
the content quality gate.

| Action | Where it shows up | Reach source |
|---|---|---|
| `quote` | **Your** timeline + For-You algorithm picks | `userFollowers × engagement_rate × quote_boost` |
| `reply` | Inside parent's thread | `parentViews × rankShare(predictedRank)` |
| `like` | Nowhere visible, algo signal only | ≈ 0 direct, indirect ranking boost |
| `skip` | — | — |

### Expected views — per action

`reply_expected_views` — from the formula above.

`quote_expected_views`:
```python
# Your timeline reach on a quote tweet.
# Baseline: ~25% of your followers see an organic post (X's average).
# Quote tweets with substantive commentary get a mild algorithmic boost
# because X rewards remix content. Boost is small (~1.15x) and dies
# for quotes with empty or one-liner commentary.
baseReach = userFollowers * 0.25
quoteBoost = 1.15 if substantive_commentary_planned else 0.85
# Parent-content-quality multiplier: interesting source content gets
# more organic re-engagement on your quote.
parentQualityMult = (1 + log10(parentLikes + 1) / 4) * (1 if ageHours < 12 else 0.5)
quote_expected_views = baseReach * quoteBoost * parentQualityMult
```

### Persona fit gate — runs BEFORE the EV thresholds

EV tells you the traffic potential. **Persona fit** tells you whether
engaging damages or builds the brand. Both must pass.

Load `<skill-path>/config/profiles/<handle>.json`. Extract:
- `domains`: explicit niche keywords (array; empty = infer from samples)
- `sampleTweets`: ground-truth topic distribution
- `avoid`: keywords that must never appear in candidate tweets

**Fit check** — output: `core-niche` / `adjacent` / `off-topic` / `avoid`:

```
# Hard reject: avoid keyword present
if any(kw in tweet.text for kw in profile.avoid): return 'avoid'

# Tier 1 — core niche: matches profile.domains OR
# matches topic cluster of 30%+ of sampleTweets
if match_domain_keywords(tweet.text, profile.domains) or
   topic_cluster_match(tweet.text, sampleTweets) >= 0.3:
    return 'core-niche'

# Tier 2 — adjacent: one-hop related (matches 10-30% cluster)
if topic_cluster_match(tweet.text, sampleTweets) >= 0.1:
    return 'adjacent'

# Tier 3 — off-topic
return 'off-topic'
```

**Fit × action gate** — tight rule for quotes, relaxed for replies:

| Fit | quote | reply | like | skip |
|---|---|---|---|---|
| `core-niche` | ✅ ok | ✅ ok | ✅ ok | — |
| `adjacent` | ❌ NO (brand dilution) | ✅ ok if EV high | ✅ ok | — |
| `off-topic` | ❌ NO | ❌ NO (looks spam-bot) | ⚠️ only if low cadence | ✅ |
| `avoid` | ❌ NO | ❌ NO | ❌ NO | ✅ always |

Rationale: quote goes on YOUR timeline, so your followers see it. One
off-niche quote = "why did Jack tweet about a vulture bird?" — loses
cred. Reply is forgivable because it's inside someone else's thread —
tangential is fine as long as the substance is real.

### Final decision rule

```
fit = persona_fit(tweet)
agrees = does_user_endorse_this_take(tweet)   # Claude's judgment: "would
                                                # the user, given their voice
                                                # profile + domain, nod at this?"

if fit == 'avoid':       return SKIP
if fit == 'off-topic':   return SKIP           # don't like, don't anything

# Quote — strictest gate
if fit == 'core-niche' and \
   quote_expected_views > reply_expected_views and \
   quote_expected_views >= 2000 and \
   quote_daily_quota_remaining > 0:
    return QUOTE

# Reply — moderate gate
if reply_expected_views >= 5000 and fit in ('core-niche', 'adjacent'):
    return REPLY

# Like — endorsement-gated, NOT EV-gated
# "I'm web3, you said something I agree with on web3 → I like."
if fit == 'core-niche' and agrees and like_daily_quota_remaining > 0:
    return LIKE

return SKIP
```

### Why likes are endorsement-gated, not EV-gated

Likes bring near-zero direct traffic. Their value is:
- signalling "I'm in this conversation" to the author + algorithm
- building a positive breadcrumb trail with on-niche creators

That only pays off if the like is a **true endorsement** of an
on-niche tweet. Random likes = bot behaviour. Scope to:

1. `fit == 'core-niche'` — squarely in your domain
2. Claude judges "the user would agree with this take" — i.e. the
   content matches the user's known stance (inferred from sampleTweets
   + profile.bio + profile.tone)
3. Keep a small daily budget so the likes stay meaningful

| Daily caps |  |
|---|---|
| reply | ≤ 30 |
| quote | ≤ 1 |
| like | ≤ 10 — small, only for on-niche tweets you endorse |
| total writes | ≤ 40 |

If the candidate is on-niche but you'd actually disagree / be neutral
→ skip the like. Don't thumb-up what you'd shake your head at.

### When to QUOTE instead of reply (content rules)

Quote is strictly better when **ALL** of these hold:

1. **Source content is standalone-shareable** — makes sense to someone
   seeing it on your timeline without the thread context
2. **You have something to add** — contrast, extend, counter, personal
   anecdote, data angle. Pure "+1 / good point" = don't quote, just like.
3. **Topically relevant to your audience** — matches profile.domains or
   inferred niche from sampleTweets
4. **Reply would be buried** — predictedRank > 10 (your reply drowns)
5. **Evergreen-ish** — not pure breaking news where an RT would do

If any of those fail → reply / like / skip instead.

### Quote draft rules

Quote commentary lives on YOUR timeline — held to the SAME voice
profile as your original tweets. NOT a reply-style short comment.

- Matches user's `style.maxTweetLength` (trim accordingly)
- Follows `persona.md` + profile `styleReference` (e.g. for jackleeio:
  mimic @KKaWSB — 冷静叙事, 数字锚定, 零感叹)
- Adds YOUR take — don't paraphrase the quoted tweet
- Can extend, contrast, or personal-anecdote, not summarize

### Thresholds per account size

| User followers | reply ≥ | quote ≥ |
|---|---|---|
| < 500 (new) | 1,500 views | 500 views |
| 500 – 5,000 | 5,000 views | 2,000 views |
| 5,000 – 50,000 | 10,000 views | 5,000 views |
| > 50,000 | 20,000 views | 15,000 views |

Bigger accounts shouldn't quote trivial content — the placement cost is
higher (your timeline slot), so only high-value source material qualifies.

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

### Reply drafts must match the voice profile

EVERY reply draft — not just quotes — follows the same voice rules as
the user's original tweets. If `profile.styleReference.accounts` is
set (e.g. jackleeio mimics @KKaWSB), apply that style to the reply:

- **Language**: strict to `profile.language` (e.g. jackleeio = zh;
  never mix EN words/sentences into a zh reply)
- **Tone**: per `styleReference.analysis.tone` (e.g. 冷静叙事型，不煽情)
- **Sentence patterns**: per `styleReference.analysis.sentencePatterns`
  (e.g. 数字锚定；短句断句；反转/留白结尾；零废话)
- **Forbidden fillers**: "值得一提的是" / "不得不说" / "让我们" / "what a
  great take" / "I'd argue" / em-dash flourishes
- **Emoji**: `emojiLevel: 'minimal'` → ≤ 1 emoji, and only if the
  voice profile uses them; usually skip entirely
- **Hashtags**: never in replies (`hashtagMax: 1` applies to posts,
  replies = 0)

Reply length: shorter than posts (typically ≤ 140 chars), but keep
the voice. A 3-line reply with one concrete fact + one short take
reads more like the user than a 240-char paragraph.

For accounts with `styleReference.blendMode: 'mimic'` — it's not just
about your tweets, **the reply style also mimics the reference**. A
jackleeio reply should read like @KKaWSB wrote it.

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
5. decide action (quote / reply / like / skip) per §Final decision rule
6. post via CDP (no approval)
7. sleep 90–180s jitter
8. repeat until duration or max hit

Session auto-exits when done. State persists across sessions via
`~/.bnbot/state/auto-reply-*.json`.

**Auto mode skips user approval but applies ALL safety + strategy
rules strictly.** If profile voice isn't loaded → abort immediately.

### Visibility / audit trail

Auto mode is hands-off but NOT opaque. Claude MUST print and persist
the scoring breakdown so the user can audit every decision.

**During the run — stream to console**, one block per candidate:

```
[2/8] @UnicornBitcoin  (200k followers, blue)  L346 RT105 R24 V9678  age=0.4h
  reply_ev=8_200   quote_ev=1_450   fit=core-niche   agrees=true
  → REPLY  (AAVE breaking, on-niche, reply rank=2, blue +0)
  draft: "上一次主流借贷协议..."
  [posted 2046... in 6.6s]
  sleeping 127s…
```

For `skip`, still print the line (one-liner) — user should see WHY
the tweet was rejected (e.g. `→ SKIP (off-topic: vulture bird)`).

**At session end — write a markdown report**:

```
~/.bnbot/logs/auto-reply-session-<YYYYMMDD-HHMM>.md
```

Format:

```markdown
# Auto-reply session · 2026-04-21 12:30 · 3m 00s

Source: following
Profile: jackleeio (mimic @KKaWSB)
Mode: --auto --max=1

## Summary
- Scraped: 15 candidates
- Hard-filtered: 3 reply-in-thread · 2 dead-on-arrival · 1 suppressed
- Scored: 9 candidates
- Actions: 0 quote · 1 reply · 2 like · 12 skip
- Posted: 1 (https://x.com/jackleeio/status/2046...)

## Candidates

| Rank | Author | EV reply | EV quote | Fit | Action | Reason |
|---|---|---|---|---|---|---|
| 1 | @UnicornBitcoin | 8,200 | 1,450 | core-niche | reply | AAVE breaking, top-3 |
| 2 | @TheBlockCo | 3,749 | — | core-niche | like | On-niche + endorsed |
| 3 | @AMAZlNGNATURE | 9,594 | 5,800 | off-topic | skip | vulture bird, not Web3/AI |
| 4 | @dvassallo | 103 | — | adjacent | skip | rank 13, buried |
| … | | | | | | |

## Drafts posted

- @UnicornBitcoin → `上一次主流借贷协议...`
```

The report is both a debug trace and an audit log. User can review
after a scheduled session ran overnight and sanity-check the decisions.

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
Given this tweet, the user's voice profile, and the pre-computed
exposure numbers, pick the best action.

Tweet:
  author: @<handle>  (followers: <N>, verified: <bool>)
  text: """<FULL text, verbatim — NOT truncated>"""
  engagement: <likes>L / <retweets>RT / <replies>RP / <views>V
  posted: <ageHours>h ago

Pre-computed:
  reply_expected_views: <N>      (your reply's forecast impressions)
  quote_expected_views: <N>      (your quote's forecast impressions)
  persona_fit: core-niche | adjacent | off-topic | avoid
  quote_daily_quota_left: <0|1>
  like_daily_quota_left: <N>

Judge:
  endorses: true | false  (would the user agree with this take based
                           on their voice profile + sampleTweets stance?)

Decide:
  action: quote | reply | like | skip
  reason: 1 sentence referencing fit + (EV for reply/quote,
          endorsement for like)
  draft:  required if action ∈ {quote, reply}
          - matches profile.style.maxTweetLength  (posts) or ≤140 (reply)
          - follows profile.styleReference.blendMode + analysis
          - forbidden fillers: 值得一提的是 / 不得不说 / 让我们 / I'd argue /
            what a great take / em-dash flourishes / hashtags in replies
          - for jackleeio: Chinese only, no EN mixed, mimic @KKaWSB
            (数字锚定 / 短句断句 / 反转或留白收尾 / 零感叹)
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
