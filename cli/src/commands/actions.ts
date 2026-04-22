/**
 * Commander action handlers for X platform commands.
 *
 * Each handler maps commander arguments/options to the WebSocket action format
 * and uses `runCliAction` from cli.ts to send them to the running server.
 */

import { runCliAction } from '../cli.js';
import { resolveMediaListAsync, resolveMediaListAsPaths } from '../tools/mediaUtils.js';

type WriteEngine = 'dom' | 'debugger';

function normEngine(e?: string): WriteEngine {
  return e === 'debugger' ? 'debugger' : 'dom';
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

export async function postCommand(text: string, options: { media?: string | string[]; draft?: boolean; engine?: string; visible?: boolean }): Promise<void> {
  const isDraft = options.draft || false;
  const engine = normEngine(options.engine);
  const preview = text.slice(0, 80) + (text.length > 80 ? '...' : '');
  console.error(isDraft ? `Drafting: "${preview}"` : `Posting: "${preview}"` + (engine === 'debugger' ? ' [engine=debugger]' : ''));

  // Debugger engine: write actions go through chrome.debugger (CDP). No
  // thread auto-split, no draft mode (X compose/post URL always publishes).
  if (engine === 'debugger') {
    if (isDraft) {
      console.error('[BNBOT] --draft is not supported by --engine debugger yet; use default DOM engine for draft mode.');
      process.exit(1);
    }
    const sources = toSourceList(options.media);
    const mediaPaths = sources.length > 0 ? await resolveMediaListAsPaths(sources) : undefined;
    return runCliAction('post_tweet_debugger', { text, mediaPaths, visible: !!options.visible }, getPort());
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

export async function threadCommand(tweetsJson: string, options: { engine?: string; visible?: boolean } = {}): Promise<void> {
  let tweets: unknown;
  try {
    tweets = JSON.parse(tweetsJson);
  } catch {
    fail('Invalid JSON for thread tweets. Expected: \'[{"text":"..."},{"text":"..."}]\'');
  }
  const engine = normEngine(options.engine);
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

export async function replyCommand(url: string, text: string, options: { media?: string | string[]; engine?: string; visible?: boolean }): Promise<void> {
  const engine = normEngine(options.engine);
  console.error(`Replying to: ${url}` + (engine === 'debugger' ? ' [engine=debugger]' : ''));

  if (engine === 'debugger') {
    const sources = toSourceList(options.media);
    const mediaPaths = sources.length > 0 ? await resolveMediaListAsPaths(sources) : undefined;
    return runCliAction('reply_tweet_debugger', { tweetUrl: url, text, mediaPaths, visible: !!options.visible }, getPort());
  }

  const params: Record<string, unknown> = { tweetUrl: url, text };
  const media = await resolveMedia(options.media);
  if (media) params.media = media;
  return runCliAction('submit_reply', params, getPort());
}

export async function quoteCommand(url: string, text: string, options?: { media?: string | string[]; engine?: string; visible?: boolean }): Promise<void> {
  const engine = normEngine(options?.engine);
  console.error(`Quoting: ${url}` + (engine === 'debugger' ? ' [engine=debugger]' : ''));
  if (engine === 'debugger') {
    const sources = toSourceList(options?.media);
    const mediaPaths = sources.length > 0 ? await resolveMediaListAsPaths(sources) : undefined;
    return runCliAction('quote_tweet_debugger', { tweetUrl: url, text, mediaPaths, visible: !!options?.visible }, getPort());
  }
  return runCliAction('quote_tweet', { tweetUrl: url, text }, getPort());
}

// ── Engagement ───────────────────────────────────────────────

export async function likeCommand(url: string, options?: { engine?: string; visible?: boolean }): Promise<void> {
  const engine = normEngine(options?.engine);
  console.error(`Liking: ${url}` + (engine === 'debugger' ? ' [engine=debugger]' : ''));
  if (engine === 'debugger') {
    return runCliAction('like_tweet_debugger', { tweetUrl: url, visible: !!options?.visible }, getPort());
  }
  return runCliAction('like_tweet', { tweetUrl: url }, getPort());
}

export async function unlikeCommand(url: string, options?: { engine?: string; visible?: boolean }): Promise<void> {
  const engine = normEngine(options?.engine);
  console.error(`Unliking: ${url}` + (engine === 'debugger' ? ' [engine=debugger]' : ''));
  if (engine === 'debugger') {
    return runCliAction('unlike_tweet_debugger', { tweetUrl: url, visible: !!options?.visible }, getPort());
  }
  return runCliAction('unlike_tweet', { tweetUrl: url }, getPort());
}

export async function retweetCommand(url: string, options?: { engine?: string; visible?: boolean }): Promise<void> {
  const engine = normEngine(options?.engine);
  console.error(`Retweeting: ${url}` + (engine === 'debugger' ? ' [engine=debugger]' : ''));
  if (engine === 'debugger') {
    return runCliAction('retweet_debugger', { tweetUrl: url, visible: !!options?.visible }, getPort());
  }
  return runCliAction('retweet', { tweetUrl: url }, getPort());
}

export async function unretweetCommand(url: string, options?: { engine?: string; visible?: boolean }): Promise<void> {
  const engine = normEngine(options?.engine);
  console.error(`Unretweeting: ${url}` + (engine === 'debugger' ? ' [engine=debugger]' : ''));
  if (engine === 'debugger') {
    return runCliAction('unretweet_debugger', { tweetUrl: url, visible: !!options?.visible }, getPort());
  }
  return runCliAction('unretweet', { tweetUrl: url }, getPort());
}

export async function followCommand(username: string): Promise<void> {
  console.error(`Following: @${username}`);
  return runCliAction('follow_user', { username }, getPort());
}

export async function unfollowCommand(username: string): Promise<void> {
  console.error(`Unfollowing: @${username}`);
  return runCliAction('unfollow_user', { username }, getPort());
}

export async function deleteCommand(url: string, options: { engine?: string; visible?: boolean } = {}): Promise<void> {
  const engine = normEngine(options.engine);
  console.error(`Deleting: ${url}` + (engine === 'debugger' ? ' [engine=debugger]' : ''));
  if (engine === 'debugger') {
    return runCliAction('delete_tweet_debugger', { tweetUrl: url, visible: !!options.visible }, getPort());
  }
  return runCliAction('delete_tweet', { tweetUrl: url }, getPort());
}

export async function bookmarkCommand(url: string): Promise<void> {
  console.error(`Bookmarking: ${url}`);
  return runCliAction('bookmark_tweet', { tweetUrl: url }, getPort());
}

export async function unbookmarkCommand(url: string): Promise<void> {
  console.error(`Unbookmarking: ${url}`);
  return runCliAction('unbookmark_tweet', { tweetUrl: url }, getPort());
}

// ── Scrape ───────────────────────────────────────────────────

export async function scrapeTimelineCommand(options: { limit?: string; scrollAttempts?: string; type?: string }): Promise<void> {
  const limit = parseInt(options.limit || '20', 10);
  const scrollAttempts = parseInt(options.scrollAttempts || '5', 10);
  const type = options.type === 'following' ? 'following' : 'for-you';
  console.error(`Scraping timeline (type: ${type}, limit: ${limit})...`);
  return runCliAction('scrape_timeline', { type, limit, scrollAttempts }, getPort());
}

export async function scrapeBookmarksCommand(options: { limit?: string }): Promise<void> {
  const limit = parseInt(options.limit || '20', 10);
  console.error(`Scraping bookmarks (limit: ${limit})...`);
  return runCliAction('scrape_bookmarks', { limit }, getPort());
}

export async function scrapeNotificationsCommand(options: { limit?: string }): Promise<void> {
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
  return runCliAction('scrape_search_results', params, getPort());
}

export async function scrapeUserTweetsCommand(username: string, options: { limit?: string; scrollAttempts?: string }): Promise<void> {
  const limit = parseInt(options.limit || '20', 10);
  const scrollAttempts = parseInt(options.scrollAttempts || '5', 10);
  console.error(`Scraping @${username} tweets (limit: ${limit})...`);
  return runCliAction('scrape_user_tweets', { username, limit, scrollAttempts }, getPort());
}

export async function scrapeUserProfileCommand(username: string): Promise<void> {
  console.error(`Scraping @${username} profile...`);
  return runCliAction('scrape_user_profile', { username }, getPort());
}

export async function scrapeThreadCommand(url: string): Promise<void> {
  console.error(`Scraping thread: ${url}`);
  return runCliAction('scrape_thread', { tweetUrl: url }, getPort());
}

// ── Analytics ────────────────────────────────────────────────

export async function analyticsCommand(): Promise<void> {
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

// fetchTiktokCommand removed — fetch_tiktok_video orphan was the
// republish flow, no extension handler left.

export async function fetchXiaohongshuCommand(url: string): Promise<void> {
  console.error(`Fetching Xiaohongshu: ${url}`);
  return runCliAction('fetch_xiaohongshu_note', { url }, getPort());
}
