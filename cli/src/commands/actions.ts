/**
 * Commander action handlers for X platform commands.
 *
 * Each handler maps commander arguments/options to the WebSocket action format
 * and uses `runCliAction` from cli.ts to send them to the running server.
 */

import { runCliAction } from '../cli.js';
import { ensureAccount, type WriteEngine } from '../accountGuard.js';
import { resolveMediaListAsync, resolveMediaListAsPaths } from '../tools/mediaUtils.js';
import { getXQueryIds } from '../fa0311.js';

/**
 * Pick the write-path engine. Default switched debugger → dom only when
 * the caller explicitly passes `--engine dom`, or when they pass
 * `--draft` (debugger has no draft mode yet — it always publishes).
 *
 * Why default to debugger: the dom (chrome.scripting) path drives X's
 * compose box by hunting for input fields in the live DOM, and X's
 * frequent UI churn makes it intermittently miss the field and time
 * out at 60s. The debugger path drives the same flow via CDP against
 * a dedicated automation tab, which is far more stable. Cost: a
 * "BNBot is debugging this browser" bar appears on the tab during
 * the call (purely cosmetic).
 */
function normEngine(e?: string, _opts: { draft?: boolean } = {}): WriteEngine {
  if (e === 'dom') return 'dom';
  return 'debugger';
}

/** Parse media option into an array of source strings. */
function toSourceList(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw])
    .flatMap((s) => String(s).split(','))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const DEFAULT_PORT = 18900;

// ── Helpers ──────────────────────────────────────────────────

function getPort(): number {
  return DEFAULT_PORT;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/**
 * Resolve --media / -m options into the data URL array the extension expects.
 * Supports: local file paths, http(s) URLs, data: URIs, comma-separated lists.
 */
async function resolveMedia(
  raw: string | string[] | undefined
): Promise<Array<{ type: 'photo' | 'video'; url: string }> | undefined> {
  if (!raw) return undefined;
  const sources: string[] = (Array.isArray(raw) ? raw : [raw])
    .flatMap((s) => String(s).split(','))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sources.length === 0) return undefined;
  return resolveMediaListAsync(sources);
}

// ── Tweet / Post ─────────────────────────────────────────────

export async function postCommand(text: string, options: { media?: string | string[]; draft?: boolean; engine?: string; visible?: boolean; as?: string }): Promise<void> {
  const isDraft = options.draft || false;
  const engine = normEngine(options.engine, { draft: isDraft });
  await ensureAccount({ expected: options.as, engine, port: getPort() });
  const preview = text.slice(0, 80) + (text.length > 80 ? '...' : '');
  console.error(isDraft ? `Drafting: "${preview}"` : `Posting: "${preview}"` + (engine === 'debugger' ? ' [engine=debugger]' : ''));

  // Debugger engine: write actions go through chrome.debugger (CDP).
  // `--draft` here fills the composer in the pool window and leaves it
  // foregrounded for user audit (no submit click, no auto-minimize) —
  // similar in spirit to DOM-engine draft mode but uses the isolated
  // pool window instead of the user's active x.com tab.
  if (engine === 'debugger') {
    const sources = toSourceList(options.media);
    const mediaPaths = sources.length > 0 ? await resolveMediaListAsPaths(sources) : undefined;
    return runCliAction('post_tweet_debugger', {
      text,
      mediaPaths,
      visible: !!options.visible,
      draftOnly: isDraft,
    }, getPort());
  }

  const params: Record<string, unknown> = { text, draftOnly: isDraft };
  const media = await resolveMedia(options.media);
  if (media) params.media = media;

  // Auto-split into thread when >4 media
  const MAX_MEDIA = 4;
  if (media && media.length > MAX_MEDIA) {
    const tweets: Array<{ text: string; media: typeof media }> = [];
    for (let i = 0; i < media.length; i += MAX_MEDIA) {
      const chunk = media.slice(i, i + MAX_MEDIA);
      tweets.push({
        text: i === 0 ? text : `(${Math.floor(i / MAX_MEDIA) + 1}/${Math.ceil(media.length / MAX_MEDIA)})`,
        media: chunk,
      });
    }
    console.error(`[BNBOT] ${media.length} media files — auto-splitting into ${tweets.length}-tweet thread`);
    return runCliAction('post_thread', { tweets, draftOnly: isDraft }, getPort());
  }

  return runCliAction('post_tweet', params, getPort());
}

