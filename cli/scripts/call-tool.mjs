#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const toolName = process.argv[2];
const rawArgs = process.argv[3] || '{}';
const waitSeconds = Number(process.argv[4] || '25');
const toolTimeoutMs = Number(process.argv[5] || '240000');

if (!toolName) {
  console.error('Usage: node scripts/call-tool.mjs <toolName> [jsonArgs] [waitSeconds]');
  process.exit(1);
}

let parsedArgs = {};
try {
  parsedArgs = JSON.parse(rawArgs);
} catch (err) {
  console.error('Invalid JSON args:', rawArgs);
  process.exit(1);
}

const client = new Client({
  name: 'bnbot-mcp-tester',
  version: '0.1.0',
});

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  cwd: process.cwd(),
  stderr: 'inherit',
});

async function waitForExtensionConnected(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const status = await client.callTool({
        name: 'get_extension_status',
        arguments: {},
      });
      const text = status?.content?.[0]?.text;
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed?.success && parsed?.data?.connected) {
          return true;
        }
      }
    } catch {
      // ignore and retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  await client.connect(transport);
  const connected = await waitForExtensionConnected(waitSeconds * 1000);

  if (!connected) {
    console.error(`Extension not connected within ${waitSeconds}s`);
    process.exitCode = 2;
    return;
  }

  const result = await client.callTool(
    {
      name: toolName,
      arguments: parsedArgs,
    },
    undefined,
    {
      timeout: toolTimeoutMs,
      resetTimeoutOnProgress: true,
      maxTotalTimeout: toolTimeoutMs + 30000,
    }
  );

  console.log(JSON.stringify(result, null, 2));
}

try {
  await main();
} catch (err) {
  console.error('Call failed:', err);
  process.exitCode = 1;
} finally {
  await client.close();
}
