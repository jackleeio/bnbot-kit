#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const packagePath = path.join(rootDir, 'package.json');
const manifestPath = path.join(rootDir, 'manifest.json');
const firefoxManifestPath = path.join(rootDir, 'manifest.firefox.json');

const type = process.argv[2] || 'patch';

if (!['patch', 'minor', 'major'].includes(type)) {
  console.error('Usage: node scripts/bump-version.js [patch|minor|major]');
  console.error('  patch: 0.3.2 -> 0.3.3 (bug fixes)');
  console.error('  minor: 0.3.2 -> 0.4.0 (new features)');
  console.error('  major: 0.3.2 -> 1.0.0 (breaking changes)');
  process.exit(1);
}

// Read current version
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);

// Bump version
let newVersion;
if (type === 'major') {
  newVersion = `${major + 1}.0.0`;
} else if (type === 'minor') {
  newVersion = `${major}.${minor + 1}.0`;
} else {
  newVersion = `${major}.${minor}.${patch + 1}`;
}

// Update package.json
pkg.version = newVersion;
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');

// Update manifest.json
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.version = newVersion;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// Update manifest.firefox.json
if (fs.existsSync(firefoxManifestPath)) {
  const firefoxManifest = JSON.parse(fs.readFileSync(firefoxManifestPath, 'utf8'));
  firefoxManifest.version = newVersion;
  fs.writeFileSync(firefoxManifestPath, JSON.stringify(firefoxManifest, null, 2) + '\n');
}

console.log(`✅ Version bumped: ${pkg.version.replace(newVersion, '')}${major}.${minor}.${patch} -> ${newVersion}`);
console.log('');
console.log('Next steps:');
console.log(`  1. Update CHANGELOG.md with [${newVersion}] changes`);
console.log('  2. git add -A && git commit -m "chore: bump version to ' + newVersion + '"');
console.log('  3. git tag v' + newVersion);