export async function closeCommand(options: { save?: boolean }): Promise<void> {
  const isSave = options.save || false;
  console.error(isSave ? 'Saving draft and closing...' : 'Discarding and closing...');
  return runCliAction('close_composer', { save: isSave }, getPort());
}

export async function threadCommand(tweetsJson: string, options: { engine?: string; visible?: boolean; as?: string } = {}): Promise<void> {
  let tweets: unknown;
  try {
    tweets = JSON.parse(tweetsJson);
  } catch {
    fail('Invalid JSON for thread tweets. Expected: \'[{"text":"..."},{"text":"..."}]\'');
  }
  const engine = normEngine(options.engine);
  await ensureAccount({ expected: options.as, engine, port: getPort() });
  console.error('Posting thread...' + (engine === 'debugger' ? ' [engine=debugger]' : ''));
  if (engine === 'debugger') {
    if (!Array.isArray(tweets) || tweets.length === 0) {
      fail('Thread requires a non-empty array');
    }
    // For each tweet, resolve media sources (URL / data URI / local path)
    // to absolute local paths for DOM.setFileInputFiles.
    const resolved = await Promise.all(
      (tweets as Array<{ text: string; media?: string | string[] }>).map(async (t) => {
        const sources = toSourceList(t.media);
        const mediaPaths = sources.length > 0 ? await resolveMediaListAsPaths(sources) : undefined;
        return { text: t.text, mediaPaths };
      })
    );
    return runCliAction('post_thread_debugger', { tweets: resolved, visible: !!options.visible }, getPort());
  }
  return runCliAction('post_thread', { tweets }, getPort());
}

export async function replyCommand(url: string, text: string, options: { media?: string | string[]; draft?: boolean; engine?: string; visible?: boolean; as?: string }): Promise<void> {
  const isDraft = options.draft || false;
  const engine = normEngine(options.engine, { draft: isDraft });
  await ensureAccount({ expected: options.as, engine, port: getPort() });
  console.error(isDraft ? `Drafting reply to: ${url}` : `Replying to: ${url}` + (engine === 'debugger' ? ' [engine=debugger]' : ''));

  if (engine === 'debugger') {
    const sources = toSourceList(options.media);
    const mediaPaths = sources.length > 0 ? await resolveMediaListAsPaths(sources) : undefined;
    return runCliAction('reply_tweet_debugger', {
      tweetUrl: url,
      text,
      mediaPaths,
      visible: !!options.visible,
      draftOnly: isDraft,
    }, getPort());
  }

  const params: Record<string, unknown> = { tweetUrl: url, text, draftOnly: isDraft };
  const media = await resolveMedia(options.media);
  if (media) params.media = media;
  return runCliAction('submit_reply', params, getPort());
}

export async function quoteCommand(url: string, text: string, options?: { media?: string | string[]; draft?: boolean; engine?: string; visible?: boolean; as?: string }): Promise<void> {
  const isDraft = options?.draft || false;
  const engine = normEngine(options?.engine, { draft: isDraft });
  await ensureAccount({ expected: options?.as, engine, port: getPort() });
  console.error(isDraft ? `Drafting quote of: ${url}` : `Quoting: ${url}` + (engine === 'debugger' ? ' [engine=debugger]' : ''));
  if (engine === 'debugger') {
    const sources = toSourceList(options?.media);
    const mediaPaths = sources.length > 0 ? await resolveMediaListAsPaths(sources) : undefined;
    return runCliAction('quote_tweet_debugger', {
      tweetUrl: url,
      text,
      mediaPaths,
      visible: !!options?.visible,
      draftOnly: isDraft,
    }, getPort());
  }
  return runCliAction('quote_tweet', { tweetUrl: url, text, draftOnly: isDraft }, getPort());
}

// ── Engagement ───────────────────────────────────────────────

export async function likeCommand(url: string, options?: { engine?: string; visible?: boolean; as?: string }): Promise<void> {
  const engine = normEngine(options?.engine);
  await ensureAccount({ expected: options?.as, engine, port: getPort() });
  console.error(`Liking: ${url}` + (engine === 'debugger' ? ' [engine=debugger]' : ''));
  if (engine === 'debugger') {
    return runCliAction('like_tweet_debugger', { tweetUrl: url, visible: !!options?.visible }, getPort());
  }
  return runCliAction('like_tweet', { tweetUrl: url }, getPort());
}

