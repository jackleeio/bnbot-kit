import { createInterface } from 'readline';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import WebSocket from 'ws';
import { randomUUID } from 'crypto';
const API_BASE = 'https://api.bnbot.ai';
const DEFAULT_PORT = 18900;
const CLAWMONEY_CONFIG = join(homedir(), '.clawmoney', 'config.yaml');

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

interface LoginData {
  access_token: string;
  refresh_token: string;
  user: { email: string; full_name?: string; name?: string };
}

/**
 * Try to login using clawmoney API key (from ~/.clawmoney/config.yaml).
 * Returns login data if successful, null otherwise.
 */
async function tryClawmoneyLogin(): Promise<LoginData | null> {
  if (!existsSync(CLAWMONEY_CONFIG)) return null;

  try {
    const content = readFileSync(CLAWMONEY_CONFIG, 'utf-8');
    // Simple YAML parse: extract api_key value
    const match = content.match(/^api_key:\s*(.+)$/m);
    const apiKey = match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
    if (!apiKey) return null;

    console.error('Found clawmoney API key, logging in...');
    const res = await fetch(`${API_BASE}/api/v1/claw-agents/auth/login-extension`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      console.error(`API key login failed: ${err.detail || `HTTP ${res.status}`}`);
      return null;
    }

    const data = await res.json() as LoginData;
    console.error(`Logged in as ${data.user.email} (via clawmoney API key)`);
    return data;
  } catch (err) {
    console.error('Failed to read clawmoney config:', (err as Error).message);
    return null;
  }
}

/**
 * Login via email verification code. Returns login data.
 */
async function emailLogin(email: string): Promise<LoginData> {
  // Step 1: Send verification code
  console.error(`Sending verification code to ${email}...`);
  const sendRes = await fetch(`${API_BASE}/api/v1/send-verification-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  if (!sendRes.ok) {
    console.error(`Failed to send verification code: HTTP ${sendRes.status}`);
    process.exit(1);
  }

  console.error('Verification code sent! Check your email.');

  // Step 2: Prompt for code
  const code = await prompt('Enter verification code: ');
  if (!code) {
    console.error('Verification code is required.');
    process.exit(1);
  }

  // Step 3: Verify and get tokens
  console.error('Verifying code...');
  const loginRes = await fetch(`${API_BASE}/api/v1/email-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });

  if (!loginRes.ok) {
    const errData = await loginRes.json().catch(() => ({})) as any;
    console.error(`Login failed: ${errData.detail || `HTTP ${loginRes.status}`}`);
    process.exit(1);
  }

  const loginData = await loginRes.json() as LoginData;
  console.error(`Logged in as ${loginData.user.email}`);
  return loginData;
}

/**
 * Send auth tokens to extension via WebSocket.
 */
function sendTokensToExtension(loginData: LoginData, port: number): void {
  console.error('Sending auth to extension...');
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const requestId = randomUUID();

  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: 'cli_action',
      requestId,
      actionType: 'inject_auth_tokens',
      actionPayload: {
        access_token: loginData.access_token,
        refresh_token: loginData.refresh_token,
        user: loginData.user,
      },
    }));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.requestId === requestId) {
        if (msg.success !== false) {
          console.error('Extension authenticated successfully!');
          console.log(JSON.stringify({ success: true, email: loginData.user.email }));
        } else {
          console.error('Extension auth failed:', msg.error);
          console.log(JSON.stringify({ success: false, error: msg.error }));
        }
        ws.close();
        process.exit(0);
      }
    } catch {}
  });

  ws.on('error', () => {
    console.error('Extension not connected. Login successful but tokens not synced to extension.');
    console.log(JSON.stringify({ success: true, email: loginData.user.email, extensionSynced: false }));
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Timeout waiting for extension response. Login successful but tokens may not be synced.');
    console.log(JSON.stringify({ success: true, email: loginData.user.email, extensionSynced: false }));
    ws.close();
    process.exit(0);
  }, 10000);
}

export async function runLogin(argv: string[]): Promise<void> {
  // Parse --port
  let port = DEFAULT_PORT;
  const portIdx = argv.indexOf('--port');
  if (portIdx !== -1 && argv[portIdx + 1]) {
    port = parseInt(argv[portIdx + 1], 10) || DEFAULT_PORT;
  }

  // Try clawmoney API key first (no email needed)
  const clawLogin = await tryClawmoneyLogin();
  if (clawLogin) {
    sendTokensToExtension(clawLogin, port);
    return;
  }

  // Fallback: email verification
  let email = '';
  const emailIdx = argv.indexOf('--email');
  if (emailIdx !== -1 && argv[emailIdx + 1]) {
    email = argv[emailIdx + 1];
  }
  if (!email) {
    email = await prompt('Email: ');
  }
  if (!email) {
    console.error('Email is required.');
    process.exit(1);
  }

  const loginData = await emailLogin(email);
  sendTokensToExtension(loginData, port);
}
