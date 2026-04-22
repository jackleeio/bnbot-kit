/**
 * CLI Client - Connect to a running BNBot WebSocket server and send a tool command.
 *
 * Usage:
 *   bnbot <tool-name> [--param value ...]
 *
 * Example:
 *   bnbot get-extension-status
 *   bnbot scrape-timeline --limit 10 --scrollAttempts 3
 *   bnbot post-tweet --text "Hello world"
 *   bnbot navigate-to-search --query "AI agents"
 */

import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { resolveMediaListAsync } from './tools/mediaUtils.js';

const DEFAULT_PORT = 18900;
const CLI_TIMEOUT = 300000; // 5 min — covers debugger write actions with video transcode

/**
 * Map of CLI tool names (kebab-case) to WebSocket action types (snake_case).
 * Also serves as the canonical list of supported CLI tools.
 */
const TOOL_MAP: Record<string, string> = {
  // Status
  'get-extension-status': 'get_extension_status',
  'get-current-page-info': 'get_current_url',
  // Scrape
  'scrape-timeline': 'scrape_timeline',
  'scrape-bookmarks': 'scrape_bookmarks',
  'scrape-search-results': 'scrape_search_results',
  'scrape-current-view': 'scrape_current_view',
  'scrape-thread': 'scrape_thread',
  'scrape-user-profile': 'scrape_user_profile',
  'scrape-user-tweets': 'scrape_user_tweets',
  'account-analytics': 'account_analytics',
  // Tweet
  'post-tweet': 'post_tweet',
  'post-thread': 'post_thread',
  'submit-reply': 'submit_reply',
  'quote-tweet': 'quote_tweet',
  // Engagement
  'like-tweet': 'like_tweet',
  'unlike-tweet': 'unlike_tweet',
  'retweet': 'retweet',
  'unretweet': 'unretweet',
  'follow-user': 'follow_user',
  'unfollow-user': 'unfollow_user',
  'delete-tweet': 'delete_tweet',
  'bookmark-tweet': 'bookmark_tweet',
  'unbookmark-tweet': 'unbookmark_tweet',
  // Navigation
  'navigate-to-tweet': 'navigate_to_tweet',
  'navigate-to-search': 'navigate_to_search',
  'navigate-to-bookmarks': 'navigate_to_bookmarks',
  'navigate-to-notifications': 'navigate_to_notifications',
  'navigate-to-following': 'navigate_to_following',
  'return-to-timeline': 'return_to_timeline',
  // Content
  'fetch-wechat-article': 'fetch_wechat_article',
  'fetch-xiaohongshu-note': 'fetch_xiaohongshu_note',
  // Article
  'open-article-editor': 'open_article_editor',
  'fill-article-title': 'fill_article_title',
  'fill-article-body': 'fill_article_body',
  'upload-article-header-image': 'upload_article_header_image',
  'publish-article': 'publish_article',
  'create-article': 'create_article',
};

/** All known CLI tool names */
export const CLI_TOOL_NAMES = Object.keys(TOOL_MAP);

/**
 * Parse CLI flags into a params object.
 * Supports: --key value, --boolFlag (no value => true), --key 123 (auto-number).
 */
function parseArgs(argv: string[]): { port: number; params: Record<string, unknown> } {
  let port = DEFAULT_PORT;
  const params: Record<string, unknown> = {};

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--port' && argv[i + 1]) {
      port = parseInt(argv[i + 1], 10) || DEFAULT_PORT;
      i += 2;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      // If next arg is missing or is another flag, treat as boolean true
      if (!next || next.startsWith('--')) {
        params[key] = true;
        i += 1;
      } else {
        let value: unknown;
        const num = Number(next);
        if (!isNaN(num) && next.trim() !== '') {
          value = num;
        } else if (next === 'true') {
          value = true;
        } else if (next === 'false') {
          value = false;
        } else {
          value = next;
        }
        // Collect repeated keys (e.g. --media a --media b) into arrays
        if (params[key] !== undefined) {
          if (Array.isArray(params[key])) {
            (params[key] as unknown[]).push(value);
          } else {
            params[key] = [params[key], value];
          }
        } else {
          params[key] = value;
        }
        i += 2;
      }
    } else {
      i += 1;
    }
  }

  return { port, params };
}

/**
 * Run a CLI tool command by connecting to the WS server as a client.
 */