export async function unlikeCommand(url: string, options?: { engine?: string; visible?: boolean; as?: string }): Promise<void> {
  const engine = normEngine(options?.engine);
  await ensureAccount({ expected: options?.as, engine, port: getPort() });
  console.error(`Unliking: ${url}` + (engine === 'debugger' ? ' [engine=debugger]' : ''));
  if (engine === 'debugger') {
    return runCliAction('unlike_tweet_debugger', { tweetUrl: url, visible: !!options?.visible }, getPort());
  }
  return runCliAction('unlike_tweet', { tweetUrl: url }, getPort());
}

export async function retweetCommand(url: string, options?: { engine?: string; visible?: boolean; as?: string }): Promise<void> {
  const engine = normEngine(options?.engine);
  await ensureAccount({ expected: options?.as, engine, port: getPort() });
  console.error(`Retweeting: ${url}` + (engine === 'debugger' ? ' [engine=debugger]' : ''));
  if (engine === 'debugger') {
    return runCliAction('retweet_debugger', { tweetUrl: url, visible: !!options?.visible }, getPort());
  }
  return runCliAction('retweet', { tweetUrl: url }, getPort());
}

export async function unretweetCommand(url: string, options?: { engine?: string; visible?: boolean; as?: string }): Promise<void> {
  const engine = normEngine(options?.engine);
  await ensureAccount({ expected: options?.as, engine, port: getPort() });
  console.error(`Unretweeting: ${url}` + (engine === 'debugger' ? ' [engine=debugger]' : ''));
  if (engine === 'debugger') {
    return runCliAction('unretweet_debugger', { tweetUrl: url, visible: !!options?.visible }, getPort());
  }
  return runCliAction('unretweet', { tweetUrl: url }, getPort());
}

export async function followCommand(username: string, options?: { as?: string }): Promise<void> {
  // follow / unfollow have no engine flag — they go through the DOM path
  // (content-script GraphQL). Account guard still applies because
  // "following someone from the wrong brand" is exactly the cross-account
  // bug this whole feature exists to prevent.
  await ensureAccount({ expected: options?.as, engine: 'dom', port: getPort() });
  console.error(`Following: @${username}`);
  return runCliAction('follow_user', { username }, getPort());
}

export async function unfollowCommand(username: string, options?: { as?: string }): Promise<void> {
  await ensureAccount({ expected: options?.as, engine: 'dom', port: getPort() });
  console.error(`Unfollowing: @${username}`);
  return runCliAction('unfollow_user', { username }, getPort());
}

export async function deleteCommand(url: string, options: { engine?: string; visible?: boolean; as?: string } = {}): Promise<void> {
  const engine = normEngine(options.engine);
  await ensureAccount({ expected: options.as, engine, port: getPort() });
  console.error(`Deleting: ${url}` + (engine === 'debugger' ? ' [engine=debugger]' : ''));
  if (engine === 'debugger') {
    return runCliAction('delete_tweet_debugger', { tweetUrl: url, visible: !!options.visible }, getPort());
  }
  return runCliAction('delete_tweet', { tweetUrl: url }, getPort());
}

export async function bookmarkCommand(url: string, options?: { as?: string }): Promise<void> {
  await ensureAccount({ expected: options?.as, engine: 'dom', port: getPort() });
  console.error(`Bookmarking: ${url}`);
  return runCliAction('bookmark_tweet', { tweetUrl: url }, getPort());
}

export async function unbookmarkCommand(url: string, options?: { as?: string }): Promise<void> {
  await ensureAccount({ expected: options?.as, engine: 'dom', port: getPort() });
  console.error(`Unbookmarking: ${url}`);
  return runCliAction('unbookmark_tweet', { tweetUrl: url }, getPort());
}

// ── Account ────────────────────────────────────────────────

/**
 * `bnbot x whoami` — print the currently active X handle as JSON.
 * Useful for sanity-checking the pool window state before kicking off
 * a longer agent run.
 */
export async function whoamiCommand(options: { engine?: string } = {}): Promise<void> {
  const engine: WriteEngine = options.engine === 'dom' ? 'dom' : 'debugger';
  const action = engine === 'debugger' ? 'get_current_username_debugger' : 'get_current_username';
  return runCliAction(action, {}, getPort());
}

