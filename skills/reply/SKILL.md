---
name: reply
version: "0.1.0"
description: "Reply to an X tweet — text or AI-generated image. Scrape the source, draft 3 candidates in the user's voice, let the user pick, post via CDP."
argument-hint: 'reply to https://x.com/xxx/status/123, reply with image, image-reply this'
allowed-tools: Bash, Read, Write, Edit
user-invocable: true
trigger: /reply
---

# /reply — reply to an X tweet (text or image)

One skill for both flavours of reply. Replaces the extension's
「🦞回复」 button and the image-reply (BNBOT-AI in the toolbar) icon.

## When to use

- User pastes a tweet URL and says "回复" / "reply to this" / "帮我回一条"
- `type=image` when user says "图片回复" / "用图回他" / "reply with image"

For standalone posts using the source's angle → use `/remix` instead.
Remix is a re-post; reply is an in-thread response.

## Inputs

| Field | Default | Notes |
|---|---|---|
| Tweet URL | — | Required |
| Type | `text` | `text` = text reply; `image` = AI-generated image reply |
| Candidates | 3 | 3 text drafts, OR 1 image + its caption |
| Tone hint | from profile | Override: "snarky", "supportive", "first-principles", etc. |

## Preflight checks

1. `bnbot status` — extension ✓ connected, else abort.
2. Voice profile loaded: `~/.bnbot/skills/bnbot/config/profiles/<handle>.json`.
3. Persona rules: `~/.claude/skills/bnbot/references/persona.md`
   (no em-dash, no "what a great take", etc.)
4. State dirs: `mkdir -p ~/.bnbot/state ~/.bnbot/logs`

## Core flow

### 1. Scrape the source tweet

```bash
bnbot x scrape thread "<tweet-url>" > /tmp/reply-source.json
```

Read the **full** text (don't truncate). For a thread URL, focus on the
first entry; the rest provides context.

Also pull: `author`, `authorFollowers`, `views`, `likes`, `media[]`.
If `media[]` has images/video, factor the media content into the reply
(don't reply to just the text when the tweet is mainly media).

### 2. Gates

Abort and report back if:

- Source text is empty (deleted / protected)
- Author == current user (don't reply to yourself)
- Already replied to this user within 6h (check `~/.bnbot/state/reply-rate.json`)
- Source is on the profile's avoid-list (politics / NSFW / specific handles)
- Source is > 4h old (reply-rank window closed, save the effort)

## Type: text (default)

### 3a. Draft 3 text candidates

Each candidate ≤ 240 chars, matches voice. Angles pick 3 of:

- **Substantive add** — provide a fact / example / number the original missed
- **Respectful counter** — disagree with a specific point
- **Personal take** — tie to user's own documented experience
- **Ask a sharper question** — push the thread deeper
- **Punchline** — one-liner that lands (only if voice profile supports it)

Output each as:

```
[1/3] Substantive add
  voice: ✓ lowercase, ✓ no em-dash, 168 chars
  > "<draft>"
  reason: adds the specific number the OP glossed over

[2/3] ...
```

### 4a. Post

```bash
bnbot x reply --engine debugger -- "<source-url>" "<picked draft>"
```

**Verify the CLI's JSON output before claiming success.** Only write
to `reply-rate.json` + `reply-YYYYMMDD.jsonl` if `success: true` in
stdout. If the command failed or timed out, do NOT tell the user
"posted" / "recorded"; report the raw stdout and let the user decide.

## Type: image

### 3b. Design the image

Decide image angle FIRST (one per reply, don't make 3 images):

- **Diagram** — if reply clarifies a concept that benefits from a diagram
- **Chart** — if reply introduces data
- **Meme** — if voice profile supports memey tone
- **Screenshot** — if reply references a doc / code / message

Then:

1. Draft the caption text (≤ 200 chars, same voice rules)
2. Generate the image — default path: OpenAI DALL-E or Gemini imagegen
   via the user's configured provider. Save to
   `/tmp/reply-image-$(date +%s).png`
3. Show the user:

```
📎 Source · @alice · 2h
  > "..."

Type: image
Caption (≤ 200 chars):
  > "<caption draft>"

Image preview: /tmp/reply-image-1234567890.png
  [approve] [redraft text] [redraft image] [skip]
```

### 4b. Post with image

```bash
bnbot x reply --engine debugger --media /tmp/reply-image-<ts>.png -- \
  "<tweet-url>" "<caption>"
```

**Commander gotcha**: `--media` is variadic. Text + URL positionals
MUST be separated with `--`, else commander swallows them into --media.

## State & logging

### Per-user cooldown

Before posting, check `~/.bnbot/state/reply-rate.json`:

```json
{
  "<author-handle>": {"lastReplyAt": "2026-04-21T10:15:00Z", "replyTweetId": "..."}
}
```

If `< 6h` since last reply to this user, abort and report.

After success, update the file.

### Daily cap

Before posting, count today's entries in `~/.bnbot/logs/reply-YYYYMMDD.jsonl`.
If `≥ 15`, abort. (Shared cap with `/auto-reply` — the account's
reply budget is global.)

### Log

```jsonl
{"ts":"...","sourceUrl":"...","sourceAuthor":"...","type":"text","picked":2,"candidates":3,"draftedText":"...","postedId":"...","postedUrl":"..."}
{"ts":"...","sourceUrl":"...","type":"image","caption":"...","imagePath":"/tmp/...","postedId":"..."}
```

## Safety rules (hard)

1. **Never post without user pick** — `--auto` mode is explicitly
   forbidden for this skill. Reply is in-thread, mistakes = public harassment risk.
2. **Never reply to own tweets**.
3. **6h per-user cooldown** hard rule.
4. **Daily cap ≤ 15** (shared with /auto-reply).
5. **Read full source text** before drafting — no 200-char preview.
6. **Image mode**: caption must actually relate to the image, not just
   "nice image 🔥".
7. **No generic "great point!" / "100%" openers** — voice persona.md.

## Don't do

- Don't reply if the tweet is > 4h old — the reply-rank window is closed.
- Don't reply if the source already has > 80 replies — yours gets buried.
- Don't reply to promotional / ad / crypto-shilling tweets (even if in niche).
- Don't include hashtags — looks bot-ish.
- Don't post the same image in two different replies — check logs.

## Desktop integration

Desktop chat invokes: `bnbot -p '/reply <url>'` or
`bnbot -p '/reply <url> --type image'`. Candidates stream into chat;
user picks with a short reply; agent posts.
