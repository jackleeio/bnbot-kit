/**
 * Hardcoded fallback queryIds for X (Twitter) GraphQL operations.
 *
 * Refresh these before each `npm publish` if X rotates them.
 *
 * The extension still tries `fa0311/twitter-openapi` upstream JSON at
 * runtime as the *primary* source — these only kick in when GitHub raw
 * is unreachable (国内 network) or the upstream falls behind a few
 * hours. The chain inside extension/services/scrapers/browser/twitter.ts:
 *
 *   1. fetch fa0311 placeholder.json → freshest
 *   2. CLI-passed `queryIds` (this file)  ← bumped via `npm publish`
 *   3. error
 *
 * Source: https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json
 * Last refreshed: 2026-04-29 (matches values previously hardcoded in
 * extension/services/scrapers/browser/twitter.ts:14-29 before they were
 * relocated here).
 */
export const X_QUERY_IDS = {
  HomeTimeline: 'c-CzHF1LboFilMpsx4ZCrQ',
  HomeLatestTimeline: 'BKB7oi212Fi7kQtCBGE4zA',
  SearchTimeline: 'VhUd6vHVmLBcw0uX-6jMLA',
  UserByScreenName: 'qRednkZG-rn1P6b48NINmQ',
  UserTweets: 'q6xj5bs0hapm9309hexA_g',
  TweetDetail: 'xd_EMdYvB9hfZsZ6Idri0w',
  Bookmarks: 'Fy0QMy4q_aZCpkO0PnyLYw',
} as const

export type XQueryIds = typeof X_QUERY_IDS
