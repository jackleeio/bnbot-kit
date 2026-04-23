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
} from './commands/actions.js';
import { screenshotCommand } from './commands/screenshot.js';
import { downloadCommand } from './commands/download.js';
import { debugEvalCommand, debugUploadCommand, debugClickCommand, debugShowCommand, debugDragCommand } from './commands/debug.js';
import { xhsPostCommand, xhsStatsNoteCommand, xhsStatsAccountCommand } from './commands/xhs.js';
import {
  calendarAddCommand,
  calendarListCommand,
  calendarRemoveCommand,
  calendarTickCommand,
  calendarInstallCommand,
  calendarUninstallCommand,
} from './commands/calendar.js';
import {
  inboxTickCommand,
  inboxInstallCommand,
  inboxStartCommand,
  inboxStopCommand,
  inboxUninstallCommand,
  inboxStatusCommand,
} from './commands/inboxTick.js';
import {
  draftAddCommand,
  draftListCommand,
  draftScheduleCommand,
  draftUnscheduleCommand,
  draftDeleteCommand,
  draftShareCommand,
  draftSlotsCommand,
  draftSlotsSetCommand,
} from './commands/draft.js';
import {
  tiktokSearchCommand, tiktokExploreCommand,
  youtubeSearchCommand, youtubeVideoCommand, youtubeTranscriptCommand,
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
    .description('BNBot — AI-powered personal branding toolkit for X')
    .version(pkg.version);

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
    .option('--plan <path>', 'Path to plan JSON, or `-` for stdin', '-')
    .option('--publish', 'Actually click 发布 at the end (default: stop after compose)')
    .action(xhsPostCommand);

  xhs
    .command('stats-note')
    .description('Fetch per-note analytics (exposure/views/click rate/watch time/interactions) for a given noteId')
    .argument('<noteId>', '24-char hex XHS note id')
    .action(xhsStatsNoteCommand);

  xhs
    .command('stats-account')
    .description('Fetch account-level analytics (4 tabs: 观看/互动/涨粉/发布 for current period)')
    .action(xhsStatsAccountCommand);

  // ── Calendar commands ──────────────────────────────────
  // Content calendar: one launchd tick reads ~/.bnbot/calendar/<date>.json
  // every 5 min and fires entries whose time has arrived. See
  // skills/schedule/SKILL.md for usage and the difference from ad-hoc plists.

  const calendar = program
    .command('calendar')
    .description('Calendar-based scheduled posts (queue + tick)');

  calendar
    .command('add <action>')
    .description('Append a scheduled entry to a day file. `action` is the full shell command to run at fire time (e.g. `bnbot x post --engine debugger "hi"`).')
    .option('--at <HH:MM>', 'Local time of day to fire', '09:00')
    .option('--date <YYYY-MM-DD>', 'Date to schedule on (default: today)')
    .option('--kind <kind>', 'Entry kind: post|thread|reply|quote|like|retweet|command (auto-inferred from action)')
    .option('--note <text>', 'Free-form note shown in listings')
    .action(calendarAddCommand);

  calendar
    .command('list')
    .description('List today\'s scheduled entries (or --all days)')
    .option('-d, --date <YYYY-MM-DD>', 'Day to list')
    .option('--all', 'Summary across all calendar files')
    .action(calendarListCommand);

  calendar
    .command('remove <id>')
    .description('Delete a scheduled entry by id')
    .option('-d, --date <YYYY-MM-DD>', 'Day to search (default: scan all files)')
    .action(calendarRemoveCommand);

  calendar
    .command('tick')
    .description('Fire all pending entries whose time has arrived (invoked by launchd every 5 min)')
    .action(calendarTickCommand);

  calendar
    .command('install')
    .description('Install the com.bnbot.calendar-tick launchd agent (runs `calendar tick` every 5 min)')
    .action(calendarInstallCommand);

  calendar
    .command('uninstall')
    .description('Remove the calendar-tick launchd agent')
    .action(calendarUninstallCommand);

  // ── Inbox tick (auto-poll X notifications every 5 min) ──
  // Cheap path: scrape notifications, dedup against seen-state. If 0
  // fresh actionable items (mention/reply/quote/new_post), exit. On
  // hot path: spawn headless bnbot session running /inbox-triage --auto
  // to evaluate + post via CDP. Captures the high-freshness reply
  // window (rank 1-3 = 55% of parent exposure) that timeline-scrape
  // misses.

  const inbox = program
    .command('inbox')
    .description('Inbox tick — automated processing of X notifications');

  inbox
    .command('tick')
    .description('Run one tick (called every 5 min by launchd; safe to call manually)')
    .action(inboxTickCommand);

  inbox
    .command('install')
    .description('Write the launchd plist (does NOT start it — run `bnbot inbox start` after)')
    .option('--interval <sec>', 'Tick interval in seconds (default 900 = 15 min)', '900')
    .action(inboxInstallCommand);

  inbox
    .command('start')
    .description('Bootstrap the launchd agent — begin polling at the configured interval')
    .action(inboxStartCommand);

  inbox
    .command('stop')
    .description('Bootout the launchd agent — pause polling (plist preserved)')
    .action(inboxStopCommand);

  inbox
    .command('uninstall')
    .description('Stop polling AND delete the plist file')
    .action(inboxUninstallCommand);

  inbox
    .command('status')
    .description('Show installed?, running?, last tick, seen count')
    .action(inboxStatusCommand);

  // ── Draft commands ──────────────────────────────────────

  const draft = program
    .command('draft')
    .description('Tweet draft management');

  draft
    .command('add <text>')
    .description('Create a tweet draft')
    .option('-t, --time <time>', 'Schedule time (ISO 8601 or date string)')
    .option('--auto', 'Auto-schedule to next available slot')
    .option('--thread', 'Create thread (text is JSON array)')
    .option('-m, --media <file>', 'Attach media file (repeat for multiple, or comma-separate)', collectMedia, [])
    .action(draftAddCommand);

  draft
    .command('list')
    .description('List all drafts')
    .option('--scheduled', 'Only show scheduled drafts')
    .option('-l, --limit <n>', 'Max results', '20')
    .action(draftListCommand);

  draft
    .command('schedule <id> <time>')
    .description('Schedule a draft for publishing')
    .action(draftScheduleCommand);

  draft
    .command('unschedule <id>')
    .description('Cancel a draft schedule')
    .action(draftUnscheduleCommand);

  draft
    .command('delete <id>')
    .description('Delete a draft')
    .action(draftDeleteCommand);

  draft
    .command('share')
    .description('Get calendar share link')
    .action(draftShareCommand);

  const draftSlots = draft
    .command('slots')
    .description('Show or set time slots')
    .action(draftSlotsCommand);

  draftSlots
    .command('set <slots>')
    .description('Set time slots (e.g. "9:00,12:00,18:00,21:00")')
    .action(draftSlotsSetCommand);

  // ── X platform commands ────────────────────────────────

  const x = program
    .command('x')
    .description('X (Twitter) platform commands');

  // x post
  x.command('post <text>')
    .description('Post a tweet')
    .option('-m, --media <url>', 'Media file or URL (repeat for multiple, or comma-separate)', collectMedia, [])
    .option('-d, --draft', 'Draft mode: fill composer without posting')
    .option('--engine <engine>', 'Write engine: "dom" (content-script) or "debugger" (CDP)', 'dom')
    .option('--visible', 'Open the automation tab in foreground (debug engine only)')
    .action(postCommand);

  // x close
  x.command('close')
    .description('Close tweet composer')
    .option('-s, --save', 'Save as draft instead of discarding')
    .action(closeCommand);

  // x thread
  x.command('thread <tweets-json>')
    .description('Post a tweet thread (JSON array)')
    .option('--engine <engine>', 'Write engine: "dom" (default) or "debugger" (chrome.debugger / CDP)', 'dom')
    .option('--visible', 'Bring the automation window to front during the action')
    .action(threadCommand);

  // x reply
  x.command('reply <url> <text>')
    .description('Reply to a tweet')
    .option('-m, --media <url>', 'Media file or URL (repeat for multiple, or comma-separate)', collectMedia, [])
    .option('--engine <engine>', 'Write engine: "dom" (content-script) or "debugger" (CDP)', 'dom')
    .option('--visible', 'Open the automation tab in foreground (debug engine only)')
    .action(replyCommand);

  // x quote
  x.command('quote <url> <text>')
    .description('Quote a tweet')
    .option('-m, --media <url>', 'Media file or URL (repeat for multiple, or comma-separate)', collectMedia, [])
    .option('--engine <engine>', 'Write engine: "dom" or "debugger"', 'dom')
    .option('--visible', 'Open the automation tab in foreground (debug engine only)')
    .action(quoteCommand);

  // x like / unlike
  x.command('like <url>')
    .description('Like a tweet')
    .option('--engine <engine>', 'Write engine: "dom" or "debugger"', 'dom')
    .option('--visible', 'Open the automation tab in foreground (debug engine only)')
    .action(likeCommand);

  x.command('unlike <url>')
    .description('Unlike a tweet')
    .option('--engine <engine>', 'Write engine: "dom" or "debugger"', 'dom')
    .option('--visible', 'Open the automation tab in foreground (debug engine only)')
    .action(unlikeCommand);

  // x retweet / unretweet
  x.command('retweet <url>')
    .description('Retweet a tweet')
    .option('--engine <engine>', 'Write engine: "dom" or "debugger"', 'dom')
    .option('--visible', 'Open the automation tab in foreground (debug engine only)')
    .action(retweetCommand);

  x.command('unretweet <url>')
    .description('Unretweet a tweet')
    .option('--engine <engine>', 'Write engine: "dom" or "debugger"', 'dom')
    .option('--visible', 'Open the automation tab in foreground (debug engine only)')
    .action(unretweetCommand);

  // x follow / unfollow
  x.command('follow <username>')
    .description('Follow a user')
    .action(followCommand);

  x.command('unfollow <username>')
    .description('Unfollow a user')
    .action(unfollowCommand);

  // x delete
  x.command('delete <url>')
    .description('Delete a tweet')
    .option('--engine <engine>', 'Write engine: "dom" (default) or "debugger" (chrome.debugger / CDP)', 'dom')
    .option('--visible', 'Bring the automation window to front during the action')
    .action(deleteCommand);

  // x bookmark / unbookmark
  x.command('bookmark <url>')
    .description('Bookmark a tweet')
    .action(bookmarkCommand);

  x.command('unbookmark <url>')
    .description('Unbookmark a tweet')
    .action(unbookmarkCommand);

  // x analytics
  x.command('analytics')
    .description('Get account analytics')
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
    .action(scrapeTimelineCommand);

  xScrape
    .command('bookmarks')
    .description('Scrape bookmarked tweets')
    .option('-l, --limit <n>', 'Max tweets', '20')
    .action(scrapeBookmarksCommand);

  xScrape
    .command('notifications')
    .description('Scrape inbox notifications (mentions, replies, likes, RTs, follows)')
    .option('-l, --limit <n>', 'Max notifications', '40')
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
    .action(
      async (opts: { range: string; from?: string; to?: string; granularity?: string }) => {
        const { runCliAction } = await import('./cli.js');
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
          18900,
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
  // tiktok.command('fetch') removed — `fetch_tiktok_video` orphan was the
  // republish flow; extension no longer hosts the handler.

  const youtube = program.command('youtube').description('YouTube');
  youtube.command('search <query>').description('Search YouTube videos')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--type <type>', 'Filter: shorts, video, channel, playlist')
    .option('--upload <period>', 'Upload date: hour, today, week, month, year')
    .option('--sort <sort>', 'Sort: relevance, date, views, rating')
    .action(youtubeSearchCommand);
  youtube.command('video <url>').description('Fetch YouTube video info').action(youtubeVideoCommand);
  youtube.command('transcript <url>').description('Fetch YouTube video transcript').action(youtubeTranscriptCommand);

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
