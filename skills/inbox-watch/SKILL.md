---
name: inbox-watch
version: "0.1.0"
description: "Lifecycle control for the auto inbox poller — start / stop / status / change interval. The poller wakes every N minutes via launchd, scrapes X notifications, and triggers /inbox-triage --auto when fresh actionable items appear."
argument-hint: 'start, stop, status, set interval to 5 min, uninstall'
allowed-tools: Bash, Read, Write
user-invocable: true
trigger: /inbox-watch
---

# /inbox-watch — auto inbox poller lifecycle

This skill is **only** about controlling the `com.bnbot.inbox-tick`
launchd agent. For one-shot manual inbox cleanup, use `/inbox-triage`
directly.

The poller's job is to capture the high-freshness reply window —
ranks 1-3 capture 55% of a parent tweet's exposure, and that
position requires posting within ~5 min of the parent. Manual
invocation rarely catches this. The poller does.

## What it does in the background

```
every N minutes (default 15):
  ↓
WS scrape /notifications/all.json (cheap — no Claude)
  ↓
dedupe vs ~/.bnbot/state/inbox-seen.json
  ↓
non-actionable fresh (like/follow/retweet/other) → mark seen, done
  ↓
0 actionable: exit (no Claude spawn this cycle)
  ↓
≥1 actionable (mention/reply/quote/new_post) → spawn detached
   `bnbot -p '/inbox-triage --auto' --model=sonnet` which:
     - applies EV + persona-fit + endorsement gates
     - posts via CDP at most max-per-day allowance
     - writes session report
```

State + logs:
```
~/.bnbot/state/inbox-seen.json     # rolling 30-day dedup set
~/.bnbot/state/inbox-lastrun.json  # last tick metadata
~/.bnbot/logs/inbox-tick.log       # tick-level append log
~/.bnbot/logs/inbox-session-*.md   # per-spawn session reports
```

## User intent → CLI command

| User says | Action |
|---|---|
| "开启 inbox 自动监听" / "start" / "go live" | `bnbot inbox install && bnbot inbox start` |
| "停" / "暂停" / "stop" / "pause" | `bnbot inbox stop` (plist preserved) |
| "在不在跑" / "status" / "看看状态" | `bnbot inbox status` |
| "改成 5 分钟一次" / "tighter" / "more aggressive" | `bnbot inbox stop && bnbot inbox install --interval=300 && bnbot inbox start` |
| "改成 30 分钟" / "saner" | `bnbot inbox stop && bnbot inbox install --interval=1800 && bnbot inbox start` |
| "彻底卸了" / "remove" / "uninstall" | `bnbot inbox uninstall` |

## Two-step install/start by design

`install` writes the plist with `RunAtLoad=false` — it's configured
but not running. User has to explicitly say "start" before any
auto-engagement happens. Prevents:

- Test installs accidentally going live ("I just wanted to see what
  it does, not have it reply 30 times today")
- Reinstall (e.g. interval change) silently picking back up

So the standard "turn it on for the first time" flow is two commands:
```
bnbot inbox install        # writes plist, conservative 15min default
bnbot inbox start          # actually loads it and starts ticking
```

Subsequent restarts after stop are just `start` (plist already there).

## Interval guidance

Default: **15 min** (900s). Conservative — looks like a real user
checking notifications, catches reply rank 1-3 most of the time.

| Interval | Hits / day | Catches | Risk |
|---|---|---|---|
| 1 min | 1440 | rank 1 always | bot pattern |
| 2 min | 720 | rank 1-2 | borderline |
| 5 min | 288 | rank 1-3 | active user pattern |
| **15 min (default)** | **96** | **rank 1-3 most** | **safe** |
| 30 min | 48 | rank 4-7 | misses gold window |
| 60 min | 24 | rank 10+ | basically inactive |

Tighten only when the user wants to maximize traffic and accepts the
slightly higher API hit rate.

## Status reporting

When user asks "status", run `bnbot inbox status` and present the
JSON in a readable form:

```
🦞 inbox-watch
   installed: ✓
   running:   ✓ (or ✗ — paused)
   interval:  15min
   last tick: 2026-04-21 14:18 (3 min ago)
              scraped 37 → 0 fresh → 0 actionable
   seen:      37 items in dedup
   log:       ~/.bnbot/logs/inbox-tick.log
```

If `running: ✗` despite `installed: ✓`, prompt user with: "Plist is
installed but agent is stopped. Run `bnbot inbox start` to resume."

## Don't do

- Don't auto-start without explicit user consent. The skill exists
  precisely to make starting an opt-in action.
- Don't nest with `/inbox-triage` — that skill is the manual path
  with draft-approval. This one is the auto path. They share state
  (`~/.bnbot/state/inbox-*.json`).
- Don't change interval below 60s (`bnbot inbox install` validates
  this); LaunchD throttles tighter intervals anyway and X-side
  rate-limit risk goes up sharply.
