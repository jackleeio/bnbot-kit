#!/usr/bin/env node

/**
 * Crawl 牛客网 hot search ranking (public API, no login required)
 * Requires: opencli (npm install -g @jackwener/opencli)
 * Usage: node scripts/crawl-nowcoder.js
 * Output: JSON array of RawContent to stdout
 */

import { runOpencli } from './lib/opencli.js';
import proxyFetch from './lib/fetch.js';

async function tryOpencli() {
  const data = await runOpencli(['nowcoder', 'hot', '-f', 'json', '--limit', '20']);
  if (!data || !Array.isArray(data) || data.length === 0) return null;
  process.stderr.write(`[crawl-nowcoder] opencli ${data.length} results\n`);
  return data.map((item) => ({
    id: `nowcoder-${item.rank}-${encodeURIComponent(item.title || '')}`,
    source: 'nowcoder',
    sourceUrl: `https://www.nowcoder.com/search?query=${encodeURIComponent(item.title || '')}`,
    title: item.title || '',
    body: `热度: ${item.heat || '-'}`,
    tags: ['nowcoder', '技术', '求职', '热榜'],
    rank: item.rank || 0,
    metrics: { heat: item.heat || 0 },
    author: '牛客网',
    crawledAt: new Date().toISOString(),
    publishedAt: null,
    language: 'zh',
  }));
}

async function tryDirectApi() {
  try {
    const res = await proxyFetch('https://gw-c.nowcoder.com/api/sparta/hot-search/hot-content', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const items = json?.data?.hotQuery || [];
    if (items.length === 0) return null;
    process.stderr.write(`[crawl-nowcoder] direct API ${items.length} results\n`);
    return items.slice(0, 20).map((item) => ({
      id: `nowcoder-${item.rank}-${encodeURIComponent(item.query || '')}`,
      source: 'nowcoder',
      sourceUrl: `https://www.nowcoder.com/search?query=${encodeURIComponent(item.query || '')}`,
      title: item.query || '',
      body: `热度: ${item.hotValue || '-'}`,
      tags: ['nowcoder', '技术', '求职', '热榜'],
      rank: item.rank || 0,
      metrics: { heat: item.hotValue || 0 },
      author: '牛客网',
      crawledAt: new Date().toISOString(),
      publishedAt: null,
      language: 'zh',
    }));
  } catch {
    return null;
  }
}

const results = await tryOpencli() || await tryDirectApi() || [];
console.log(JSON.stringify(results, null, 2));
process.stderr.write(`[crawl-nowcoder] Fetched ${results.length} items\n`);