export async function runCliTool(toolName: string, argv: string[]): Promise<void> {
  const actionType = TOOL_MAP[toolName];
  if (!actionType) {
    console.error(`Unknown tool: ${toolName}`);
    console.error(`Run "bnbot --help" to see available tools.`);
    process.exit(1);
  }

  const { port, params } = parseArgs(argv);

  // Resolve media files/URLs to base64 data URLs before sending
  if (params.media || params.images) {
    const raw = params.media || params.images;
    // Normalize to flat string array: supports --media a --media b, --media a,b, or --media a
    const mediaSources: string[] = (Array.isArray(raw) ? raw : [raw])
      .flatMap((s: unknown) => String(s).split(','))
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
    try {
      params.media = await resolveMediaListAsync(mediaSources);
    } catch (e: any) {
      console.error(`Failed to process media: ${e.message}`);
      process.exit(1);
    }
    delete params.images;
  }

  // Auto-split into thread when post-tweet has >4 media (Twitter limit: 4 per tweet)
  const MAX_MEDIA_PER_TWEET = 4;
  const resolvedMedia = params.media as Array<{ type: string; url: string }> | undefined;
  if (toolName === 'post-tweet' && resolvedMedia && resolvedMedia.length > MAX_MEDIA_PER_TWEET) {
    const text = String(params.text || '');
    const draftOnly = params.draftOnly;
    const tweets: Array<{ text: string; media: Array<{ type: string; url: string }> }> = [];

    for (let i = 0; i < resolvedMedia.length; i += MAX_MEDIA_PER_TWEET) {
      const chunk = resolvedMedia.slice(i, i + MAX_MEDIA_PER_TWEET);
      tweets.push({
        text: i === 0 ? text : `(${Math.floor(i / MAX_MEDIA_PER_TWEET) + 1}/${Math.ceil(resolvedMedia.length / MAX_MEDIA_PER_TWEET)})`,
        media: chunk,
      });
    }

    // Switch to post_thread action
    console.error(`[BNBOT] ${resolvedMedia.length} media files detected, auto-splitting into ${tweets.length}-tweet thread`);
    params.tweets = tweets;
    params.draftOnly = draftOnly;
    delete params.text;
    delete params.media;
    // Override action type to post_thread
    return runCliAction('post_thread', params, port);
  }

  return runCliAction(actionType, params, port);
}

/**
 * Auto-start bnbot serve if not running.
 */
export async function ensureServer(port: number): Promise<void> {
  const alive = await new Promise<boolean>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const t = setTimeout(() => { ws.close(); resolve(false); }, 1000);
    ws.on('open', () => { clearTimeout(t); ws.close(); resolve(true); });
    ws.on('error', () => { clearTimeout(t); resolve(false); });
  });
  if (alive) return;

  // Start server in background
  const { spawn } = await import('child_process');
  const child = spawn(process.execPath, [process.argv[1], 'serve', '--port', String(port)], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  console.error('[BNBOT] Starting server in background...');

  // Wait for server to be ready (up to 10s)
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const ok = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      const t = setTimeout(() => { ws.close(); resolve(false); }, 500);
      ws.on('open', () => { clearTimeout(t); ws.close(); resolve(true); });
      ws.on('error', () => { clearTimeout(t); resolve(false); });
    });
    if (ok) return;
  }
  console.error('[BNBOT] Server started. Waiting for extension connection...');
}

/**
 * Send an action to the WS server and print the result.
 * Auto-starts server if not running.
 */
export async function runCliAction(actionType: string, params: Record<string, unknown>, port: number): Promise<void> {
  await ensureServer(port);

  return new Promise((resolve) => {
    const url = `ws://127.0.0.1:${port}`;
    const requestId = randomUUID();

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      console.error(`Failed to connect to BNBot server at ${url}`);
      process.exit(1);
      return;
    }

    const timeout = setTimeout(() => {
      console.error(`Timeout: no response within ${CLI_TIMEOUT / 1000}s`);
      ws.close();
      process.exit(1);
    }, CLI_TIMEOUT);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'cli_action',
        requestId,
        actionType,
        actionPayload: params,
      }));
    });

    // Tracks whether we received a complete action_result before the
    // socket closed. Without this, a server-side silent close (socket
    // ends before any result is delivered) would fall through to the
    // 'close' handler and exit 0 with no output — causing scheduled
    // wrappers to falsely assume success ("silent-close bug").
    let resolved = false;

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.requestId === requestId && msg.type === 'action_result') {
          clearTimeout(timeout);
          resolved = true;
          if (msg.success) {
            console.log(JSON.stringify(msg.data, null, 2));
          } else {
            console.error(msg.error || 'Action failed');
          }
          ws.close();
          process.exit(msg.success ? 0 : 1);
        }
      } catch {
        // Ignore non-JSON messages
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      resolved = true;
      console.error(`Connection error: ${err.message}`);
      console.error('Make sure "bnbot serve" is running first.');
      process.exit(1);
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      if (!resolved) {
        // Socket closed without any action_result. This is an abnormal
        // close (server crashed mid-request, extension reconnect while
        // waiting, etc). Exit 1 with a clear error so callers (shell
        // scripts, launchd wrappers) don't mistake it for success.
        console.error('Server closed connection before sending a result');
        console.error('Try: bnbot status, or restart with pkill -f "bnbot.*serve" && bnbot serve');
        process.exit(1);
      }
      resolve();
    });
  });
}
