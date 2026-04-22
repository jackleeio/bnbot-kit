/**
 * `bnbot download` — thin yt-dlp wrapper.
 *
 * Just spawns `yt-dlp` with sensible defaults and surfaces its stdout /
 * exit status back to the caller. No LLM, no decisions — skills that
 * want to "repost a TikTok with my commentary" compose this with
 * `bnbot x post --media <file> "<text>"` themselves.
 *
 * yt-dlp covers TikTok (watermark-free), YouTube, Instagram, Bilibili,
 * Xiaohongshu (video notes), 抖音, 微博, and ~1000 other sites. No
 * bespoke per-platform scraper code needed on our side.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

interface DownloadOptions {
  output?: string;
  format?: 'video' | 'audio';
  info?: boolean;
}

const DEFAULT_DIR = join(homedir(), '.bnbot', 'downloads');

/** Verify yt-dlp is on PATH. Print install hint + exit if missing. */
function ensureYtDlp(): void {
  const res = spawnSync('yt-dlp', ['--version'], { stdio: 'ignore' });
  if (res.status !== 0) {
    console.error('yt-dlp not found on PATH.');
    console.error('Install:');
    console.error('  macOS:  brew install yt-dlp');
    console.error('  Linux:  pipx install yt-dlp   (or: pip install --user yt-dlp)');
    console.error('Then re-run this command.');
    process.exit(127);
  }
}

export async function downloadCommand(
  url: string,
  opts: DownloadOptions = {},
): Promise<void> {
  ensureYtDlp();

  // --info: print metadata JSON and exit (no file written).
  if (opts.info) {
    const child = spawn('yt-dlp', ['--dump-single-json', '--no-warnings', url], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (c) => { out += c.toString(); });
    await new Promise<void>((resolveP, rejectP) => {
      child.on('exit', (code) => {
        if (code !== 0) rejectP(new Error(`yt-dlp --info exit ${code}`));
        else resolveP();
      });
      child.on('error', rejectP);
    });
    try {
      const meta = JSON.parse(out);
      console.log(
        JSON.stringify(
          {
            id: meta.id,
            title: meta.title,
            uploader: meta.uploader || meta.channel,
            duration: meta.duration,
            view_count: meta.view_count,
            webpage_url: meta.webpage_url || url,
            ext: meta.ext,
            width: meta.width,
            height: meta.height,
            thumbnail: meta.thumbnail,
          },
          null,
          2,
        ),
      );
    } catch {
      console.log(out);
    }
    return;
  }

  // Download path: where the file ends up. If --output is a directory
  // (or ends with `/`), use a yt-dlp template inside it. Otherwise
  // treat as exact path.
  let outputTemplate: string;
  let resolvedOutput: string | null = null;
  if (opts.output) {
    const abs = resolve(opts.output);
    // Heuristic: if it has no extension, assume directory.
    const isDir = !/\.[^/\\]+$/.test(abs);
    if (isDir) {
      mkdirSync(abs, { recursive: true });
      outputTemplate = join(abs, '%(id)s.%(ext)s');
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      outputTemplate = abs;
      resolvedOutput = abs;
    }
  } else {
    if (!existsSync(DEFAULT_DIR)) mkdirSync(DEFAULT_DIR, { recursive: true });
    outputTemplate = join(DEFAULT_DIR, '%(id)s.%(ext)s');
  }

  const args: string[] = ['--no-warnings', '-o', outputTemplate];

  if (opts.format === 'audio') {
    // Best audio, extracted to m4a (widely compatible).
    args.push('-f', 'bestaudio', '-x', '--audio-format', 'm4a');
  } else {
    // Best single-file video+audio (no ffmpeg merge needed most of the time).
    args.push('-f', 'best[ext=mp4]/best');
  }

  // --print after_move:filepath gives us the final file path on stdout
  // (separate from the progress bar, which goes to stderr). Much more
  // reliable than parsing yt-dlp's progress output.
  args.push('--print', 'after_move:filepath');

  args.push(url);

  console.error(`Downloading: ${url}`);
  const child = spawn('yt-dlp', args, {
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  let stdoutBuf = '';
  child.stdout.on('data', (c) => {
    const s = c.toString();
    stdoutBuf += s;
  });

  await new Promise<void>((resolveP, rejectP) => {
    child.on('exit', (code) => {
      if (code !== 0) rejectP(new Error(`yt-dlp exit ${code}`));
      else resolveP();
    });
    child.on('error', rejectP);
  });

  const filepath =
    resolvedOutput
    ?? stdoutBuf.split('\n').map((l) => l.trim()).filter(Boolean).pop()
    ?? '';

  console.log(
    JSON.stringify(
      {
        success: true,
        path: filepath,
        url,
      },
      null,
      2,
    ),
  );
}
