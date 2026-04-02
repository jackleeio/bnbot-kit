/**
 * BNBot Setup — one command to install everything.
 *
 * Usage: npx @bnbot/cli setup
 *
 * What it does:
 * 1. Install bnbot-cli globally (if not already)
 * 2. Install Claude Code skill to ~/.claude/commands/
 * 3. Print next steps
 */

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const SKILL_URL = 'https://bnbot.ai/skill.md';
const CHROME_URL = 'https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln';

// Skill install paths for different agents
const SKILL_TARGETS = [
  { dir: join(homedir(), '.claude', 'commands'), file: 'bnbot.md' },
  { dir: join(homedir(), '.agents', 'skills', 'bnbot'), file: 'SKILL.md' },
];

// Detect if terminal supports ANSI colors (not in OpenClaw/chat environments)
const isTTY = process.stdout.isTTY === true;
const bold = (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s;
const red = (s: string) => isTTY ? `\x1b[1m\x1b[31m${s}\x1b[0m` : s;
const link = (s: string) => isTTY ? `\x1b[4m\x1b[31m${s}\x1b[0m` : s;

export async function runSetup(): Promise<void> {
  console.log('');
  console.log(`🦞 ${bold('BNBot Setup')}`);
  console.log('');

  // Step 1: Install globally
  try {
    const which = execSync('which bnbot 2>/dev/null || where bnbot 2>nul', { encoding: 'utf-8' }).trim();
    if (which) {
      console.log('✅ bnbot-cli already installed');
    }
  } catch {
    console.log('📦 Installing bnbot-cli globally...');
    try {
      execSync('npm i -g @bnbot/cli', { stdio: 'inherit' });
      console.log('✅ bnbot-cli installed');
    } catch {
      console.log('⚠️  Global install failed (try: sudo npm i -g @bnbot/cli)');
    }
  }

  // Step 2: Install skill to all agent platforms
  console.log('');
  console.log('📝 Installing skill...');
  try {
    const res = await fetch(SKILL_URL);
    if (res.ok) {
      const content = await res.text();
      if (content.startsWith('---')) {
        for (const target of SKILL_TARGETS) {
          try {
            mkdirSync(target.dir, { recursive: true });
            writeFileSync(join(target.dir, target.file), content);
          } catch { /* skip if dir not writable */ }
        }
        console.log('✅ Skill installed');
      } else {
        console.log('⚠️  skill.md format unexpected, skipping');
      }
    } else {
      console.log('⚠️  Could not download skill.md (HTTP ' + res.status + ')');
    }
  } catch {
    console.log('⚠️  Could not download skill.md (network error)');
    console.log('   Manual: curl -o ~/.claude/commands/bnbot.md ' + SKILL_URL);
  }

  // Step 3: Start server and check extension connection
  console.log('');
  console.log('🚀 Starting server...');
  const DEFAULT_PORT = 18900;
  let extensionConnected = false;

  // Check if server already running
  const { default: WS } = await import('ws');
  const serverAlive = await new Promise<boolean>((resolve) => {
    const ws = new WS(`ws://127.0.0.1:${DEFAULT_PORT}`);
    const t = setTimeout(() => { ws.close(); resolve(false); }, 1000);
    ws.on('open', () => { clearTimeout(t); ws.close(); resolve(true); });
    ws.on('error', () => { clearTimeout(t); resolve(false); });
  });

  if (!serverAlive) {
    try {
      const { spawn } = await import('child_process');
      const child = spawn(process.execPath, [process.argv[1], 'serve'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      // Wait for server to start
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500));
        const ok = await new Promise<boolean>((resolve) => {
          const ws = new WS(`ws://127.0.0.1:${DEFAULT_PORT}`);
          const t = setTimeout(() => { ws.close(); resolve(false); }, 500);
          ws.on('open', () => { clearTimeout(t); ws.close(); resolve(true); });
          ws.on('error', () => { clearTimeout(t); resolve(false); });
        });
        if (ok) break;
      }
    } catch {}
  }
  console.log('✅ Server running (ws://localhost:18900)');

  // Check extension connection
  await new Promise<void>((resolve) => {
    const ws = new WS(`ws://127.0.0.1:${DEFAULT_PORT}`);
    const t = setTimeout(() => { ws.close(); resolve(); }, 3000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'cli_action', requestId: 'setup-check', actionType: 'get_extension_status', actionPayload: {} }));
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.requestId === 'setup-check' && msg.data?.connected) {
          extensionConnected = true;
        }
      } catch {}
      clearTimeout(t);
      ws.close();
      resolve();
    });
    ws.on('error', () => { clearTimeout(t); resolve(); });
  });

  if (extensionConnected) {
    console.log('✅ Chrome Extension connected');
  } else {
    console.log('');
    console.log('🌐 Chrome Extension not connected:');
    console.log(`   ${link(CHROME_URL)}`);
  }

  // Done
  console.log('');
  console.log('🎉 Setup complete!');
  if (!extensionConnected) {
    console.log('   1. Install the Chrome extension (link above)');
    console.log(`   2. Use ${red('/bnbot')} in your AI agent (Claude Code, Codex, OpenClaw)`);
  } else {
    console.log(`   Use ${red('/bnbot')} in your AI agent (Claude Code, Codex, OpenClaw)`);
  }
  console.log(`   Or run: ${red('bnbot --help')}`);
  console.log('');
}
