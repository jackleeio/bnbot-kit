#!/usr/bin/env node

/**
 * One-time script to get a Chrome Web Store OAuth2 refresh token.
 *
 * Prerequisites:
 *   1. In Google Cloud Console, go to your OAuth client settings
 *   2. Add "http://localhost:8818" as an Authorized redirect URI
 *   3. Set CWS_CLIENT_ID and CWS_CLIENT_SECRET in .env
 *
 * Usage:
 *   node scripts/get-refresh-token.js
 */

import http from 'http';
import { URL } from 'url';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

// Read .env manually
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    envVars[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
  }
}

const CLIENT_ID = envVars.CWS_CLIENT_ID;
const CLIENT_SECRET = envVars.CWS_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Missing CWS_CLIENT_ID or CWS_CLIENT_SECRET in .env');
  process.exit(1);
}

const PORT = 8818;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

const authUrl = `https://accounts.google.com/o/oauth2/auth?response_type=code&scope=${encodeURIComponent(SCOPE)}&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&access_type=offline&prompt=consent`;

console.log('🔐 Opening browser for Google OAuth...\n');
console.log('If the browser does not open automatically, visit:\n');
console.log(authUrl);
console.log('');

// Open browser
try {
  execSync(`open "${authUrl}"`);
} catch {
  // fallback: user can manually open the URL
}

// Start local server to capture the redirect
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>❌ Authorization denied: ${error}</h1><p>You can close this tab.</p>`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Waiting for authorization...</h1>');
    return;
  }

  // Exchange code for tokens
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const data = await tokenRes.json();

    if (data.error) {
      throw new Error(`${data.error}: ${data.error_description}`);
    }

    const refreshToken = data.refresh_token;
    if (!refreshToken) {
      throw new Error('No refresh_token in response. Make sure prompt=consent is set.');
    }

    // Save to .env
    let env = fs.readFileSync(envPath, 'utf8');
    if (env.match(/^CWS_REFRESH_TOKEN=/m)) {
      env = env.replace(/^CWS_REFRESH_TOKEN=.*$/m, `CWS_REFRESH_TOKEN=${refreshToken}`);
    } else {
      env = env.trimEnd() + `\nCWS_REFRESH_TOKEN=${refreshToken}\n`;
    }
    fs.writeFileSync(envPath, env);

    console.log('✅ Refresh token saved to .env');
    console.log(`   CWS_REFRESH_TOKEN=${refreshToken}`);

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>✅ Success!</h1><p>Refresh token saved. You can close this tab.</p>');
  } catch (err) {
    console.error('❌ Token exchange failed:', err.message);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>❌ Error</h1><p>${err.message}</p>`);
  }

  server.close();
});

server.listen(PORT, () => {
  console.log(`⏳ Waiting for OAuth callback on http://localhost:${PORT}...\n`);
});
