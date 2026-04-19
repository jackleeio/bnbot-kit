#!/usr/bin/env node

/**
 * Crawl 东方财富 hot stock ranking
 * Requires: opencli (npm install -g @jackwener/opencli)
 * Usage: node scripts/crawl-eastmoney.js
 * Output: JSON array of RawContent to stdout
 */

import { runOpencli } from './lib/opencli.js';

async function tryOpencli() {
  const data = await runOpencli(['eastmoney', 'hot-rank', '-f', 'json', '--limit', '20']);
  if (!data || !Array.isArray(data) || data.length === 0) return null;
  process.stderr.write(`[crawl-eastmoney] opencli ${data.length} results\n`);
  return data.map((item, i) => ({
    id: `eastmoney-${item.symbol || i}`,
    source: 'eastmoney',
    sourceUrl: item.url || `https://guba.eastmoney.com`,
    title: `${item.name || ''} (${item.symbol || ''}) ${item.changePercent || ''}`,
    body: `价格: ${item.price || '-'} | 热度: ${item.heat || '-'} | 涨跌: ${item.changePercent || '-'}`,
    tags: ['eastmoney', '股票', '热榜'],
    rank: item.rank || i + 1,
    metrics: { heat: item.heat || 0 },
    author: '东方财富',
    crawledAt: new Date().toISOString(),
    publishedAt: null,
    language: 'zh',
  }));
}

const results = await tryOpencli() || [];
console.log(JSON.stringify(results, null, 2));
process.stderr.write(`[crawl-eastmoney] Fetched ${results.length} items\n`);
