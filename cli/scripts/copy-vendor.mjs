#!/usr/bin/env node
/**
 * Post-build: copy src/vendor/ into dist/vendor/ so the runtime can resolve
 * vendored modules (e.g. the bundled gemini-watermark-remover 1.0.15) via
 * relative import paths. tsc does not emit .js files it didn't compile, so
 * we copy them manually.
 */
import { cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'src', 'vendor');
const dst = join(root, 'dist', 'vendor');

if (!existsSync(src)) {
  console.warn('[copy-vendor] no src/vendor — skip');
  process.exit(0);
}

cpSync(src, dst, { recursive: true });
console.log(`[copy-vendor] ${src} → ${dst}`);