/**
 * `bnbot x switch <handle>` — explicitly switch the pool window's
 * active X account. The same logic ensureAccount uses internally,
 * exposed as a top-level verb for setup/debugging.
 */
export async function switchAccountCommand(username: string, options: { engine?: string } = {}): Promise<void> {
  const engine: WriteEngine = options.engine === 'dom' ? 'dom' : 'debugger';
  const action = engine === 'debugger' ? 'switch_account_debugger' : 'switch_account';
  return runCliAction(action, { username }, getPort());
}

// ── Scrape ───────────────────────────────────────────────────

export async function scrapeTimelineCommand(options: { limit?: string; scrollAttempts?: string; type?: string; as?: string }): Promise<void> {
  // Timeline / bookmarks / notifications / analytics all read inside
  // the scraper pool window (see scrapers/browser/twitter.ts —
  // `getTab('https://x.com/home')`), which shares cookies with the
  // debugger write path. So `engine: 'debugger'` is the right guard
  // here — switching pool accounts via the SideNav switcher makes
  // the next scrape see the new session.
  await ensureAccount({ expected: options.as, engine: 'debugger', port: getPort() });
  const limit = parseInt(options.limit || '20', 10);
  const scrollAttempts = parseInt(options.scrollAttempts || '5', 10);
  const type = options.type === 'following' ? 'following' : 'for-you';
  console.error(`Scraping timeline (type: ${type}, limit: ${limit})...`);
  return runCliAction('scrape_timeline', { type, limit, scrollAttempts, queryIds: await getXQueryIds() }, getPort());
}

export async function scrapeBookmarksCommand(options: { limit?: string; as?: string }): Promise<void> {
  await ensureAccount({ expected: options.as, engine: 'debugger', port: getPort() });
  const limit = parseInt(options.limit || '20', 10);
  console.error(`Scraping bookmarks (limit: ${limit})...`);
  return runCliAction('scrape_bookmarks', { limit, queryIds: await getXQueryIds() }, getPort());
}

export async function scrapeNotificationsCommand(options: { limit?: string; as?: string }): Promise<void> {
  await ensureAccount({ expected: options.as, engine: 'debugger', port: getPort() });
  const limit = parseInt(options.limit || '40', 10);
  console.error(`Scraping notifications (limit: ${limit})...`);
  return runCliAction('scrape_notifications', { limit }, getPort());
}

export async function scrapeSearchCommand(
  query: string,
  options: {
    tab?: string;
    limit?: string;
    from?: string;
    since?: string;
    until?: string;
    lang?: string;
    minLikes?: string;
    minRetweets?: string;
    has?: string;
  }
): Promise<void> {
  const limit = parseInt(options.limit || '20', 10);
  const tab = options.tab || 'top';
  console.error(`Searching: "${query}" (tab: ${tab}, limit: ${limit})...`);
  const params: Record<string, unknown> = { query, tab, limit };
  if (options.from) params.from = options.from;
  if (options.since) params.since = options.since;
  if (options.until) params.until = options.until;
  if (options.lang) params.lang = options.lang;
  if (options.minLikes) params.minLikes = parseInt(options.minLikes, 10);
  if (options.minRetweets) params.minRetweets = parseInt(options.minRetweets, 10);
  if (options.has) params.has = options.has;
  params.queryIds = await getXQueryIds();
  return runCliAction('scrape_search_results', params, getPort());
}

export async function scrapeUserTweetsCommand(username: string, options: { limit?: string; scrollAttempts?: string }): Promise<void> {
  const limit = parseInt(options.limit || '20', 10);
  const scrollAttempts = parseInt(options.scrollAttempts || '5', 10);
  console.error(`Scraping @${username} tweets (limit: ${limit})...`);
  return runCliAction('scrape_user_tweets', { username, limit, scrollAttempts, queryIds: await getXQueryIds() }, getPort());
}

export async function scrapeUserProfileCommand(username: string): Promise<void> {
  console.error(`Scraping @${username} profile...`);
  return runCliAction('scrape_user_profile', { username, queryIds: await getXQueryIds() }, getPort());
}

export async function scrapeThreadCommand(url: string): Promise<void> {
  console.error(`Scraping thread: ${url}`);
  return runCliAction('scrape_thread', { tweetUrl: url, queryIds: await getXQueryIds() }, getPort());
}

