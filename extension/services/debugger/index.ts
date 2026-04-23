/**
 * Adapter layer — wraps the typed write actions into the
 * `(payload) => Promise<result>` shape that background.ts's
 * `scraperHandlers` style routing expects, and exports them as a
 * single map that can be spread into the main router.
 *
 * Action naming: suffixed with `_debugger` so callers can opt in
 * explicitly. Content-script handlers for the same verbs remain
 * registered and the default, so this is additive — no existing
 * behavior changes until a client (CLI / agent) requests the
 * `_debugger` variant.
 */

import { evalExpr, prepareTab } from './debuggerOps'
import {
  deleteViaDebugger,
  likeViaDebugger,
  postThreadViaDebugger,
  postViaDebugger,
  quoteViaDebugger,
  replyViaDebugger,
  retweetViaDebugger,
} from './debuggerWriteActions'
import { postXhsNote, XhsEmojiSlot } from './xhsWriteActions'
import { getXhsNoteStats, getXhsAccountStats } from './xhsStatsActions'

type Payload = Record<string, unknown>

function str(p: Payload, key: string): string {
  const v = p[key]
  if (typeof v !== 'string') throw new Error(`missing ${key}`)
  return v
}

function strArrayOrUndef(p: Payload, key: string): string[] | undefined {
  const v = p[key]
  if (!v) return undefined
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
    return v
  }
  return undefined
}

function bool(p: Payload, key: string): boolean {
  return p[key] === true
}

export const debuggerWriteHandlers: Record<string, (payload: Payload) => Promise<unknown>> = {
  post_tweet_debugger: async (payload) =>
    postViaDebugger({
      text: str(payload, 'text'),
      mediaPaths: strArrayOrUndef(payload, 'mediaPaths'),
      visible: bool(payload, 'visible'),
    }),

  reply_tweet_debugger: async (payload) =>
    replyViaDebugger({
      tweetUrl: str(payload, 'tweetUrl'),
      text: str(payload, 'text'),
      mediaPaths: strArrayOrUndef(payload, 'mediaPaths'),
      visible: bool(payload, 'visible'),
    }),

  like_tweet_debugger: async (payload) =>
    likeViaDebugger({
      tweetUrl: str(payload, 'tweetUrl'),
      mode: 'like',
      visible: bool(payload, 'visible'),
    }),

  unlike_tweet_debugger: async (payload) =>
    likeViaDebugger({
      tweetUrl: str(payload, 'tweetUrl'),
      mode: 'unlike',
      visible: bool(payload, 'visible'),
    }),

  retweet_debugger: async (payload) =>
    retweetViaDebugger({
      tweetUrl: str(payload, 'tweetUrl'),
      mode: 'retweet',
      visible: bool(payload, 'visible'),
    }),

  unretweet_debugger: async (payload) =>
    retweetViaDebugger({
      tweetUrl: str(payload, 'tweetUrl'),
      mode: 'unretweet',
      visible: bool(payload, 'visible'),
    }),

  quote_tweet_debugger: async (payload) =>
    quoteViaDebugger({
      tweetUrl: str(payload, 'tweetUrl'),
      text: str(payload, 'text'),
      mediaPaths: strArrayOrUndef(payload, 'mediaPaths'),
      visible: bool(payload, 'visible'),
    }),

  delete_tweet_debugger: async (payload) =>
    deleteViaDebugger({
      tweetUrl: str(payload, 'tweetUrl'),
      visible: bool(payload, 'visible'),
    }),

  // Ad-hoc JS probe on the pooled x.com tab — navigates if needed, then
  // Runtime.evaluate's the given expression and returns its value.
  inspect_debugger: async (payload) => {
    const target = await prepareTab(str(payload, 'url'))
    const result = await evalExpr(target.targetId, str(payload, 'expr'))
    return { result }
  },

  post_thread_debugger: async (payload) => {
    const raw = payload.tweets
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error('tweets array is required')
    }
    const tweets = raw.map((t, i) => {
      if (!t || typeof t !== 'object') throw new Error(`tweet ${i} invalid`)
      const obj = t as Record<string, unknown>
      if (typeof obj.text !== 'string') throw new Error(`tweet ${i} missing text`)
      const media = obj.mediaPaths
      const mediaPaths =
        Array.isArray(media) && media.every((m) => typeof m === 'string')
          ? (media as string[])
          : undefined
      return { text: obj.text, mediaPaths }
    })
    return postThreadViaDebugger({ tweets, visible: bool(payload, 'visible') })
  },

  // XHS compose + publish — one-shot, replaces ~10 CLI round-trips.
  // See xhsWriteActions.ts for selector map and step breakdown.
  xhs_post: async (payload) => {
    const images = strArrayOrUndef(payload, 'images')
    if (!images || images.length === 0) throw new Error('images (array) required')
    const emojisRaw = payload.emojis
    const emojis: XhsEmojiSlot[] | undefined = Array.isArray(emojisRaw)
      ? emojisRaw.map((e, i) => {
          if (!e || typeof e !== 'object') throw new Error(`emojis[${i}] invalid`)
          const obj = e as Record<string, unknown>
          if (typeof obj.paraIndex !== 'number') throw new Error(`emojis[${i}].paraIndex must be number`)
          if (typeof obj.slug !== 'string') throw new Error(`emojis[${i}].slug must be string`)
          return { paraIndex: obj.paraIndex, slug: obj.slug }
        })
      : undefined
    const coverIndex = typeof payload.coverIndex === 'number' ? payload.coverIndex : 0
    return postXhsNote({
      images,
      coverIndex,
      title: str(payload, 'title'),
      body: str(payload, 'body'),
      emojis,
      tags: strArrayOrUndef(payload, 'tags'),
      autoFillTags: typeof payload.autoFillTags === 'boolean' ? payload.autoFillTags : undefined,
      minTags: typeof payload.minTags === 'number' ? payload.minTags : undefined,
      publish: bool(payload, 'publish'),
    })
  },

  // XHS stats readers (navigate → DOM scrape). See xhsStatsActions.ts.
  xhs_stats_note: async (payload) => {
    return getXhsNoteStats(str(payload, 'noteId'))
  },
  xhs_stats_account: async () => {
    return getXhsAccountStats()
  },
}
