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
  // Account (multi-account guard helpers)
  'get-current-username': 'get_current_username',
  'switch-account': 'switch_account',
  // Content
  'fetch-wechat-article': 'fetch_wechat_article',
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
 * Result shape returned by the silent `sendAction` kernel. Mirrors the
 * extension's `action_result` envelope minus the WS plumbing fields.
 */
export interface ActionResult<T = Record<string, unknown>> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Silent RPC kernel — open a one-shot WS, send a `cli_action`, return
 * the structured result. Does NOT print, does NOT exit. The verbose
 * shell `runCliAction` wraps this for the human-facing path; internal
 * callers (e.g. `accountGuard.ensureAccount`) use this directly so they
 * can interpret the result without polluting stdout.
 *
 * Server auto-spawn lives in `ensureServer` and is called once per
 * action — cheap when the daemon is already up.
 */
export async function sendAction<T = Record<string, unknown>>(
  actionType: string,
  params: Record<string, unknown>,
  port: number,
): Promise<ActionResult<T>> {
  await ensureServer(port);

  // Check auth status for write actions
  const writeActions = [
    'post_tweet', 'post_thread', 'submit_reply', 'quote_tweet',
    'like_tweet', 'unlike_tweet', 'retweet', 'unretweet',
    'follow_user', 'unfollow_user', 'delete_tweet',
    'bookmark_tweet', 'unbookmark_tweet',
    'inject_auth_tokens',
  ];

  if (writeActions.includes(actionType)) {
    try {
      const authRes = await fetch(`http://127.0.0.1:${port}/auth/status`);
      if (authRes.ok) {
        const authStatus = await authRes.json() as { valid: boolean };
        if (!authStatus.valid) {
          return {
            success: false,
            error: 'Authentication required. Run `bnbot login` first.',
          };
        }
      }
    } catch {
      // If we can't check auth status, proceed anyway
      // The extension will reject unauthenticated actions
    }
  }

  return new Promise<ActionResult<T>>((resolve) => {
    const url = `ws://127.0.0.1:${port}`;
    const requestId = randomUUID();

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      resolve({ success: false, error: `Failed to connect to ${url}: ${(err as Error).message}` });
      return;
    }

    let settled = false;
    const finish = (r: ActionResult<T>) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* already closed */ }
      resolve(r);
    };

    const timeout = setTimeout(() => {
      finish({ success: false, error: `Timeout: no response within ${CLI_TIMEOUT / 1000}s` });
    }, CLI_TIMEOUT);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'cli_action',
        requestId,
        actionType,
        actionPayload: params,
      }));
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.requestId !== requestId || msg.type !== 'action_result') return;
        clearTimeout(timeout);
        if (msg.success) {
          finish({ success: true, data: (msg.data ?? {}) as T });
        } else {
          finish({ success: false, error: msg.error || 'Action failed' });
        }
      } catch {
        // Non-JSON noise on the channel — ignore.
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      finish({
        success: false,
        error: `Connection error: ${err.message}. Try "bnbot serve" first.`,
      });
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      // Same "silent-close bug" defence as before: if the socket
      // closed without ever delivering a result, surface that as a
      // failure instead of letting the promise hang.
      finish({
        success: false,
        error:
          'Server closed connection before sending a result. ' +
          'Try: bnbot status, or restart with pkill -f "bnbot.*serve" && bnbot serve',
      });
    });
  });
}

/**
 * Verbose shell — used by every Commander action handler. Calls the
 * silent kernel above, then prints JSON / errors to stdout/stderr and
 * `process.exit`s with the right code. This is the long-standing
 * contract callers (shell scripts, launchd wrappers, the agent) expect.
 */
export async function runCliAction(actionType: string, params: Record<string, unknown>, port: number): Promise<void> {
  const r = await sendAction(actionType, params, port);
  if (r.success) {
    // Enrich tweetId-only results with a clickable URL, identical to
    // the pre-refactor behavior. Primary consumer is the bnbot agent,
    // which surfaces this JSON verbatim to humans — a bare id is
    // useless, `https://x.com/i/status/<id>` opens the post.
    const data = (r.data ?? {}) as Record<string, unknown>;
    const tweetId = typeof data.tweetId === 'string' ? data.tweetId : null;
    if (tweetId && !data.url && !data.tweetUrl) {
      data.tweetUrl = `https://x.com/i/status/${tweetId}`;
    }
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
  } else {
    console.error(r.error || 'Action failed');
    process.exit(1);
  }
}
