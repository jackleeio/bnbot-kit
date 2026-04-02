#!/usr/bin/env node

/**
 * Post-install: automatically install BNBot skill to all agent platforms.
 * Runs after `npm i -g @bnbot/cli`.
 */

const { mkdirSync, writeFileSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');

const SKILL_URL = 'https://bnbot.ai/skill.md';
const TARGETS = [
  { dir: join(homedir(), '.claude', 'commands'), file: 'bnbot.md' },
  { dir: join(homedir(), '.agents', 'skills', 'bnbot'), file: 'SKILL.md' },
];

async function main() {
  try {
    const res = await fetch(SKILL_URL);
    if (!res.ok) return;
    const content = await res.text();
    if (!content.startsWith('---')) return;

    for (const t of TARGETS) {
      try {
        mkdirSync(t.dir, { recursive: true });
        writeFileSync(join(t.dir, t.file), content);
      } catch {}
    }
    console.log('[BNBot] ✅ Skill installed → use /bnbot in Claude Code, Codex, or OpenClaw');
  } catch {}
}

main();
