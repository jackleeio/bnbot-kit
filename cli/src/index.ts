#!/usr/bin/env node

/**
 * BNBot CLI — Control Twitter/X and scrape public data sources.
 *
 * Usage:
 *   bnbot setup                     # One-command install
 *   bnbot login                     # Login to BNBot
 *   bnbot serve                     # Start WebSocket server
 *   bnbot status                    # Check extension connection
 *   bnbot x post "Hello"            # Post a tweet
 *   bnbot x scrape timeline         # Scrape timeline
 *   bnbot hackernews search "AI"    # Public data scraper
 *   bnbot post-tweet --text "Hi"    # Legacy kebab-case (backward compat)
 */

import { Command } from 'commander';

// Collect `-m` / `--media` into an array without greedy variadic parsing.
// Variadic `<url...>` consumes positional args (so `--media img.png <url>
// <text>` ate the tweet URL). Repeat the flag instead: `-m a -m b`.
const collectMedia = (val: string, prev: string[] = []): string[] => [...prev, val];
import { BnbotWsServer } from './wsServer.js';
import { CLI_TOOL_NAMES, runCliTool } from './cli.js';
import { PUBLIC_SCRAPER_NAMES, runPublicScraper } from './publicScrapers.js';
import {
  postCommand,
  closeCommand,
  threadCommand,
  replyCommand,
  quoteCommand,
  likeCommand,
  unlikeCommand,
  retweetCommand,
  unretweetCommand,
  followCommand,
  unfollowCommand,
  deleteCommand,
  bookmarkCommand,
  unbookmarkCommand,
  scrapeTimelineCommand,
  scrapeBookmarksCommand,
  scrapeNotificationsCommand,
  scrapeSearchCommand,
  scrapeUserTweetsCommand,
  scrapeUserProfileCommand,
  scrapeThreadCommand,
  analyticsCommand,
  navigateUrlCommand,
  navigateSearchCommand,
  navigateBookmarksCommand,
  navigateNotificationsCommand,
  statusCommand,
  fetchWeixinArticleCommand,
  whoamiCommand,
  switchAccountCommand,
} from './commands/actions.js';
import { screenshotCommand } from './commands/screenshot.js';
import { downloadCommand } from './commands/download.js';
import { debugEvalCommand, debugUploadCommand, debugClickCommand, debugShowCommand, debugDragCommand, debugRecordCommand } from './commands/debug.js';
import { xhsPostCommand, xhsStatsNoteCommand, xhsStatsAccountCommand } from './commands/xhs.js';
import { wxmpPostCommand } from './commands/wxmp.js';
import { tiktokPostCommand } from './commands/tiktok.js';
import { kuaishouPostCommand } from './commands/kuaishou.js';
import { douyinPostCommand } from './commands/douyin.js';
import { wxchannelsPostCommand } from './commands/wxchannels.js';
import {
  tiktokSearchCommand, tiktokExploreCommand, tiktokProfileCommand,
  tiktokUserPostsCommand, tiktokUserFollowersCommand, tiktokPostDetailCommand,
  tiktokPostCommentsCommand, tiktokSearchAccountCommand,
  // TikTok Wave 2/3/4
  tiktokChallengeInfoCommand, tiktokChallengePostsCommand,
  tiktokMusicInfoCommand, tiktokMusicPostsCommand, tiktokMusicUnlimitedSoundsCommand,
  tiktokUserInfoRegionCommand, tiktokUserInfoByIdCommand,
  tiktokUserFollowingsCommand, tiktokUserLikedPostsCommand,
  tiktokUserPlaylistCommand, tiktokUserRepostCommand, tiktokUserStoryCommand,
  tiktokSearchGeneralCommand, tiktokSearchLiveCommand, tiktokSearchSuggestionsCommand,
  tiktokPostRelatedCommand, tiktokPostExploreCommand, tiktokPostDiscoverCommand,
  // TikTok Wave 5 (Creative Center / ads.tiktok.com)
  tiktokAdsDetailCommand, tiktokAdsTopCommand,
  tiktokTrendingCreatorCommand, tiktokTrendingVideoCommand, tiktokTrendingHashtagCommand,
  tiktokTrendingSongCommand, tiktokTrendingKeywordCommand,
  tiktokTrendingKeywordPostsCommand, tiktokTrendingKeywordSentenceCommand,
  tiktokCommercialMusicCommand, tiktokCommercialPlaylistsCommand,
  tiktokCommercialPlaylistDetailCommand,
  tiktokTopProductsCommand, tiktokTopProductDetailCommand, tiktokTopProductMetricsCommand,
  // TikTok Wave 6 (long-tail)
  tiktokPlaceInfoCommand, tiktokPlacePostsCommand,
  tiktokEffectInfoCommand, tiktokEffectPostsCommand,
  tiktokCollectionInfoCommand, tiktokCollectionPostsCommand,
  tiktokPostCommentRepliesCommand,
  youtubeSearchCommand, youtubeVideoCommand, youtubeTranscriptCommand,
  youtubeChannelDetailsCommand, youtubeChannelVideosCommand, youtubeTrendingCommand,
  youtubeChannelSearchCommand, youtubeStreamingDataCommand, youtubeRelatedCommand,
  youtubeCommentsCommand,
  redditSearchCommand, redditHotCommand,
  bilibiliSearchCommand, bilibiliHotCommand, bilibiliRankingCommand,
  zhihuSearchCommand, zhihuHotCommand,
  xueqiuSearchCommand, xueqiuHotCommand,
  instagramSearchCommand, instagramExploreCommand,
  linuxdoSearchCommand, jikeSearchCommand,
  xiaohongshuSearchCommand,
  weiboSearchCommand, weiboHotCommand,
  doubanSearchCommand, doubanMovieHotCommand, doubanBookHotCommand, doubanTop250Command,
  mediumSearchCommand,
  googleSearchCommand, googleNewsCommand,
  facebookSearchCommand,
  linkedinSearchCommand,
  kr36SearchCommand, kr36HotCommand, kr36NewsCommand,
  producthuntHotCommand,
  yahooFinanceQuoteCommand,
} from './commands/scraperActions.js';

const DEFAULT_PORT = 18900;

// ── Serve command ────────────────────────────────────────────

