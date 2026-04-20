# Scheduling posts via CDP (bnbot desktop → extension)

This pattern moves scheduling **out of the Chrome extension** and into
bnbot desktop. The extension becomes a dumb executor — bnbot decides
*what* and *when*, the extension just runs the CDP write action on the
pooled X tab.

## Why

The Chrome extension used to own TaskAlarmScheduler / DraftAlarm /
BoostService (≈3369 LOC). Problems with that:

- Chrome alarms are unreliable after SW restart
- Can't use Claude to compose the tweet at fire time
- Scheduler state trapped in `chrome.storage` (quota-limited)
- Subscription-gated scheduling UX can't live in extension

With CDP writes working (`bnbot x post --engine debugger ...`), bnbot
desktop can drive the whole flow itself.

## The executor layer (already done)

```bash
bnbot x post   --engine debugger "text"               # post
bnbot x post   --engine debugger "text" --media /path/to.png
bnbot x post   --engine debugger "text" --media /path/to.mp4   # video works
bnbot x reply  --engine debugger <tweet-url> "text"
bnbot x quote  --engine debugger <tweet-url> "text"
bnbot x like   --engine debugger <tweet-url>
bnbot x retweet --engine debugger <tweet-url>
bnbot x delete --engine debugger <tweet-url>
bnbot x thread --engine debugger '[{"text":"1/3"},{"text":"2/3"},{"text":"3/3"}]'
```

These go: CLI → WS :18900 → background.ts → debuggerWriteHandlers →
chrome.debugger CDP ops on the pooled X tab. No extension logic
required beyond the handler routing.

## Scheduling — bnbot desktop owns the clock

bnbot desktop (Claude Code fork) has `CronCreate` / `CronList` /
`CronDelete` tools. Use those to register a time-based trigger, and in
the trigger's prompt write the CLI call.

### Example — schedule a post 2 minutes from now

```
# inside bnbot desktop's REPL:
schedule a post 2 minutes from now saying "hello from cron"
```

Agent should:

1. Compute target time (e.g. 14:32 today)
2. Call `CronCreate` with a cron expression firing once at that time
3. Set the prompt body to: `bnbot x post --engine debugger "hello from cron"` (via Bash tool at fire time)

At the scheduled moment, bnbot wakes, runs Bash, the CLI sends to port
18900, extension executes CDP write, result returns. Total latency
from cron fire → published tweet ≈ 6s.

### Example — daily auto-draft and post

```
every day at 8am pick one trending topic, draft a tweet in my voice,
and post it
```

At 8am Claude:

1. Runs `bnbot scrape trending --platform x` (read via GraphQL)
2. Scores topics, picks one
3. Composes draft in user's voice (profile loaded from
   `~/Projects/bnbot-kit/skill/config/profiles/*.json`)
4. Posts via `bnbot x post --engine debugger "<draft>"`

All intelligence in bnbot. Extension just executes.

## Preconditions at fire time

- Chrome must be running with bnbot extension loaded
- `bnbot serve` (the WS daemon at :18900) must be up. CLI auto-spawns
  it if missing, but Chrome's extension takes a few seconds to
  reconnect after a server restart — build in retry.
- Extension must be logged into X (session cookies present)

## Retry pattern

If the post fails (Chrome closed, extension not connected, CDP error),
bnbot's agent should handle it — e.g. retry 3 times with 60s backoff,
then surface a notification. This logic stays in the agent prompt, not
in the extension.

## State persistence

Scheduled tasks live in bnbot's own state (Claude Code fork has
file-based memory at `~/.bnbot/` — configurable via
`CLAUDE_CONFIG_DIR`). Use a simple JSON file:

```
~/.bnbot/scheduled/<id>.json
```

with fields: `id`, `fireAt`, `action`, `payload`, `status`,
`lastAttempt`, `attempts`.

CronCreate handles the actual wakeup — this file is just the source of
truth for "what's queued" so the user can list / cancel.

## Migration order (from extension to desktop)

1. **Verify via CronCreate demo** — this doc.
2. **Deprecate extension's `bnbot draft` scheduling** — direct users to
   bnbot desktop's scheduler instead.
3. **Port auto-reply loop** (`autoReplyService.ts`, 1542 LOC) — this is
   the biggest piece. Desktop polls mentions via read scrape, Claude
   decides reply, fires `bnbot x reply --engine debugger`.
4. **Port boost service** (`boostService.ts`, 516 LOC) — like/RT
   engagement on target accounts.
5. **Kill extension-side scheduler** — remove TaskAlarmScheduler,
   DraftAlarm, BoostService. Extension becomes pure executor.
