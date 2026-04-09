#!/usr/bin/env node

/**
 * Crawl Watcha.cn hot AI products via their search API
 * Usage: node scripts/crawl-watcha.js [--limit N]
 * Output: JSON array of RawContent to stdout
 *
 * API supports skip/limit pagination, max 100 per request.
 * When limit > 100, fetches multiple pages automatically.
 */

import proxyFetch from './lib/fetch.js';

const PAGE_SIZE = 100; // API max per request
const DEFAULT_LIMIT = 20;

function parseArgs() {
  const idx = process.argv.indexOf('--limit');
  const limit = idx !== -1 ? parseInt(process.argv[idx + 1], 10) : DEFAULT_LIMIT;
  return { limit: limit > 0 ? limit : DEFAULT_LIMIT };
}

async function fetchPage(skip, limit) {
  const res = await proxyFetch(`https://watcha.cn/api/v2/search/general?q=&skip=${skip}&limit=${limit}`, {
    method: 'POST',
    headers: {
      'accept': 'application/json, text/plain, */*',
      'content-type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      options: {
        domains: ['product'],
        product_options: {
          facets: ['category_ids', 'tag_ids'],
          tag_ids: [],
          order_by: ['hot_score:desc'],
        },
      },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Watcha API HTTP ${res.status}`);
  const json = await res.json();
  const products = json?.data?.product?.products;
  return {
    items: products?.items || [],
    total: products?.total || 0,
  };
}

function toRawContent(item, rank) {
  return {
    id: `watcha-${item.id}`,
    source: 'watcha',
    sourceUrl: `https://watcha.cn/products/${item.slug}`,
    title: item.name || '',
    body: (item.slogan || '').slice(0, 500),
    image: item.image_url || item.avatar_url || null,
    tags: ['watcha', 'ai', ...(item.categories || []).map(c => c.name)],
    rank,
    metrics: {
      upvotes: item.stats?.upvotes || 0,
      stars: item.stats?.stars || 0,
      comments: item.stats?.review_count || 0,
      score: item.stats?.score || 0,
    },
    author: item.organization || '',
    crawledAt: new Date().toISOString(),
    publishedAt: item.create_at || null,
    language: 'zh',
  };
}

async function crawl() {
  const { limit } = parseArgs();
  const allItems = [];

  while (allItems.length < limit) {
    const pageSize = Math.min(PAGE_SIZE, limit - allItems.length);
    const { items, total } = await fetchPage(allItems.length, pageSize);
    allItems.push(...items);
    process.stderr.write(`[crawl-watcha] Page fetched: skip=${allItems.length - items.length}, got ${items.length} (total=${total})\n`);
    if (items.length < pageSize || allItems.length >= total) break;
  }

  return allItems.map((item, i) => toRawContent(item, i + 1));
}

crawl()
  .then(results => {
    console.log(JSON.stringify(results, null, 2));
    process.stderr.write(`[crawl-watcha] Fetched ${results.length} products\n`);
  })
  .catch(err => {
    process.stderr.write(`[crawl-watcha] Error: ${err.message}\n`);
    process.exit(1);
  });
