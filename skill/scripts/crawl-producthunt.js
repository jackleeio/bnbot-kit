#!/usr/bin/env node

/**
 * Crawl Product Hunt top products
 * Strategy 1: opencli (browser bridge — has vote counts, taglines)
 * Strategy 2: RSS feed (public, no browser needed, limited data)
 * Usage: node scripts/crawl-producthunt.js
 * Output: JSON array of RawContent to stdout
 */

import Parser from 'rss-parser';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import proxyFetch from './lib/fetch.js';
import { runOpencli } from './lib/opencli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, '../config/sources.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const TOP_N = config.producthunt?.topN || 15;

// ── Strategy 1: opencli (best — browser bridge with vote counts) ───

async function tryOpencli() {
  const data = await runOpencli(['producthunt', 'hot', '-f', 'json', '--limit', String(TOP_N)]);
  if (!data || !Array.isArray(data) || data.length === 0) return null;

  process.stderr.write(`[crawl-ph] Using opencli (${data.length} results)\n`);
  return data.map((item, rank) => ({
    id: `ph-${item.slug || item.id || rank}`,
    source: 'producthunt',
    sourceUrl: item.url || item.link || '',
    title: item.name || item.title || '',
    body: (item.tagline || item.description || '').slice(0, 500),
    image: item.thumbnail || item.image || null,
    tags: ['producthunt', 'startup', 'product'],
    rank: rank + 1,
    metrics: {
      upvotes: item.votes || item.votesCount || item.upvotes || 0,
      comments: item.commentsCount || item.comments || 0,
    },
    author: item.maker || item.author || '',
    crawledAt: new Date().toISOString(),
    publishedAt: item.publishedAt || item.createdAt || null,
    language: 'en',
  }));
}

// ── Strategy 2: RSS feed (fallback — no votes/author) ──────────────

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
}

function extractImage(html) {
  const match = html?.match(/<img[^>]+src="([^"]+)"/);
  return match?.[1] || null;
}

async function tryRss() {
  const res = await proxyFetch('https://www.producthunt.com/feed', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) return null;
  const xml = await res.text();

  const parser = new Parser();
  const feed = await parser.parseString(xml);
  const items = (feed.items || []).slice(0, TOP_N);

  if (items.length === 0) return null;

  process.stderr.write(`[crawl-ph] Using RSS fallback (${items.length} results)\n`);
  return items.map((item, rank) => {
    const slug = item.link?.split('/posts/')?.[1] || `ph-${rank}`;
    const image = extractImage(item.content || item['content:encoded'] || '');

    return {
      id: `ph-${slug}`,
      source: 'producthunt',
      sourceUrl: item.link || '',
      title: item.title || '',
      body: stripHtml(item.contentSnippet || item.content || '').slice(0, 500),
      image: image,
      tags: ['producthunt', 'startup', 'product'],
      rank: rank + 1,
      metrics: {},
      author: item.creator || '',
      crawledAt: new Date().toISOString(),
      publishedAt: item.pubDate || item.isoDate || null,
      language: 'en',
    };
  });
}

// ── Main ─────────────────────────────────────────────────────

const results = await tryOpencli() || await tryRss() || [];

if (results.length === 0) {
  process.stderr.write('[crawl-ph] Failed — both opencli and RSS returned no results\n');
}

console.log(JSON.stringify(results, null, 2));
process.stderr.write(`[crawl-ph] Fetched ${results.length} products\n`);
