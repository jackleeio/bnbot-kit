#!/usr/bin/env node

/**
 * Automated Chrome Web Store publish script.
 *
 * Usage:
 *   node scripts/publish.js           # Upload only (draft)
 *   node scripts/publish.js --publish  # Upload and publish
 *
 * Required .env vars:
 *   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_EXTENSION_ID
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const manifestPath = path.join(rootDir, 'manifest.json');
const packagePath = path.join(rootDir, 'package.json');
const distDir = path.join(rootDir, 'dist');
const releasesDir = path.join(rootDir, 'releases');

const shouldPublish = process.argv.includes('--publish');

// ── Load .env ──────────────────────────────────────────────
const envContent = fs.readFileSync(path.join(rootDir, '.env'), 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
  }
}

const { CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_EXTENSION_ID } = env;
const missing = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_EXTENSION_ID']
  .filter(k => !env[k]);
if (missing.length) {
  console.error(`❌ Missing in .env: ${missing.join(', ')}`);
  console.error('   Run "node scripts/get-refresh-token.js" to get the refresh token.');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const version = pkg.version;
const zipName = `bnbot-v${version}.zip`;
const zipPath = path.join(releasesDir, zipName);

console.log(`\n📦 Publishing BNBOT v${version}${shouldPublish ? ' (will auto-publish)' : ' (upload only)'}\n`);

// ── Step 1: Remove localhost URLs from manifest ────────────
console.log('1️⃣  Removing localhost URLs from manifest.json...');
const originalManifest = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(originalManifest);

// Remove localhost from host_permissions
manifest.host_permissions = manifest.host_permissions.filter(
  p => !p.includes('localhost')
);

// Remove localhost from CSP connect-src
if (manifest.content_security_policy?.extension_pages) {
  manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages
    .replace(/\s*ws:\/\/localhost:\*\s*/g, ' ')
    .replace(/\s*http:\/\/localhost:\*\s*/g, ' ')
    .replace(/\s+/g, ' ');
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// ── Step 2: Build ──────────────────────────────────────────
console.log('2️⃣  Building production release...');
try {
  execSync('npm run build:release', { cwd: rootDir, stdio: 'inherit' });
} catch {
  // Restore manifest before exiting
  fs.writeFileSync(manifestPath, originalManifest);
  console.error('❌ Build failed. Manifest restored.');
  process.exit(1);
}

// ── Step 3: Restore manifest ───────────────────────────────
console.log('3️⃣  Restoring manifest.json...');
fs.writeFileSync(manifestPath, originalManifest);

// ── Step 4: Zip ────────────────────────────────────────────
console.log(`4️⃣  Creating ${zipName}...`);
if (!fs.existsSync(releasesDir)) {
  fs.mkdirSync(releasesDir, { recursive: true });
}
// Remove old zip if exists
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}
execSync(`cd "${distDir}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });

// ── Step 5: Upload to Chrome Web Store ─────────────────────
console.log('5️⃣  Uploading to Chrome Web Store...');
try {
  const uploadCmd = [
    'npx chrome-webstore-upload upload',
    `--source "${zipPath}"`,
    `--extension-id "${CWS_EXTENSION_ID}"`,
    `--client-id "${CWS_CLIENT_ID}"`,
    `--client-secret "${CWS_CLIENT_SECRET}"`,
    `--refresh-token "${CWS_REFRESH_TOKEN}"`,
  ].join(' ');
  execSync(uploadCmd, { cwd: rootDir, stdio: 'inherit' });
  console.log('✅ Upload successful!');
} catch (err) {
  console.error('❌ Upload failed.');
  process.exit(1);
}

// ── Step 6: Publish (optional) ─────────────────────────────
if (shouldPublish) {
  console.log('6️⃣  Publishing...');
  try {
    const publishCmd = [
      'npx chrome-webstore-upload publish',
      `--extension-id "${CWS_EXTENSION_ID}"`,
      `--client-id "${CWS_CLIENT_ID}"`,
      `--client-secret "${CWS_CLIENT_SECRET}"`,
      `--refresh-token "${CWS_REFRESH_TOKEN}"`,
    ].join(' ');
    execSync(publishCmd, { cwd: rootDir, stdio: 'inherit' });
    console.log('✅ Published!');
  } catch {
    console.error('❌ Publish failed. The extension was uploaded but not published.');
    process.exit(1);
  }
}

console.log(`\n🎉 Done! v${version} → ${zipName}\n`);