async function runServe(port: number): Promise<void> {
  const wsServer = new BnbotWsServer(port);
  try {
    await wsServer.start();
  } catch (err) {
    console.error('[BNBOT] Failed to start WebSocket server:', err);
    process.exit(1);
  }
  console.error(`[BNBOT] WebSocket server running on ws://localhost:${port}`);
  console.error('[BNBOT] Waiting for extension connection...');

  const shutdown = () => {
    console.error('[BNBOT] Shutting down...');
    wsServer.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ── Build commander program ──────────────────────────────────

function buildProgram(): Command {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkg = require('../package.json');

  const program = new Command();
  program
    .name('bnbot')
    .description('BNBot - AI Growth Agent for social platforms')
    .version(pkg.version);
  // Active diagnostics on typo'd verbs / flags. The primary caller of
  // this CLI is now the bnbot agent (an LLM), and LLMs hallucinate
  // command names like `tiktok trending` (real verb is `explore`) or
  // unsupported flags like `--json` (output is already JSON by default).
  // Without these settings the agent gets a bare `error: unknown
  // command 'trending'` and has to spend an extra turn running `--help`
  // to discover the actual verb. With `showHelpAfterError(true)` the
  // help text (including the list of available subcommands) gets dumped
  // right after the error, so the model can self-correct in a single
  // turn. Commander only applies these settings to the Command they're
  // configured on — not to nested children — so we monkey-patch every
  // newly-created Command to inherit them.
  const origCommand = program.command.bind(program);
  function applyFriendlyDiagnostics(cmd: Command): Command {
    cmd.showSuggestionAfterError(true);
    cmd.showHelpAfterError(true);
    const origNested = cmd.command.bind(cmd);
    cmd.command = ((...args: Parameters<typeof origNested>) => {
      const child = origNested(...args);
      // `command()` returns either the new sub-command or the parent
      // (for executable subcommand specs). Only augment Commands.
      if (child instanceof Command && child !== cmd) {
        applyFriendlyDiagnostics(child);
      }
      return child;
    }) as typeof cmd.command;
    return cmd;
  }
  applyFriendlyDiagnostics(program);
  program.command = ((...args: Parameters<typeof origCommand>) => {
    const child = origCommand(...args);
    if (child instanceof Command && child !== program) {
      applyFriendlyDiagnostics(child);
    }
    return child;
  }) as typeof program.command;

  // ── Top-level: setup, login, serve, status ─────────────

  program
    .command('setup')
    .description('One-command install (CLI + Claude skill)')
    .action(async () => {
      const { runSetup } = await import('./setup.js');
      await runSetup();
    });

  program
    .command('login')
    .description('Login to BNBot')
    .option('--email <email>', 'Email for login')
    .option('--port <port>', 'WebSocket port', String(DEFAULT_PORT))
    .action(async (options) => {
      const { runLogin } = await import('./auth.js');
      // Reconstruct argv for runLogin
      const args: string[] = [];
      if (options.email) { args.push('--email', options.email); }
      if (options.port) { args.push('--port', options.port); }
      await runLogin(args);
    });

  program
    .command('serve')
    .description('Start WebSocket server')
    .option('-p, --port <port>', 'WebSocket port', String(DEFAULT_PORT))
    .action(async (options) => {
      const port = parseInt(options.port, 10) || DEFAULT_PORT;
      await runServe(port);
    });

  program
    .command('status')
    .description('Check extension connection status')
    .action(statusCommand);

  // ── Screenshot (any tab, any URL) ──────────────────────
  program
    .command('screenshot')
    .description('Capture a PNG of a Chrome tab via CDP (focused tab by default)')
    .option('--url <url>', 'Capture a tab matching this URL (opens one if not open)')
    .option('--tab-id <id>', 'Capture the tab with this exact chrome tab id')
    .option('-o, --output <path>', 'Output PNG path (default /tmp/bnbot-screenshot-<ts>.png; use `-` for base64 on stdout)')
    .option('--full-page', 'Capture beyond the viewport (full scrollable height)')
    .action(screenshotCommand);

  // ── Download (yt-dlp thin wrapper, any platform yt-dlp supports) ────
  program
    .command('download <url>')
    .description('Download a video (or note) from TikTok / YouTube / XHS / IG / Bili / 抖音 / 微博 etc. via yt-dlp')
    .option('-o, --output <path>', 'Output file path or directory (default ~/.bnbot/downloads/<id>.<ext>)')
    .option('--format <kind>', 'video | audio (default video, best mp4; audio extracts m4a)')
    .option('--info', 'Print metadata JSON only, do not download')
    .action(downloadCommand);

  // ── Debug helpers (CDP-level, for probing new platforms) ───
  const debug = program.command('debug').description('Low-level CDP helpers (dev / exploration)');
  debug
    .command('eval <expression>')
    .description('Run JS in a scraper pool tab via CDP Runtime.evaluate; prints the return value as JSON')
    .option('--tab-id <id>', 'Target a specific chrome tab id')
    .option('--host <hostname>', 'Target the pool tab for this host (e.g. creator.xiaohongshu.com)')
    .option('--await-promise', 'Await if the expression returns a Promise')
    .action(debugEvalCommand);
  debug
    .command('upload <selector> <files...>')
    .description('Inject local file(s) into a file input via CDP DOM.setFileInputFiles')
    .option('--tab-id <id>', 'Target a specific chrome tab id')
    .option('--host <hostname>', 'Target the pool tab for this host')
    .action(debugUploadCommand);
  debug
    .command('click <selector>')
    .description('Click an element via CDP Input.dispatchMouseEvent (trusted event — opens popovers that reject synthetic clicks)')
    .option('--tab-id <id>', 'Target a specific chrome tab id')
    .option('--host <hostname>', 'Target the pool tab for this host')
    .action(debugClickCommand);
  debug
    .command('show')
    .description('Un-minimize the pool tab window (pool windows are minimized by default — use during probing)')
    .option('--tab-id <id>', 'Target a specific chrome tab id')
    .option('--host <hostname>', 'Target the pool tab for this host')
    .action(debugShowCommand);
  debug
    .command('drag <fromSelector> <toSelector>')
    .description('Drag one element onto another via CDP mouse events (sortable-style reorder, etc.)')
    .option('--tab-id <id>', 'Target a specific chrome tab id')
    .option('--host <hostname>', 'Target the pool tab for this host')
    .option('--steps <n>', 'Number of interpolated mouseMoved steps (default 20)')
    .action(debugDragCommand);

  debug
    .command('record <url>')
    .description('Navigate + capture all fetch/XHR API responses (use to mirror third-party SaaS backends)')
    .option('--duration <seconds>', 'How long to capture after navigate', '20')
    .option('--out <path>', 'Write captures to this JSON file (default stdout)')
    .option('--host <hostname>', 'Target the pool tab for this host')
    .option('--tab-id <id>', 'Target a specific chrome tab id')
    .option('--filter <regex>', 'URL filter regex (default: /api/|graphql)')
    .option('--scroll', 'Auto-scroll the page to trigger lazy-load feeds')
    .action(debugRecordCommand);

  // ── Xiaohongshu ────────────────────────────────────────
  // One-shot compose + optional publish. Plan JSON shape in
  // cli/src/commands/xhs.ts. Replaces the ~10-call debug walk with a
  // single WS round-trip (~3-5s vs ~20s).
  // Top-level `navigate` — open ANY URL in a scraper pool window. Not
  // X-specific despite `bnbot x navigate url` also existing (that's
  // kept for backwards compat). New tabs land as the active tab in the
  // minimized scraper window, so Dock → click gives you the URL.
  program
    .command('navigate <url>')
    .alias('open')
    .description('Open any URL in the bnbot scraper window (in the background, becomes the active tab)')
    .action(navigateUrlCommand);

  const xhs = program.command('xhs').description('Xiaohongshu (creator.xiaohongshu.com) automation');
  xhs
    .command('post')
    .description('Compose (and optionally publish) an image-text XHS note from a JSON plan')
    .argument(
      '[plan-json-or-path]',
      'Plan as inline JSON (e.g. \'{"title":...,"body":...}\'), OR a path to a JSON file, OR "-" for stdin. Defaults to stdin if omitted.',
    )
    .option('--plan <path>', 'Alias for the positional arg — path to plan JSON, or `-` for stdin', '-')
    .option('--publish', 'Actually click 发布 at the end (default: stop after compose)')
    .option(
      '--mark-md <path>',
      'On a successful publish, flip the `status:` frontmatter of this draft .md to `published`. Use it whenever the plan came from a saved draft so the desktop calendar card updates SCHEDULED → PUBLISHED.',
    )
    .action(
      (
        arg: string | undefined,
        opts: { plan?: string; publish?: boolean; markMd?: string },
      ) => {
        // Three input shapes accepted (in priority order):
        //   1. Positional inline JSON (starts with '{')  — convenient one-shot
        //   2. Positional path to a .json file
        //   3. --plan <path> (or '-' for stdin), kept for back-compat
        const planSource =
          arg && arg.trim().startsWith('{') ? { inline: arg } : { plan: arg ?? opts.plan ?? '-' }
        return xhsPostCommand({
          ...planSource,
          publish: opts.publish,
          markMd: opts.markMd,
        })
      },
    );

  xhs
    .command('stats-note')
    .description('Fetch per-note analytics (exposure/views/click rate/watch time/interactions) for a given noteId')
    .argument('<noteId>', '24-char hex XHS note id')
    .action(xhsStatsNoteCommand);

  xhs
    .command('stats-account')
    .description('Fetch account-level analytics (4 tabs: 观看/互动/涨粉/发布 for current period)')
    .action(xhsStatsAccountCommand);

  // (Scheduling moved to the bnbot main repo: it's an orchestration
  // concern, not a social-platform action. The auto-publish loop now
  // lives in `bnbot/src/services/autoPublish/` and runs inside the
  // bnbot WS server's 5-min interval. The kit stays scope: read +
  // write social platforms.)

  // (Inbox auto-respond loop moved to the bnbot main repo too — same
  // architectural reason as calendar. The kit still owns the scrape
  // itself: `scrape_notifications` action handler in `bnbot serve` is
  // what bnbot's inbox loop calls over WS to read fresh notifications.)

  // (`bnbot draft *` removed — server-side Buffer-clone scheduler that
  // wasn't used by the bnbot agent. The auto-publish loop in bnbot main
  // covers scheduling now.)

  // ── X platform commands ────────────────────────────────

  const x = program
    .command('x')
    .description('X (Twitter) platform commands');

  // Shared --as description (avoid drift across commands).
  const AS_HELP = 'Expected active X handle (no leading @). Verified / switched before the action when `multiAccount: true` is set in ~/.bnbot/settings.json; ignored otherwise. Refuses to act on a mismatched account.';

  // x post
  x.command('post <text>')
    .description('Post a tweet')
    .option('-m, --media <url>', 'Media file or URL (repeat for multiple, or comma-separate)', collectMedia, [])
    .option('-d, --draft', 'Draft mode: fill composer without posting. Pool window stays foregrounded for audit; click Post yourself or `bnbot x close` to discard.')
    .option('--engine <engine>', 'Write engine: "debugger" (default — CDP, isolated pool window, robust against X UI churn) or "dom" (legacy, content-script in your active x.com tab).', 'debugger')
    .option('--visible', 'Open the automation tab in foreground (debug engine only)')
    .option('--as <handle>', AS_HELP)
    .action(postCommand);

  // x close
  x.command('close')
    .description('Close tweet composer')
    .option('-s, --save', 'Save as draft instead of discarding')
    .action(closeCommand);

  // x thread
  x.command('thread <tweets-json>')
    .description('Post a tweet thread (JSON array)')
    .option('--engine <engine>', 'Write engine: "debugger" (default, CDP) or "dom" (content-script)', 'debugger')
    .option('--visible', 'Bring the automation window to front during the action')
    .option('--as <handle>', AS_HELP)
    .action(threadCommand);

  // x reply
  x.command('reply <url> <text>')
    .description('Reply to a tweet')
    .option('-m, --media <url>', 'Media file or URL (repeat for multiple, or comma-separate)', collectMedia, [])
    .option('-d, --draft', 'Draft mode: fill reply composer + attach media without posting. Pool window stays foregrounded for audit; click Reply yourself or `bnbot x close` to discard.')
    .option('--engine <engine>', 'Write engine: "debugger" (CDP, default — robust against X UI churn) or "dom" (content-script, fallback for --draft)', 'debugger')
    .option('--visible', 'Open the automation tab in foreground (debug engine only)')
    .option('--as <handle>', AS_HELP)
    .action(replyCommand);

  // x quote
  x.command('quote <url> <text>')
    .description('Quote a tweet')
    .option('-m, --media <url>', 'Media file or URL (repeat for multiple, or comma-separate)', collectMedia, [])
    .option('-d, --draft', 'Draft mode: fill composer + attach quote without posting. Pool window stays foregrounded for audit; click Post yourself or `bnbot x close` to discard.')
    .option('--engine <engine>', 'Write engine: "debugger" (default) or "dom"', 'debugger')
    .option('--visible', 'Open the automation tab in foreground (debug engine only)')
    .option('--as <handle>', AS_HELP)
    .action(quoteCommand);

  // x like / unlike
  x.command('like <url>')
    .description('Like a tweet')
    .option('--engine <engine>', 'Write engine: "debugger" (default) or "dom"', 'debugger')
    .option('--visible', 'Open the automation tab in foreground (debug engine only)')
    .option('--as <handle>', AS_HELP)
    .action(likeCommand);

  x.command('unlike <url>')
    .description('Unlike a tweet')
    .option('--engine <engine>', 'Write engine: "debugger" (default) or "dom"', 'debugger')
    .option('--visible', 'Open the automation tab in foreground (debug engine only)')
    .option('--as <handle>', AS_HELP)
    .action(unlikeCommand);

  // x retweet / unretweet
  x.command('retweet <url>')
    .description('Retweet a tweet')
    .option('--engine <engine>', 'Write engine: "debugger" (default) or "dom"', 'debugger')
    .option('--visible', 'Open the automation tab in foreground (debug engine only)')
    .option('--as <handle>', AS_HELP)
    .action(retweetCommand);

  x.command('unretweet <url>')
    .description('Unretweet a tweet')
    .option('--engine <engine>', 'Write engine: "debugger" (default) or "dom"', 'debugger')
    .option('--visible', 'Open the automation tab in foreground (debug engine only)')
    .option('--as <handle>', AS_HELP)
    .action(unretweetCommand);

  // x follow / unfollow
  x.command('follow <username>')
    .description('Follow a user')
    .option('--as <handle>', AS_HELP)
    .action(followCommand);

  x.command('unfollow <username>')
    .description('Unfollow a user')
    .option('--as <handle>', AS_HELP)
    .action(unfollowCommand);

  // x delete
  x.command('delete <url>')
    .description('Delete a tweet')
    .option('--engine <engine>', 'Write engine: "debugger" (default, CDP) or "dom" (content-script)', 'debugger')
    .option('--visible', 'Bring the automation window to front during the action')
    .option('--as <handle>', AS_HELP)
    .action(deleteCommand);

  // x bookmark / unbookmark
  x.command('bookmark <url>')
    .description('Bookmark a tweet')
    .option('--as <handle>', AS_HELP)
    .action(bookmarkCommand);

  x.command('unbookmark <url>')
    .description('Unbookmark a tweet')
    .option('--as <handle>', AS_HELP)
    .action(unbookmarkCommand);

  // x whoami / switch — explicit account verbs. Useful for setup
  // (confirm which account the pool window is currently on) and for
  // scripted flows that want to force a switch outside of a write.
  // Both are read-only with respect to user data; safe to invoke
  // anytime. Default engine is `debugger` because that's the path
  // every other write command uses by default.
  x.command('whoami')
    .description('Print the active X handle in the pool window (or active x.com tab if --engine dom)')
    .option('--engine <engine>', '"debugger" (default, reads pool window) or "dom" (reads your active x.com tab)', 'debugger')
    .action(whoamiCommand);

  x.command('switch <handle>')
    .description('Switch the active X account by clicking the in-page account switcher (target must already be logged in)')
    .option('--engine <engine>', '"debugger" (default, drives pool window) or "dom" (drives your active x.com tab)', 'debugger')
    .action(switchAccountCommand);

  // x analytics
  x.command('analytics')
    .description('Get account analytics')
    .option('--as <handle>', AS_HELP)
    .action(analyticsCommand);

  // ── x scrape subgroup ──────────────────────────────────

  const xScrape = x
    .command('scrape')
    .description('Scrape X data');

  xScrape
    .command('timeline')
    .description('Scrape home timeline')
    .option('-l, --limit <n>', 'Max tweets', '20')
    .option('--scrollAttempts <n>', 'Scroll attempts', '5')
    .option('-t, --type <type>', 'Timeline type: for-you (algorithmic) or following (chronological from accounts you follow)', 'for-you')
    .option('--as <handle>', AS_HELP)
    .action(scrapeTimelineCommand);

  xScrape
    .command('bookmarks')
    .description('Scrape bookmarked tweets')
    .option('-l, --limit <n>', 'Max tweets', '20')
    .option('--as <handle>', AS_HELP)
    .action(scrapeBookmarksCommand);

  xScrape
    .command('notifications')
    .description('Scrape inbox notifications (mentions, replies, likes, RTs, follows)')
    .option('-l, --limit <n>', 'Max notifications', '40')
    .option('--as <handle>', AS_HELP)
    .action(scrapeNotificationsCommand);

  xScrape
    .command('search <query>')
    .description('Search and scrape tweets')
    .option('-t, --tab <tab>', 'Search tab: top, latest, people, media', 'top')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--from <username>', 'Filter by author')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)')
    .option('--lang <code>', 'Language filter (en, zh, etc.)')
    .option('--minLikes <n>', 'Minimum likes')
    .option('--minRetweets <n>', 'Minimum retweets')
    .option('--has <type>', 'Media filter: images, videos, links')
    .action(scrapeSearchCommand);

  xScrape
    .command('user-tweets <username>')
    .description('Scrape tweets from a user')
    .option('-l, --limit <n>', 'Max tweets', '20')
    .option('--scrollAttempts <n>', 'Scroll attempts', '5')
    .action(scrapeUserTweetsCommand);

  x
    .command('stats-account')
    .description('Fetch X account analytics (views, impressions, engagements). Mirrors the 5 time ranges from the extension panel (7D/2W/4W/3M/1Y).')
    .option('--range <r>', 'Preset range: 7D | 2W | 4W | 3M | 1Y', '3M')
    .option('--from <iso>', 'ISO start datetime (overrides --range)')
    .option('--to <iso>', 'ISO end datetime (defaults to now)')
    .option('--granularity <g>', 'Daily | Weekly | Monthly (auto-picked by --range if omitted)')
    .option('--as <handle>', AS_HELP)
    .action(
      async (opts: { range: string; from?: string; to?: string; granularity?: string; as?: string }) => {
        const { runCliAction } = await import('./cli.js');
        const { ensureAccount } = await import('./accountGuard.js');
        // Stats are strictly per-account — passing --as on a brand that
        // isn't currently active would otherwise silently read the wrong
        // account's metrics. Guard runs against the same scraper pool
        // window the underlying account_analytics action uses.
        await ensureAccount({ expected: opts.as, engine: 'debugger', port: DEFAULT_PORT });
        const now = new Date();
        const to = new Date(now);
        to.setHours(23, 59, 59, 999);
        const from = new Date(now);
        from.setHours(0, 0, 0, 0);
        switch (opts.range) {
          case '7D': from.setDate(from.getDate() - 7); break;
          case '2W': from.setDate(from.getDate() - 14); break;
          case '4W': from.setDate(from.getDate() - 28); break;
          case '3M': from.setMonth(from.getMonth() - 3); break;
          case '1Y': from.setFullYear(from.getFullYear() - 1); break;
          default:
            console.error(`Unknown --range '${opts.range}'. Use 7D|2W|4W|3M|1Y.`);
            process.exit(2);
        }
        const toTime = opts.to ?? to.toISOString();
        const fromTime = opts.from ?? from.toISOString();
        // Matches XAnalyticsPanel behavior: 1Y → Weekly, otherwise Daily.
        const granularity = opts.granularity ?? (opts.range === '1Y' ? 'Weekly' : 'Daily');
        await runCliAction(
          'account_analytics',
          { fromTime, toTime, granularity },
          DEFAULT_PORT,
        );
      },
    );

  xScrape
    .command('user-profile <username>')
    .description('Get user profile info')
    .action(scrapeUserProfileCommand);

  xScrape
    .command('thread <url>')
    .description('Scrape a tweet thread')
    .action(scrapeThreadCommand);

  // ── x navigate subgroup ────────────────────────────────

  const xNav = x
    .command('navigate')
    .description('Navigate within X');

  xNav
    .command('url <url>')
    .description('Navigate to a URL')
    .action(navigateUrlCommand);

  // Also allow: bnbot x navigate <url> (without "url" subcommand)
  // handled via .argument() on navigate itself
  xNav
    .argument('[target]', 'URL to navigate to')
    .action((target?: string) => {
      if (target && (target.startsWith('http') || target.startsWith('x.com') || target.startsWith('twitter.com'))) {
        return navigateUrlCommand(target);
      }
      // If no valid target, show help
      if (target) {
        console.error(`Unknown navigate target: ${target}`);
        console.error('Use: bnbot x navigate <url>, or bnbot x navigate search <query>');
        process.exit(1);
      }
    });

  xNav
    .command('search <query>')
    .description('Navigate to search results')
    .action(navigateSearchCommand);

  xNav
    .command('bookmarks')
    .description('Navigate to bookmarks')
    .action(navigateBookmarksCommand);

  xNav
    .command('notifications')
    .description('Navigate to notifications')
    .action(navigateNotificationsCommand);

  // ── Public data scrapers ───────────────────────────────

  // hackernews
  const hackernews = program
    .command('hackernews')
    .description('Hacker News data');
  hackernews
    .command('search <query>')
    .description('Search Hacker News')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--sort <sort>', 'Sort: relevance or date', 'relevance')
    .action(async (query: string, options: { limit?: string; sort?: string }) => {
      await runPublicScraper('search-hackernews', { query, limit: Number(options.limit) || 20, sort: options.sort });
    });
  hackernews
    .command('top')
    .description('HN top stories')
    .option('-l, --limit <n>', 'Max results', '20')
    .action(async (options: { limit?: string }) => {
      await runPublicScraper('fetch-hackernews-top', { limit: Number(options.limit) || 20 });
    });
  hackernews
    .command('new')
    .description('HN new stories')
    .option('-l, --limit <n>', 'Max results', '20')
    .action(async (options: { limit?: string }) => {
      await runPublicScraper('fetch-hackernews-new', { limit: Number(options.limit) || 20 });
    });
  hackernews
    .command('best')
    .description('HN best stories')
    .option('-l, --limit <n>', 'Max results', '20')
    .action(async (options: { limit?: string }) => {
      await runPublicScraper('fetch-hackernews-best', { limit: Number(options.limit) || 20 });
    });
  hackernews
    .command('show')
    .description('HN Show HN')
    .option('-l, --limit <n>', 'Max results', '20')
    .action(async (options: { limit?: string }) => {
      await runPublicScraper('fetch-hackernews-show', { limit: Number(options.limit) || 20 });
    });
  hackernews
    .command('jobs')
    .description('HN jobs')
    .option('-l, --limit <n>', 'Max results', '20')
    .action(async (options: { limit?: string }) => {
      await runPublicScraper('fetch-hackernews-jobs', { limit: Number(options.limit) || 20 });
    });

  // stackoverflow
  const stackoverflow = program
    .command('stackoverflow')
    .description('Stack Overflow data');
  stackoverflow
    .command('search <query>')
    .description('Search Stack Overflow')
    .option('-l, --limit <n>', 'Max results', '10')
    .action(async (query: string, options: { limit?: string }) => {
      await runPublicScraper('search-stackoverflow', { query, limit: Number(options.limit) || 10 });
    });
  stackoverflow
    .command('hot')
    .description('SO hot questions')
    .option('-l, --limit <n>', 'Max results', '10')
    .action(async (options: { limit?: string }) => {
      await runPublicScraper('fetch-stackoverflow-hot', { limit: Number(options.limit) || 10 });
    });

  // wikipedia
  const wikipedia = program
    .command('wikipedia')
    .description('Wikipedia data');
  wikipedia
    .command('search <query>')
    .description('Search Wikipedia')
    .option('--lang <code>', 'Language code', 'en')
    .option('-l, --limit <n>', 'Max results', '10')
    .action(async (query: string, options: { lang?: string; limit?: string }) => {
      await runPublicScraper('search-wikipedia', { query, lang: options.lang, limit: Number(options.limit) || 10 });
    });
  wikipedia
    .command('summary <title>')
    .description('Wikipedia article summary')
    .option('--lang <code>', 'Language code', 'en')
    .action(async (title: string, options: { lang?: string }) => {
      await runPublicScraper('fetch-wikipedia-summary', { title, lang: options.lang });
    });

  // apple-podcasts
  const applePodcasts = program
    .command('apple-podcasts')
    .description('Apple Podcasts data');
  applePodcasts
    .command('search <query>')
    .description('Search Apple Podcasts')
    .option('-l, --limit <n>', 'Max results', '10')
    .action(async (query: string, options: { limit?: string }) => {
      await runPublicScraper('search-apple-podcasts', { query, limit: Number(options.limit) || 10 });
    });

  // substack
  const substack = program
    .command('substack')
    .description('Substack data');
  substack
    .command('search <query>')
    .description('Search Substack posts')
    .option('-l, --limit <n>', 'Max results', '20')
    .action(async (query: string, options: { limit?: string }) => {
      await runPublicScraper('search-substack', { query, limit: Number(options.limit) || 20 });
    });

  // v2ex
  const v2ex = program
    .command('v2ex')
    .description('V2EX data');
  v2ex
    .command('hot')
    .description('V2EX hot topics')
    .action(async () => {
      await runPublicScraper('fetch-v2ex-hot', {});
    });
  v2ex
    .command('latest')
    .description('V2EX latest topics')
    .action(async () => {
      await runPublicScraper('fetch-v2ex-latest', {});
    });

  // bloomberg
  const bloomberg = program
    .command('bloomberg')
    .description('Bloomberg data');
  bloomberg
    .command('news')
    .description('Bloomberg news headlines')
    .option('-l, --limit <n>', 'Max results', '20')
    .action(async (options: { limit?: string }) => {
      await runPublicScraper('fetch-bloomberg-news', { limit: Number(options.limit) || 20 });
    });

  // bbc
  const bbc = program
    .command('bbc')
    .description('BBC data');
  bbc
    .command('news')
    .description('BBC news headlines')
    .option('-l, --limit <n>', 'Max results', '20')
    .action(async (options: { limit?: string }) => {
      await runPublicScraper('fetch-bbc-news', { limit: Number(options.limit) || 20 });
    });

  // sinafinance
  const sinafinance = program
    .command('sinafinance')
    .description('Sina Finance data');
  sinafinance
    .command('news')
    .description('Sina Finance 7x24 news')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--type <type>', 'News type (0-9)', '0')
    .action(async (options: { limit?: string; type?: string }) => {
      await runPublicScraper('fetch-sinafinance-news', { limit: Number(options.limit) || 20, type: Number(options.type) || 0 });
    });

  // sinablog
  const sinablog = program
    .command('sinablog')
    .description('Sina Blog data');
  sinablog
    .command('search <query>')
    .description('Search Sina Blog')
    .option('-l, --limit <n>', 'Max results', '20')
    .action(async (query: string, options: { limit?: string }) => {
      await runPublicScraper('search-sinablog', { query, limit: Number(options.limit) || 20 });
    });

  // xiaoyuzhou
  const xiaoyuzhou = program
    .command('xiaoyuzhou')
    .description('Xiaoyuzhou FM data');
  xiaoyuzhou
    .command('podcast <id>')
    .description('Get podcast info')
    .action(async (id: string) => {
      await runPublicScraper('fetch-xiaoyuzhou-podcast', { podcastId: id });
    });
  xiaoyuzhou
    .command('episodes <podcastId>')
    .description('List podcast episodes')
    .option('-l, --limit <n>', 'Max results', '20')
    .action(async (podcastId: string, options: { limit?: string }) => {
      await runPublicScraper('fetch-xiaoyuzhou-episodes', { podcastId, limit: Number(options.limit) || 20 });
    });

  // ── Browser-based platform scrapers (via extension) ────

  const tiktok = program.command('tiktok').description('TikTok');
  tiktok.command('search <query>').description('Search TikTok videos').option('-l, --limit <n>', 'Max results', '10').action(tiktokSearchCommand);
  tiktok.command('explore').description('Trending TikTok videos').option('-l, --limit <n>', 'Max results', '20').action(tiktokExploreCommand);
  tiktok.command('profile <username>').description('Fetch a TikTok user profile').action(tiktokProfileCommand);
  tiktok.command('user-posts <user>').description('Fetch a user\'s posts (handle or secUid)')
    .option('-l, --limit <n>', 'Max results', '30')
    .option('--cursor <c>', 'Pagination cursor')
    .action(tiktokUserPostsCommand);
  tiktok.command('user-followers <user>').description('Fetch a user\'s followers (handle or secUid)')
    .option('-l, --limit <n>', 'Max results', '30')
    .option('--cursor <c>', 'Pagination cursor')
    .action(tiktokUserFollowersCommand);
  tiktok.command('post-detail <url-or-id>').description('Fetch a TikTok post\'s detail').action(tiktokPostDetailCommand);
  tiktok.command('post-comments <url-or-id>').description('Fetch a TikTok post\'s comments')
    .option('-l, --limit <n>', 'Max results', '50')
    .option('--cursor <c>', 'Pagination cursor')
    .action(tiktokPostCommentsCommand);
  tiktok.command('search-account <query>').description('Search TikTok accounts')
    .option('-l, --limit <n>', 'Max results', '20')
    .action(tiktokSearchAccountCommand);
  // ── TikTok Wave 2/3/4 ──
  tiktok.command('challenge-info <name>').description('Fetch TikTok challenge (hashtag) info').action(tiktokChallengeInfoCommand);
  tiktok.command('challenge-posts <id>').description('Posts in a challenge')
    .option('-l, --limit <n>', 'Max results', '30')
    .option('--cursor <c>', 'Pagination cursor')
    .action(tiktokChallengePostsCommand);
  tiktok.command('music-info <id>').description('Fetch TikTok music/sound info').action(tiktokMusicInfoCommand);
  tiktok.command('music-posts <id>').description('Posts using a music/sound')
    .option('-l, --limit <n>', 'Max results', '30')
    .option('--cursor <c>', 'Pagination cursor')
    .action(tiktokMusicPostsCommand);
  tiktok.command('music-unlimited').description('Unlimited (royalty-free) sound catalog')
    .option('-p, --page <n>', 'Page', '1')
    .option('-s, --page-size <n>', 'Page size', '30')
    .option('-o, --order-by <s>', 'Sort order')
    .action(tiktokMusicUnlimitedSoundsCommand);
  tiktok.command('user-info-region <uniqueId>').description('Fetch user info with region (uniqueId)').action(tiktokUserInfoRegionCommand);
  tiktok.command('user-info-by-id <userId>').description('Fetch user info by numeric userId').action(tiktokUserInfoByIdCommand);
  tiktok.command('user-followings <user>').description("Fetch a user's followings")
    .option('-l, --limit <n>', 'Max results', '30')
    .option('--max-time <s>', 'max_time pagination cursor')
    .action(tiktokUserFollowingsCommand);
  tiktok.command('user-liked-posts <user>').description("Fetch a user's liked posts")
    .option('-l, --limit <n>', 'Max results', '30')
    .option('--cursor <c>', 'Pagination cursor')
    .action(tiktokUserLikedPostsCommand);
  tiktok.command('user-playlist <user>').description("Fetch a user's playlists")
    .option('-l, --limit <n>', 'Max results', '30')
    .option('--cursor <c>', 'Pagination cursor')
    .action(tiktokUserPlaylistCommand);
  tiktok.command('user-repost <user>').description("Fetch a user's reposts")
    .option('-l, --limit <n>', 'Max results', '30')
    .option('--cursor <c>', 'Pagination cursor')
    .action(tiktokUserRepostCommand);
  tiktok.command('user-story <userId>').description("Fetch a user's stories")
    .option('--max-cursor <c>', 'Pagination cursor')
    .action(tiktokUserStoryCommand);
  tiktok.command('search-general <query>').description('Mixed TikTok search (videos+users+sounds)')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--cursor <c>', 'Pagination cursor')
    .action(tiktokSearchGeneralCommand);
  tiktok.command('search-live <query>').description('Search TikTok LIVE streams')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--cursor <c>', 'Pagination cursor')
    .action(tiktokSearchLiveCommand);
  tiktok.command('search-suggestions <keyword>').description('Search suggestions / autocomplete')
    .action(tiktokSearchSuggestionsCommand);
  tiktok.command('post-related <url-or-id>').description('Related posts for a video')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--cursor <c>', 'Pagination cursor')
    .action(tiktokPostRelatedCommand);
  tiktok.command('post-explore').description('Explore feed (foryou) posts')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('-c, --category-type <s>', 'Category type filter')
    .action(tiktokPostExploreCommand);
  tiktok.command('post-discover <keyword>').description('Discover posts by keyword')
    .option('-p, --page <n>', 'Page', '1')
    .action(tiktokPostDiscoverCommand);
  // ── TikTok Wave 5 — Creative Center (ads.tiktok.com) ──
  // Requires TikTok For Business login in the same Chrome profile.
  tiktok.command('ads-detail <adsId>').description('Creative Center: top-ad detail').action(tiktokAdsDetailCommand);
  tiktok.command('ads-top').description('Creative Center: top ads list')
    .option('-p, --page <n>', 'Page', '1')
    .option('--period <n>', 'Period (days): 7 | 30 | 120', '7')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--country <code>', 'Country code (ISO)', 'US')
    .option('--order-by <s>', 'ctr | cvr | impression', 'ctr')
    .action(tiktokAdsTopCommand);
  tiktok.command('trending-creator').description('Creative Center: trending creators')
    .option('-p, --page <n>', 'Page', '1')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--sort-by <s>', 'follower | follower_growth | engagement', 'follower')
    .option('--country <code>', 'Country code (ISO)', 'US')
    .action(tiktokTrendingCreatorCommand);
  tiktok.command('trending-video').description('Creative Center: trending videos')
    .option('-p, --page <n>', 'Page', '1')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--period <n>', 'Period (days)', '30')
    .option('--order-by <s>', 'vv | like | comment | share', 'vv')
    .option('--country <code>', 'Country code (ISO)', 'US')
    .action(tiktokTrendingVideoCommand);
  tiktok.command('trending-hashtag').description('Creative Center: trending hashtags')
    .option('-p, --page <n>', 'Page', '1')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--period <n>', 'Period (days)', '120')
    .option('--country <code>', 'Country code (ISO)', 'US')
    .option('--sort-by <s>', 'popular | new', 'popular')
    .action(tiktokTrendingHashtagCommand);
  tiktok.command('trending-song').description('Creative Center: trending songs')
    .option('-p, --page <n>', 'Page', '1')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--period <n>', 'Period (days)', '7')
    .option('--rank-type <s>', 'popular | breakout', 'popular')
    .option('--country <code>', 'Country code (ISO)', 'US')
    .action(tiktokTrendingSongCommand);
  tiktok.command('trending-keyword').description('Creative Center: trending keywords')
    .option('-p, --page <n>', 'Page', '1')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--period <n>', 'Period (days)', '7')
    .option('--country <code>', 'Country code (ISO)', 'US')
    .action(tiktokTrendingKeywordCommand);
  tiktok.command('trending-keyword-posts <keyword>').description('Creative Center: posts using a keyword')
    .option('--country <code>', 'Country code (ISO)', 'US')
    .option('-l, --limit <n>', 'Max results', '10')
    .option('--period <n>', 'Period (days)', '7')
    .action(tiktokTrendingKeywordPostsCommand);
  tiktok.command('trending-keyword-sentence <keyword>').description('Creative Center: keyword topic sentences')
    .option('-p, --page <n>', 'Page', '1')
    .option('-l, --limit <n>', 'Max results', '50')
    .option('--period <n>', 'Period (days)', '30')
    .option('--country <code>', 'Country code (ISO)', 'US')
    .option('--order-type <s>', 'asc | desc', 'desc')
    .action(tiktokTrendingKeywordSentenceCommand);
  tiktok.command('commercial-music').description('Creative Center: commercial music library')
    .option('-p, --page <n>', 'Page', '1')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--region <code>', 'Region (ISO)', 'US')
    .option('--scenarios <n>', 'Scenario id (0=all)', '0')
    .option('--duration <n>', 'Duration filter (0=all)', '0')
    .option('--placements <csv>', 'Comma-separated placements')
    .option('--themes <csv>', 'Comma-separated themes')
    .option('--genres <csv>', 'Comma-separated genres')
    .option('--moods <csv>', 'Comma-separated moods')
    .action(tiktokCommercialMusicCommand);
  tiktok.command('commercial-playlists').description('Creative Center: commercial music playlists')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--region <code>', 'Region (ISO)', 'US')
    .action(tiktokCommercialPlaylistsCommand);
  tiktok.command('commercial-playlist-detail <playlistId>').description('Creative Center: commercial playlist detail')
    .option('-p, --page <n>', 'Page', '1')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--region <code>', 'Region (ISO)', 'US')
    .action(tiktokCommercialPlaylistDetailCommand);
  tiktok.command('top-products').description('Creative Center: top products list')
    .option('-p, --page <n>', 'Page', '1')
    .option('--last <n>', 'Last N days (7 | 30)', '7')
    .option('--order-by <s>', 'post | ad | sale | growth', 'post')
    .option('--order-type <s>', 'asc | desc', 'desc')
    .action(tiktokTopProductsCommand);
  tiktok.command('top-product-detail <productId>').description('Creative Center: top product detail').action(tiktokTopProductDetailCommand);
  tiktok.command('top-product-metrics <productId>').description('Creative Center: top product metrics').action(tiktokTopProductMetricsCommand);
  // ── TikTok Wave 6 (long-tail: place / effect / collection / comment-replies) ──
  tiktok.command('place-info <placeId>').description('Fetch TikTok place (POI) info').action(tiktokPlaceInfoCommand);
  tiktok.command('place-posts <placeId>').description('Posts tagged at a place')
    .option('-l, --limit <n>', 'Max results', '30')
    .option('--cursor <c>', 'Pagination cursor', '')
    .action(tiktokPlacePostsCommand);
  tiktok.command('effect-info <effectId>').description('Fetch TikTok effect / sticker info').action(tiktokEffectInfoCommand);
  tiktok.command('effect-posts <effectId>').description('Posts using an effect / sticker')
    .option('-l, --limit <n>', 'Max results', '30')
    .option('--cursor <c>', 'Pagination cursor', '')
    .action(tiktokEffectPostsCommand);
  tiktok.command('collection-info <collectionId>').description('Fetch TikTok user-curated collection info').action(tiktokCollectionInfoCommand);
  tiktok.command('collection-posts <collectionId>').description('Posts in a user-curated collection (no cursor — paginates by count only)')
    .option('-l, --limit <n>', 'Max results', '30')
    .action(tiktokCollectionPostsCommand);
  tiktok.command('post-comment-replies <video> <commentId>').description("Fetch replies to a specific comment on a post")
    .option('-l, --limit <n>', 'Max results', '6')
    .option('--cursor <c>', 'Pagination cursor', '')
    .action(tiktokPostCommentRepliesCommand);
  // tiktok.command('fetch') removed — `fetch_tiktok_video` orphan was the
  // republish flow; extension no longer hosts the handler.
  tiktok
    .command('post')
    .description('Upload a video to TikTok Studio + fill caption. Never auto-clicks 发布 — review and confirm in browser.')
    .argument('[plan-json-or-path]', 'Plan as inline JSON, file path, or "-" for stdin. Defaults to stdin.')
    .option('--plan <path>', 'Alias for the positional arg', '-')
    .action(
      (arg: string | undefined, opts: { plan?: string }) => {
        const planSource =
          arg && arg.trim().startsWith('{') ? { inline: arg } : { plan: arg ?? opts.plan ?? '-' }
        return tiktokPostCommand(planSource)
      },
    );

  // 快手创作者中心
  const kuaishou = program.command('kuaishou').description('Kuaishou (cp.kuaishou.com)');
  kuaishou
    .command('post')
    .description('Upload a video to Kuaishou Creator + fill caption. Uses file-chooser intercept (debug_set_files_via_chooser) since direct setFiles no-ops on Kuaishou. Never auto-publishes.')
    .argument('[plan-json-or-path]', 'Plan as inline JSON, file path, or "-" for stdin. Defaults to stdin.')
    .option('--plan <path>', 'Alias for the positional arg', '-')
    .action(
      (arg: string | undefined, opts: { plan?: string }) => {
        const planSource =
          arg && arg.trim().startsWith('{') ? { inline: arg } : { plan: arg ?? opts.plan ?? '-' }
        return kuaishouPostCommand(planSource)
      },
    );

  // 微信视频号
  const wxchannels = program.command('wxchannels').description('微信视频号 (channels.weixin.qq.com)');
  wxchannels
    .command('post')
    .description('Upload a video to 视频号 + fill description / short title / 声明原创. Form lives in same-origin iframe; CLI handles iframe selectors automatically. Never auto-publishes.')
    .argument('[plan-json-or-path]', 'Plan as inline JSON, file path, or "-" for stdin. Defaults to stdin.')
    .option('--plan <path>', 'Alias for the positional arg', '-')
    .action(
      (arg: string | undefined, opts: { plan?: string }) => {
        const planSource =
          arg && arg.trim().startsWith('{') ? { inline: arg } : { plan: arg ?? opts.plan ?? '-' }
        return wxchannelsPostCommand(planSource)
      },
    );

  // 抖音创作者中心
  const douyin = program.command('douyin').description('Douyin (creator.douyin.com)');
  douyin
    .command('post')
    .description('Upload a video to 抖音创作者中心 + fill caption. Uses blob inject path. saveDraft:true clicks 暂存离开 (real draft). Never auto-publishes.')
    .argument('[plan-json-or-path]', 'Plan as inline JSON, file path, or "-" for stdin. Defaults to stdin.')
    .option('--plan <path>', 'Alias for the positional arg', '-')
    .action(
      (arg: string | undefined, opts: { plan?: string }) => {
        const planSource =
          arg && arg.trim().startsWith('{') ? { inline: arg } : { plan: arg ?? opts.plan ?? '-' }
        return douyinPostCommand(planSource)
      },
    );

  const youtube = program.command('youtube').description('YouTube');
  youtube.command('search <query>').description('Search YouTube videos')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--type <type>', 'Filter: shorts, video, channel, playlist')
    .option('--upload <period>', 'Upload date: hour, today, week, month, year')
    .option('--sort <sort>', 'Sort: relevance, date, views, rating')
    .action(youtubeSearchCommand);
  youtube.command('video <url-or-id>').description('Fetch YouTube video details').action(youtubeVideoCommand);
  youtube.command('channel-details <id-or-handle>').description('Fetch YouTube channel details').action(youtubeChannelDetailsCommand);
  youtube.command('channel-videos <id-or-handle>').description('Fetch a channel\'s videos')
    .option('--filter <filter>', 'latest | popular | oldest', 'latest')
    .option('-l, --limit <n>', 'Max results', '30')
    .action(youtubeChannelVideosCommand);
  youtube.command('trending').description('YouTube trending feed')
    .option('-l, --limit <n>', 'Max results', '30')
    .action(youtubeTrendingCommand);
  youtube.command('channel-search <id-or-handle> <query>').description('Search videos within a channel')
    .option('-l, --limit <n>', 'Max results', '20')
    .action(youtubeChannelSearchCommand);
  youtube.command('streaming-data <url-or-id>').description('Fetch YouTube video streaming data (formats / manifest URLs)').action(youtubeStreamingDataCommand);
  youtube.command('related <url-or-id>').description('Fetch related videos for a watch page')
    .option('-l, --limit <n>', 'Max results', '20')
    .action(youtubeRelatedCommand);
  youtube.command('comments <url-or-id>').description('Fetch comments for a YouTube video')
    .option('-l, --limit <n>', 'Max results', '50')
    .action(youtubeCommentsCommand);
  youtube.command('transcript <url-or-id>').description('Fetch YouTube video transcript')
    .option('--lang <code>', 'Preferred caption language code (e.g. en, zh)')
    .action(youtubeTranscriptCommand);

  const reddit = program.command('reddit').description('Reddit');
  reddit.command('search <query>').description('Search Reddit posts').option('-l, --limit <n>', 'Max results', '10').action(redditSearchCommand);
  reddit.command('hot').description('Reddit frontpage hot posts').option('-l, --limit <n>', 'Max results', '20').action(redditHotCommand);

  const bilibili = program.command('bilibili').description('Bilibili');
  bilibili.command('search <query>').description('Search Bilibili videos').option('-l, --limit <n>', 'Max results', '10').action(bilibiliSearchCommand);
  bilibili.command('hot').description('Bilibili popular videos').option('-l, --limit <n>', 'Max results', '20').action(bilibiliHotCommand);
  bilibili.command('ranking').description('Bilibili ranking').option('-l, --limit <n>', 'Max results', '20').action(bilibiliRankingCommand);

  const zhihu = program.command('zhihu').description('Zhihu');
  zhihu.command('search <query>').description('Search Zhihu').option('-l, --limit <n>', 'Max results', '10').action(zhihuSearchCommand);
  zhihu.command('hot').description('Zhihu hot topics').option('-l, --limit <n>', 'Max results', '50').action(zhihuHotCommand);

  const xueqiu = program.command('xueqiu').description('Xueqiu (stocks)');
  xueqiu.command('search <query>').description('Search stocks').option('-l, --limit <n>', 'Max results', '10').action(xueqiuSearchCommand);
  xueqiu.command('hot').description('Xueqiu hot stocks').option('-l, --limit <n>', 'Max results', '20').action(xueqiuHotCommand);

  const instagram = program.command('instagram').description('Instagram');
  instagram.command('search <query>').description('Search Instagram users').option('-l, --limit <n>', 'Max results', '10').action(instagramSearchCommand);
  instagram.command('explore').description('Instagram explore posts').option('-l, --limit <n>', 'Max results', '20').action(instagramExploreCommand);

  const linuxdo = program.command('linux-do').description('Linux.do');
  linuxdo.command('search <query>').description('Search Linux.do topics').option('-l, --limit <n>', 'Max results', '10').action(linuxdoSearchCommand);

  const jike = program.command('jike').description('Jike');
  jike.command('search <query>').description('Search Jike posts').option('-l, --limit <n>', 'Max results', '10').action(jikeSearchCommand);

  const xiaohongshu = program.command('xiaohongshu').description('Xiaohongshu');
  xiaohongshu.command('search <query>').description('Search Xiaohongshu notes').option('-l, --limit <n>', 'Max results', '10').action(xiaohongshuSearchCommand);
  // xiaohongshu.command('fetch') removed — fetch_xiaohongshu_note orphan
  // was the abandoned republish flow; extension no longer hosts the handler.

  const weibo = program.command('weibo').description('Weibo');
  weibo.command('search <query>').description('Search Weibo posts').option('-l, --limit <n>', 'Max results', '10').action(weiboSearchCommand);
  weibo.command('hot').description('Weibo hot topics').option('-l, --limit <n>', 'Max results', '50').action(weiboHotCommand);

  const douban = program.command('douban').description('Douban');
  douban.command('search <query>').description('Search Douban').option('-l, --limit <n>', 'Max results', '10').action(doubanSearchCommand);
  douban.command('movie-hot').description('Douban hot movies').option('-l, --limit <n>', 'Max results', '20').action(doubanMovieHotCommand);
  douban.command('book-hot').description('Douban hot books').option('-l, --limit <n>', 'Max results', '20').action(doubanBookHotCommand);
  douban.command('top250').description('Douban top 250 movies').option('-l, --limit <n>', 'Max results', '20').action(doubanTop250Command);

  const medium = program.command('medium').description('Medium');
  medium.command('search <query>').description('Search Medium articles').option('-l, --limit <n>', 'Max results', '10').action(mediumSearchCommand);

  const google = program.command('google').description('Google');
  google.command('search <query>').description('Search Google').option('-l, --limit <n>', 'Max results', '10').action(googleSearchCommand);
  google.command('news <query>').description('Search Google News').option('-l, --limit <n>', 'Max results', '10').action(googleNewsCommand);

  const facebook = program.command('facebook').description('Facebook');
  facebook.command('search <query>').description('Search Facebook posts').option('-l, --limit <n>', 'Max results', '10').action(facebookSearchCommand);

  const linkedin = program.command('linkedin').description('LinkedIn');
  linkedin.command('search <query>').description('Search LinkedIn jobs').option('-l, --limit <n>', 'Max results', '10').action(linkedinSearchCommand);

  const kr36 = program.command('36kr').description('36Kr');
  kr36.command('search <query>').description('Search 36Kr articles').option('-l, --limit <n>', 'Max results', '10').action(kr36SearchCommand);
  kr36.command('hot').description('36Kr hot articles').option('-l, --limit <n>', 'Max results', '20').action(kr36HotCommand);
  kr36.command('news').description('36Kr latest news').option('-l, --limit <n>', 'Max results', '20').action(kr36NewsCommand);

  const producthunt = program.command('producthunt').description('Product Hunt');
  producthunt.command('hot').description('Top Product Hunt launches').option('-l, --limit <n>', 'Max results', '20').action(producthuntHotCommand);

  const yahooFinance = program.command('yahoo-finance').description('Yahoo Finance');
  yahooFinance.command('quote <symbol>').description('Get stock quote').action(yahooFinanceQuoteCommand);

  const weixin = program.command('weixin').description('WeChat');
  weixin.command('article <url>').description('Fetch WeChat article').action(fetchWeixinArticleCommand);

  // ── WeChat MP (公众号) creator automation ────────────
  // 🚫 No --publish flag by design: 发表 must always be a manual click
  // by the user in the MP backend. We only automate up to 保存草稿 + 预览.
  const wxmp = program.command('wxmp').description('WeChat MP (公众号) editor automation — compose / save draft / preview only');
  wxmp
    .command('post')
    .description('Compose a 公众号 article from a JSON plan; save draft + optional preview. Never publishes.')
    .argument(
      '[plan-json-or-path]',
      'Plan as inline JSON, OR a path to a JSON file, OR "-" for stdin. Defaults to stdin.',
    )
    .option('--plan <path>', 'Alias for the positional arg — path to plan JSON, or `-` for stdin', '-')
    .action(
      (
        arg: string | undefined,
        opts: { plan?: string },
      ) => {
        const planSource =
          arg && arg.trim().startsWith('{') ? { inline: arg } : { plan: arg ?? opts.plan ?? '-' }
        return wxmpPostCommand(planSource)
      },
    );

  return program;
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const userArgs = process.argv.slice(2);
  const firstArg = userArgs[0];

  // Default to serve when no arguments
  if (process.argv.length <= 2) {
    await runServe(DEFAULT_PORT);
    return;
  }

  // ── Legacy backward compatibility ──────────────────────
  // Route old kebab-case commands through the original runCliTool / runPublicScraper
  // which use --key value format. This avoids incompatibility with commander's
  // positional arg expectations.
  if (firstArg && !firstArg.startsWith('-')) {
    // Legacy public scraper: bnbot search-hackernews --query "AI"
    if (PUBLIC_SCRAPER_NAMES.includes(firstArg)) {
      const toolArgs = userArgs.slice(1);
      const params: Record<string, unknown> = {};
      for (let i = 0; i < toolArgs.length; i++) {
        if (toolArgs[i].startsWith('--') && toolArgs[i + 1] && !toolArgs[i + 1].startsWith('--')) {
          params[toolArgs[i].slice(2)] = isNaN(Number(toolArgs[i + 1]))
            ? toolArgs[i + 1]
            : Number(toolArgs[i + 1]);
          i++;
        }
      }
      await runPublicScraper(firstArg, params);
      return;
    }

    // Legacy CLI tool: bnbot post-tweet --text "Hello"
    if (CLI_TOOL_NAMES.includes(firstArg)) {
      const toolArgs = userArgs.slice(1);
      await runCliTool(firstArg, toolArgs);
      return;
    }
  }

  // ── Commander parsing ──────────────────────────────────
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error('[BNBOT] Fatal error:', err);
  process.exit(1);
});
