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
 * Two ways to refresh:
 *   A. fa0311 upstream (community, may lag — burned us 2026-04-29 on
 *      SearchTimeline):
 *      https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json
 *   B. Live x.com bundle scrape — most reliable. Run with extension loaded:
 *      bnbot debug eval --host x.com --await-promise '(async () => {
 *        const ops = ["HomeTimeline","HomeLatestTimeline","SearchTimeline","UserByScreenName","UserTweets","TweetDetail","Bookmarks"];
 *        const found = {}; for (const s of document.querySelectorAll("script[src]")) {
 *          if (!s.src.endsWith(".js")) continue;
 *          try { const code = await (await fetch(s.src)).text();
 *            for (const op of ops) { if (found[op]) continue;
 *              const m = code.match(new RegExp("queryId:\\"([^\\"]+)\\",operationName:\\""+op+"\\""));
 *              if (m) found[op] = m[1]; } } catch {}
 *          if (Object.keys(found).length === ops.length) break;
 *        } return JSON.stringify(found); })()'
 *
 * Last refreshed: 2026-04-29 — values pulled from live x.com bundle
 * (main.759b891a.js). Bookmarks fell back to fa0311 because the
 * /i/bookmarks bundle wasn't loaded during the home-page scrape.
 */
export const X_QUERY_IDS = {
  HomeTimeline: '3tb-_5Lf7kdCZ1cFHmsEfg',
  HomeLatestTimeline: 'eObmT5Nuapp04u8bYWf49Q',
  SearchTimeline: 'XN_HccZ9SU-miQVvwTAlFQ',
  UserByScreenName: 'IGgvgiOx4QZndDHuD3x9TQ',
  UserTweets: 'naBcZ4al-iTCFBYGOAMzBQ',
  TweetDetail: 'QrLp7AR-eMyamw8D1N9l6A',
  Bookmarks: 'Fy0QMy4q_aZCpkO0PnyLYw',
} as const

export type XQueryIds = typeof X_QUERY_IDS
