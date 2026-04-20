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

import {
  deleteViaDebugger,
  likeViaDebugger,
  postViaDebugger,
  quoteViaDebugger,
  replyViaDebugger,
  retweetViaDebugger,
} from './debuggerWriteActions'

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
}