export async function scrapeTrendsCommand(options: { limit?: string }): Promise<void> {
  const limit = parseInt(options.limit || '20', 10);
  console.error(`Scraping X trends (limit: ${limit})...`);
  return runCliAction('scrape_trending', { limit }, getPort());
}

export async function scrapeUserFollowersCommand(username: string, options: { limit?: string }): Promise<void> {
  const limit = parseInt(options.limit || '50', 10);
  console.error(`Scraping @${username} followers (limit: ${limit})...`);
  return runCliAction('scrape_user_followers', { username, limit }, getPort());
}

export async function scrapeUserFollowingCommand(username: string, options: { limit?: string }): Promise<void> {
  const limit = parseInt(options.limit || '50', 10);
  console.error(`Scraping @${username} following (limit: ${limit})...`);
  return runCliAction('scrape_user_following', { username, limit }, getPort());
}

export async function scrapeTweetArticleCommand(url: string): Promise<void> {
  console.error(`Scraping article: ${url}`);
  return runCliAction('scrape_tweet_article', { tweetUrl: url, queryIds: await getXQueryIds() }, getPort());
}

// ── Analytics ────────────────────────────────────────────────

export async function analyticsCommand(options: { as?: string } = {}): Promise<void> {
  await ensureAccount({ expected: options.as, engine: 'debugger', port: getPort() });
  console.error('Fetching analytics...');
  return runCliAction('account_analytics', {}, getPort());
}

// ── Navigation ───────────────────────────────────────────────

export async function navigateUrlCommand(url: string): Promise<void> {
  console.error(`Navigating to: ${url}`);
  // Use the generic navigate_to_url action (matches any URL, not just
  // /status/ tweet URLs). navigate_to_tweet was rejecting profile / home
  // URLs with "无效的推文 URL".
  return runCliAction('navigate_to_url', { url }, getPort());
}

export async function navigateSearchCommand(query: string): Promise<void> {
  console.error(`Navigating to search: ${query}`);
  return runCliAction('navigate_to_search', { query }, getPort());
}

export async function navigateBookmarksCommand(): Promise<void> {
  console.error('Navigating to bookmarks...');
  return runCliAction('navigate_to_bookmarks', {}, getPort());
}

export async function navigateNotificationsCommand(): Promise<void> {
  console.error('Navigating to notifications...');
  return runCliAction('navigate_to_notifications', {}, getPort());
}

// ── Status & Serve ───────────────────────────────────────────

export async function statusCommand(): Promise<void> {
  const WebSocket = (await import('ws')).default;
  const { randomUUID } = await import('crypto');
  const port = getPort();
  const requestId = randomUUID();

  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const timer = setTimeout(() => {
      console.log('');
      console.log('  🦞 BNBot Status');
      console.log('  ─────────────────');
      console.log('  Server    ✗ not running');
      console.log('  Extension ✗ not connected');
      console.log('');
      ws.close();
      resolve();
    }, 5000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'cli_action', requestId, actionType: 'get_extension_status', actionPayload: {} }));
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.requestId === requestId) {
          clearTimeout(timer);
          const d = msg.data || {};
          console.log('');
          console.log('  🦞 BNBot Status');
          console.log('  ─────────────────');
          console.log(`  Server    ${msg.success ? '✓' : '✗'} ws://localhost:${d.wsPort || port}`);
          console.log(`  Extension ${d.connected ? '✓ connected' : '✗ not connected'}${d.extensionVersion ? ` (v${d.extensionVersion})` : ''}`);
          console.log('');
          ws.close();
          resolve();
        }
      } catch {}
    });
    ws.on('error', () => {
      clearTimeout(timer);
      console.log('');
      console.log('  🦞 BNBot Status');
      console.log('  ─────────────────');
      console.log('  Server    ✗ not running');
      console.log('  Extension ✗ not connected');
      console.log('');
      console.log('  Run "bnbot serve" to start the server.');
      console.log('');
      resolve();
    });
  });
}

// ── Content fetching (via extension) ─────────────────────────

export async function fetchWeixinArticleCommand(url: string): Promise<void> {
  console.error(`Fetching WeChat article: ${url}`);
  return runCliAction('fetch_wechat_article', { url }, getPort());
}

// fetchTiktokCommand / fetchXiaohongshuCommand removed —
// fetch_tiktok_video / fetch_xiaohongshu_note were both republish-flow
// orphans; extension no longer hosts the handlers.
