---
name: republish
version: "0.1.0"
description: "Download a video / note from any platform yt-dlp supports (TikTok / YouTube / XHS / IG / Bilibili / 抖音 / 微博 ...) and repost it to X with your own commentary. Composes `bnbot download` + `bnbot x post --media`."
argument-hint: 'republish https://www.tiktok.com/@xxx/video/123 "我加的解说", republish <youtube-url>'
allowed-tools: Bash, Read, Write, Edit
user-invocable: true
trigger: /republish
---

# /republish — share a video from another platform on X, with your take

Downloads the original file via `yt-dlp` and attaches it to a new X
post. You **must add your own commentary / angle** — this skill will
refuse to post a bare file with empty or generic text, because that
looks like mass-scraping and drags down the account's reputation.

## When to use

- "这条 TikTok 片段 + 我的评论" → `/republish`
- "我想把 YouTube 演讲剪出来一段发 X"（先下载再人工剪辑再发）→ `/republish` + 手动剪
- 发**原 URL 链接 + 文字观点** → 用 `/quote` 或 `/reply`（不是本 skill）
- 发**原推文改写** → 用 `/remix`（本 skill 只管跨平台视频）

## Preflight

Before doing anything:

1. **Verify `bnbot download --info <url>` works** — catches IP blocks
   (TikTok geo-blocks common) + dead URLs BEFORE we ask the user for
   commentary.
2. **Check content length** — X video limit is **140 seconds** for free
   accounts, **10 min** for Premium, **3 hours** for Premium+. If
   `duration` in `--info` exceeds user's tier, warn + offer to:
   - Download full file, user trims in their own editor, then re-post
   - OR: use `/recap` instead (text summary of long video) — once that
     skill exists
3. **Check file size** — X limit is 512MB. If probable oversize, warn.
4. **Respect platform ToS** — don't republish obviously proprietary /
   creator-attribution-required content without crediting. Always
   include the original author handle + link in the text.

## Core flow

```bash
# 1. Download
bnbot download "<url>"                           # → { success, path, url }
#    or: bnbot download "<url>" -o /tmp/clip.mp4 # exact output path

# 2. Draft commentary (Claude writes 3 candidates)
#    ≤240 chars, matches voice profile, mentions original author + link
#    Example:
#      > @openai 的这段演示把 dense text rendering 秀到新高度。
#      > 原视频：{url}

# 3. User picks / edits

# 4. Post with the downloaded file attached
bnbot x reply    # NO — this is a standalone post, not a reply
bnbot x post --engine debugger "<final text>" --media <path>
```

## Evaluation rubric (what the drafts should look like)

A good republish post has FOUR parts:

1. **Original author credit** — always include the @ handle or
   "via <source>" (TikTok, YouTube channel name). Without credit this
   looks like stolen content; X will also throttle engagement.
2. **Your angle** — 1 sentence of WHY this matters / what you take away.
   This is the reason you're republishing at all.
3. **Link back to original** — last line, `原视频: <url>`. Lets
   interested viewers give the creator their view count.
4. **Under 240 chars** — leaves room for X's t.co shortening.

Do NOT write:
- Generic affirmations ("wow amazing / 太牛了 / this is wild") as the
  only angle
- Reposts without author credit
- Obviously AI-phrased takes (em-dashes, "I'd argue", "what a take")
- Hashtag spam

## Safety / sanity limits

1. **Max 3 republishes per day** per account — republishing is aggressive
   content; more than a few a day looks like curation-spam. If Claude
   sees 3+ `/republish`s already in today's log, warn & ask before posting.
2. **Never republish minors / private accounts**. If the --info shows
   uploader is a private/verified-minor account, refuse.
3. **No auto-loop**: `/republish` is always single-shot, never part of a
   `/auto-reply` or `/inbox-triage` flow.
4. **Always show draft before posting**. Even if user said "just post",
   print the draft + file path one more time and wait for final yes.
5. **Audio-only episodes** — if user passes a long podcast URL, check
   duration and suggest `--format audio` + `/recap` path instead of
   actually uploading 45-min audio to X (useless format there).

## Logging

Append to `~/.bnbot/logs/republish-YYYYMMDD.jsonl`:

```jsonl
{"ts":"...","url":"...","platform":"tiktok","author":"...","duration":45,"path":"...","text":"...","tweetId":"...","posted":true}
```

Rolling 30-day window; older files pruned on next run.

## Failure modes & what Claude should do

| yt-dlp error | Cause | Action |
|---|---|---|
| `Your IP address is blocked` | Geo block (common on TikTok) | Suggest VPN or use `--info` from a different source |
| `HTTP Error 403` | Requires login / region | Same |
| `HTTP Error 404` | URL dead / video deleted | Abort, tell user |
| `File too large` | Over X 512MB | Offer audio-only re-encode OR trim hint |
| `Unsupported URL` | Platform not in yt-dlp | Tell user; check yt-dlp version with `yt-dlp --version` |

## Integration with other skills

- Complements `/remix` (text rewrite of an X tweet)
- Can produce input for `/recap` (if user just wants a text summary
  instead of the video itself)
- Scheduled via `bnbot calendar add --at HH:MM "bnbot x post --media
  /path/to/file --engine debugger '<text>'"` after running `/republish`
  in dry-run mode (save file, don't post immediately)

## Don't do

- Don't post the raw downloaded file with no text — that's spam.
- Don't strip the original creator's attribution from the text.
- Don't use `/republish` as an `/auto-reply` style bulk operation —
  this is a hand-curated single post.
- Don't re-upload copyrighted music / paid content; yt-dlp will
  download them but X will take them down and flag the account.
