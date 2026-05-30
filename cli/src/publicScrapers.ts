/**
 * Public API Scrapers — direct fetch, no browser/extension needed.
 * Called as CLI commands: bnbot search-hackernews --query "AI" --limit 5
 *
 * Respects http_proxy / https_proxy / all_proxy env vars via undici ProxyAgent.
 */

import { ProxyAgent, type Dispatcher } from 'undici';

function getDispatcher(): Dispatcher | undefined {
  const proxy = process.env.https_proxy || process.env.http_proxy || process.env.all_proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!proxy) return undefined;
  // Convert socks5:// to http:// for undici (it handles CONNECT tunneling)
  const normalized = proxy.replace(/^socks5:\/\//, 'http://');
  return new ProxyAgent(normalized);
}

const dispatcher = getDispatcher();

// ─── Helpers ────────────────────────────────────────────────────────

async function fetchJSON(url: string, headers?: Record<string, string>) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers }, ...(dispatcher ? { dispatcher } as any : {}) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, ...(dispatcher ? { dispatcher } as any : {}) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function decodeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripHtml(value: unknown): string {
  return decodeHtml(String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function extractXmlTag(block: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cdata = block.match(new RegExp(`<${escaped}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${escaped}>`, 'i'));
  if (cdata) return decodeHtml(cdata[1] ?? '').trim();
  const plain = block.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return decodeHtml(plain?.[1] ?? '').trim();
}

function capInt(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function parseRSS(xml: string, limit: number) {
  const items: any[] = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = re.exec(xml)) && items.length < limit) {
    const block = match[1];
    const title = extractXmlTag(block, 'title');
    const desc = extractXmlTag(block, 'description');
    const link = extractXmlTag(block, 'link') || extractXmlTag(block, 'guid');
    const pubDate = extractXmlTag(block, 'pubDate');
    if (title) items.push({ rank: items.length + 1, title: title.trim(), description: stripHtml(desc).slice(0, 200), url: link.trim() });
    if (pubDate && items.length) items[items.length - 1].date = pubDate;
  }
  return items;
}

async function fetchHnItem(id: number | string): Promise<any> {
  return fetchJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
}

function mapHnStory(s: any, rank: number) {
  return {
    rank,
    id: s.id,
    title: s.title,
    score: s.score ?? 0,
    author: s.by || '',
    comments: s.descendants ?? 0,
    url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
  };
}

async function fetchHnStories(kind: string, limit: unknown) {
  const lim = capInt(limit, 20, 100);
  const ids = (await fetchJSON(`https://hacker-news.firebaseio.com/v0/${kind}stories.json`) || []).slice(0, lim + 10);
  const stories = await Promise.all(ids.map((id: number) => fetchHnItem(id).catch(() => null)));
  return stories.filter((s: any) => s?.title && !s.deleted && !s.dead).slice(0, lim).map((s: any, i: number) => mapHnStory(s, i + 1));
}

function hnHtmlToText(html: unknown): string {
  return decodeHtml(String(html ?? '')
    .replace(/<p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/gi, '\n$1\n')
    .replace(/<[^>]+>/g, '')
    .trim());
}

const BLOOMBERG_FEEDS: Record<string, string> = {
  main: 'https://feeds.bloomberg.com/news.rss',
  markets: 'https://feeds.bloomberg.com/markets/news.rss',
  economics: 'https://feeds.bloomberg.com/economics/news.rss',
  industries: 'https://feeds.bloomberg.com/industries/news.rss',
  tech: 'https://feeds.bloomberg.com/technology/news.rss',
  politics: 'https://feeds.bloomberg.com/politics/news.rss',
  businessweek: 'https://feeds.bloomberg.com/businessweek/news.rss',
  opinions: 'https://feeds.bloomberg.com/bview/news.rss',
};

// ─── Ctrip helpers (ported from opencli clis/ctrip) ─────────────────
// Public destination / hotel-context suggest. One backing endpoint with a
// `searchType` discriminator: D = destination, H = hotel-context.

const CTRIP_SUGGEST_ENDPOINT = 'https://m.ctrip.com/restapi/soa2/21881/json/gaHotelSearchEngine';

async function ctripFetchSuggest(query: string, searchType: 'D' | 'H'): Promise<any[]> {
  const res = await fetch(CTRIP_SUGGEST_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(dispatcher ? { dispatcher } as any : {}),
    body: JSON.stringify({
      keyword: query,
      searchType,
      platform: 'online',
      pageID: '102001',
      head: {
        Locale: 'zh-CN', LocaleController: 'zh_cn', Currency: 'CNY', PageId: '102001',
        clientID: 'bnbot-ctrip', group: 'ctrip',
        Frontend: { sessionID: 1, pvid: 1 },
        HotelExtension: { group: 'CTRIP', WebpSupport: false },
      },
    }),
  });
  if (!res.ok) throw new Error(`ctrip suggest failed with status ${res.status}`);
  const payload: any = await res.json();
  if (payload && payload.Result === false) {
    throw new Error(`ctrip suggest API returned Result=false (ErrorCode=${payload.ErrorCode ?? 'unknown'})`);
  }
  return Array.isArray(payload?.Response?.searchResults) ? payload.Response.searchResults : [];
}

function ctripFirstNonZero(...values: unknown[]): number | null {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return null;
}

function ctripPickCoords(item: any): { lat: number | null; lon: number | null } {
  const cands: [unknown, unknown][] = [[item.gdLat, item.gdLon], [item.gLat, item.gLon], [item.lat, item.lon]];
  for (const [la, lo] of cands) {
    const a = Number(la), o = Number(lo);
    if (Number.isFinite(a) && Number.isFinite(o) && (a !== 0 || o !== 0)) return { lat: a, lon: o };
  }
  return { lat: null, lon: null };
}

function ctripBuildUrl(item: any): string | null {
  const id = item?.id ? String(item.id) : '';
  const cityId = item?.cityId ?? '';
  const cityName = item?.cityName ? String(item.cityName) : '';
  switch (item?.type) {
    case 'City': return cityId ? `https://you.ctrip.com/place/${encodeURIComponent(cityName)}${cityId}.html` : null;
    case 'Markland': return id && cityId ? `https://you.ctrip.com/sight/${encodeURIComponent(cityName)}${cityId}/${id}.html` : null;
    case 'Hotel': return id ? `https://hotels.ctrip.com/hotels/detail/?hotelid=${id}` : null;
    case 'BusinessArea':
    case 'Zone': return cityId && id ? `https://hotels.ctrip.com/hotels/list?city=${cityId}&zone=${id}` : null;
    case 'RailwayStation': return id ? `https://trains.ctrip.com/trainstation/${id}.html` : null;
    default: return null;
  }
}

function ctripMapSuggestRow(item: any, index: number): any {
  const { lat, lon } = ctripPickCoords(item);
  return {
    rank: index + 1,
    id: item?.id ? String(item.id) : null,
    type: item?.type ? String(item.type) : null,
    displayType: item?.displayType ? String(item.displayType).trim() : null,
    name: String(item?.displayName || item?.word || item?.cityName || '').replace(/\s+/g, ' ').trim() || null,
    eName: item?.eName ? String(item.eName).trim() : null,
    cityId: Number.isFinite(item?.cityId) && item.cityId !== 0 ? item.cityId : null,
    cityName: item?.cityName ? String(item.cityName).trim() : null,
    provinceName: item?.provinceName ? String(item.provinceName).trim() : null,
    countryName: item?.countryName ? String(item.countryName).trim() : null,
    lat, lon,
    score: ctripFirstNonZero(item?.commentScore, item?.cStar),
    url: ctripBuildUrl(item),
  };
}

async function ctripSuggest(query: string, searchType: 'D' | 'H', limit: number): Promise<any[]> {
  const q = String(query || '').trim();
  if (!q) throw new Error('ctrip suggest: query is required');
  const lim = capInt(limit, 15, 50);
  const raw = await ctripFetchSuggest(q, searchType);
  return raw
    .filter((it) => it && typeof it === 'object')
    .slice(0, lim)
    .map(ctripMapSuggestRow)
    .filter((r) => r.name);
}

// ─── Scrapers ───────────────────────────────────────────────────────

export const PUBLIC_SCRAPERS: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {

  // ── Ctrip — public suggest endpoints (no browser) ─────────
  'ctrip-search': async (p) => ctripSuggest(String(p.query || p.keyword || ''), 'D', Number(p.limit) || 15),
  'ctrip-hotel-suggest': async (p) => ctripSuggest(String(p.query || p.keyword || ''), 'H', Number(p.limit) || 15),

  // ── Google — public RSS / suggest endpoints ───────────────

  'fetch-google-suggest': async (p) => {
    const query = String(p.query || p.keyword || '').trim();
    if (!query) throw new Error('query is required');
    const lang = String(p.lang || 'zh-CN');
    const lim = capInt(p.limit, 10, 50);
    const data = await fetchJSON(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}&hl=${encodeURIComponent(lang)}`);
    const suggestions = Array.isArray(data?.[1]) ? data[1] : [];
    return suggestions.slice(0, lim).map((suggestion: string, i: number) => ({ rank: i + 1, suggestion }));
  },

  'fetch-google-news': async (p) => {
    const query = String(p.query || p.keyword || '').trim();
    const lang = String(p.lang || 'en');
    const region = String(p.region || p.country || 'US').toUpperCase();
    const ceid = `${region}:${lang}`;
    const rssUrl = query
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${encodeURIComponent(lang)}&gl=${encodeURIComponent(region)}&ceid=${encodeURIComponent(ceid)}`
      : `https://news.google.com/rss?hl=${encodeURIComponent(lang)}&gl=${encodeURIComponent(region)}&ceid=${encodeURIComponent(ceid)}`;
    const xml = await fetchText(rssUrl);
    return parseRSS(xml, capInt(p.limit, 20, 100)).map((item: any) => {
      const idx = String(item.title || '').lastIndexOf(' - ');
      return {
        ...item,
        title: idx > 0 ? item.title.slice(0, idx) : item.title,
        source: idx > 0 ? item.title.slice(idx + 3) : '',
      };
    });
  },

  'fetch-google-trends': async (p) => {
    const region = String(p.region || p.geo || 'US').toUpperCase();
    const xml = await fetchText(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(region)}`);
    const rows: any[] = [];
    const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
    let m;
    const lim = capInt(p.limit, 20, 100);
    while ((m = re.exec(xml)) && rows.length < lim) {
      const block = m[1] || '';
      rows.push({
        rank: rows.length + 1,
        title: extractXmlTag(block, 'title'),
        traffic: extractXmlTag(block, 'ht:approx_traffic'),
        date: extractXmlTag(block, 'pubDate'),
      });
    }
    return rows.filter((row) => row.title);
  },

  'search-hackernews': async (p) => {
    const sort = p.sort === 'date' ? 'search_by_date' : 'search';
    const data = await fetchJSON(`https://hn.algolia.com/api/v1/${sort}?query=${encodeURIComponent(String(p.query))}&tags=story&hitsPerPage=${p.limit || 20}`);
    return (data.hits || []).map((h: any, i: number) => ({
      rank: i + 1, id: h.objectID, title: h.title, score: h.points, author: h.author, comments: h.num_comments,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    }));
  },

  'fetch-hackernews-ask': async (p) => fetchHnStories('ask', p.limit),

  'fetch-hackernews-read': async (p) => {
    const id = String(p.id || '').trim();
    if (!/^\d+$/.test(id)) throw new Error('numeric HN item id is required');
    const topLimit = capInt(p.limit, 25, 100);
    const maxDepth = capInt(p.depth, 2, 10);
    const maxReplies = capInt(p.replies, 5, 50);
    const maxLength = capInt(p.maxLength ?? p.max_length, 2000, 20_000);
    const story = await fetchHnItem(id);
    if (!story || story.deleted || story.dead) throw new Error(`HN item not found: ${id}`);
    const rows: any[] = [{
      type: 'POST',
      author: story.by || '[deleted]',
      score: story.score ?? 0,
      text: [story.title || '', hnHtmlToText(story.text || ''), story.url || `https://news.ycombinator.com/item?id=${story.id}`].filter(Boolean).join('\n').trim(),
    }];
    async function walk(node: any, depth: number): Promise<void> {
      if (!node || node.deleted || node.dead || node.type !== 'comment') return;
      const body = hnHtmlToText(node.text || '');
      rows.push({
        type: depth === 0 ? 'L0' : `L${depth}`,
        author: node.by || '[deleted]',
        score: '',
        text: body.length > maxLength ? `${body.slice(0, maxLength)}...` : body,
      });
      const kids = Array.isArray(node.kids) ? node.kids : [];
      if (depth + 1 >= maxDepth) {
        if (kids.length) rows.push({ type: `L${depth + 1}`, author: '', score: '', text: `[+${kids.length} more replies]` });
        return;
      }
      const replies = await Promise.all(kids.slice(0, maxReplies).map((kid: number) => fetchHnItem(kid).catch(() => null)));
      for (const reply of replies) await walk(reply, depth + 1);
      if (kids.length > maxReplies) rows.push({ type: `L${depth + 1}`, author: '', score: '', text: `[+${kids.length - maxReplies} more replies]` });
    }
    const topKids = Array.isArray(story.kids) ? story.kids : [];
    const comments = await Promise.all(topKids.slice(0, topLimit).map((kid: number) => fetchHnItem(kid).catch(() => null)));
    for (const comment of comments) await walk(comment, 0);
    if (topKids.length > topLimit) rows.push({ type: '', author: '', score: '', text: `[+${topKids.length - topLimit} more top-level comments]` });
    return rows;
  },

  'fetch-hackernews-user': async (p) => {
    const username = String(p.username || p.user || '').trim();
    if (!username) throw new Error('username is required');
    const item = await fetchJSON(`https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(username)}.json`);
    if (!item) throw new Error(`HN user not found: ${username}`);
    return [{
      username: item.id,
      karma: item.karma ?? 0,
      created: item.created ? new Date(item.created * 1000).toISOString().slice(0, 10) : '',
      about: stripHtml(item.about || ''),
    }];
  },

  'search-stackoverflow': async (p) => {
    const data = await fetchJSON(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(String(p.query))}&site=stackoverflow`);
    return (data.items || []).slice(0, Number(p.limit) || 10).map((i: any, idx: number) => ({
      rank: idx + 1, title: i.title, score: i.score, answers: i.answer_count, url: i.link,
    }));
  },

  'search-wikipedia': async (p) => {
    const lang = String(p.lang || 'en');
    const data = await fetchJSON(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(String(p.query))}&srlimit=${p.limit || 10}&format=json&utf8=1`);
    return (data.query?.search || []).map((r: any, i: number) => ({
      rank: i + 1, title: r.title, snippet: r.snippet.replace(/<[^>]+>/g, '').slice(0, 120),
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    }));
  },

  'search-apple-podcasts': async (p) => {
    const data = await fetchJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(String(p.query))}&media=podcast&limit=${Math.min(Number(p.limit) || 10, 25)}`);
    return (data.results || []).map((r: any, i: number) => ({
      rank: i + 1, title: r.collectionName, author: r.artistName, episodes: r.trackCount, genre: r.primaryGenreName, url: r.collectionViewUrl,
    }));
  },

  'search-substack': async (p) => {
    const data = await fetchJSON(`https://substack.com/api/v1/post/search?query=${encodeURIComponent(String(p.query))}&page=0&includePlatformResults=true`, { Accept: 'application/json' });
    return (data.results || []).slice(0, Number(p.limit) || 20).map((i: any, idx: number) => ({
      rank: idx + 1, title: (i.title || '').trim(), author: (i.publishedBylines?.[0]?.name || '').trim(),
      date: (i.post_date || '').split('T')[0], url: i.canonical_url || '',
    }));
  },

  'search-sinablog': async (p) => {
    const data = await fetchJSON(`https://search.sina.com.cn/api/search?q=${encodeURIComponent(String(p.query))}&tp=mix&sort=0&page=1&size=${Math.max(Number(p.limit) || 20, 10)}&from=search_result`, { Accept: 'application/json' });
    return (data.data?.list || []).slice(0, Number(p.limit) || 20).map((i: any, idx: number) => ({
      rank: idx + 1, title: (i.title || '').replace(/<[^>]+>/g, ''), author: i.media_show || i.author, date: i.time, description: (i.intro || i.searchSummary || '').replace(/<[^>]+>/g, '').trim().slice(0, 150), url: i.url,
    }));
  },

  'fetch-sinafinance-news': async (p) => {
    const tags = [0, 10, 1, 3, 4, 5, 102, 6, 6, 8];
    const data = await fetchJSON(`https://app.cj.sina.com.cn/api/news/pc?page=1&size=${p.limit || 20}&tag=${tags[Number(p.type) || 0] ?? 0}`);
    return (data.result?.data?.feed?.list || []).map((i: any) => ({
      id: i.id, time: i.create_time, content: (i.rich_text || '').replace(/<[^>]+>/g, '').trim(), views: i.view_num,
    }));
  },

  'fetch-v2ex-hot': async () => {
    const data = await fetchJSON('https://www.v2ex.com/api/topics/hot.json');
    return (data || []).map((t: any, i: number) => ({
      rank: i + 1, title: t.title, replies: t.replies, node: t.node?.title, url: t.url,
    }));
  },

  'fetch-bloomberg-news': async (p) => {
    const feed = String(p.feed || p.section || 'markets');
    const xml = await fetchText(BLOOMBERG_FEEDS[feed] || BLOOMBERG_FEEDS.markets);
    return parseRSS(xml, Number(p.limit) || 20);
  },

  'fetch-bloomberg-feeds': async () =>
    Object.entries(BLOOMBERG_FEEDS).map(([name, url]) => ({ name, url })),

  'fetch-bbc-news': async (p) => {
    const xml = await fetchText('https://feeds.bbci.co.uk/news/rss.xml');
    return parseRSS(xml, Number(p.limit) || 20);
  },

  'fetch-bbc-topic': async (p) => {
    const topic = String(p.topic || '').trim();
    const allowed = new Set(['world', 'business', 'politics', 'health', 'education', 'science_and_environment', 'technology', 'entertainment_and_arts']);
    if (!allowed.has(topic)) throw new Error(`unsupported BBC topic: ${topic}`);
    const xml = await fetchText(`https://feeds.bbci.co.uk/news/${topic}/rss.xml`);
    return parseRSS(xml, capInt(p.limit, 20, 100));
  },

  'fetch-medium-tag': async (p) => {
    const tag = String(p.tag || p.topic || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(tag)) throw new Error('valid Medium tag is required');
    const xml = await fetchText(`https://medium.com/feed/tag/${encodeURIComponent(tag)}`);
    const rows: any[] = [];
    const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
    let m;
    const lim = capInt(p.limit, 20, 25);
    while ((m = re.exec(xml)) && rows.length < lim) {
      const block = m[1] || '';
      const categories: string[] = [];
      const catRe = /<category[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/category>/gi;
      let c;
      while ((c = catRe.exec(block))) {
        const value = decodeHtml(c[1] ?? c[2] ?? '').trim();
        if (value) categories.push(value);
      }
      rows.push({
        rank: rows.length + 1,
        title: extractXmlTag(block, 'title'),
        author: extractXmlTag(block, 'dc:creator'),
        description: stripHtml(extractXmlTag(block, 'description')),
        categories: categories.join(', '),
        published: extractXmlTag(block, 'pubDate'),
        url: extractXmlTag(block, 'link'),
      });
    }
    return rows.filter((row) => row.title);
  },

  'fetch-substack-publication': async (p) => {
    const rawUrl = String(p.url || p.publication || '').trim();
    if (!rawUrl) throw new Error('publication url is required');
    const base = rawUrl.startsWith('http') ? new URL(rawUrl) : new URL(`https://${rawUrl}`);
    const xml = await fetchText(`${base.origin}/feed`);
    return parseRSS(xml, capInt(p.limit, 20, 50));
  },

  'fetch-yahoo-finance-quote': async (p) => {
    const symbol = String(p.symbol || p.ticker || '').trim().toUpperCase();
    if (!symbol) throw new Error('symbol is required');
    const data = await fetchJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`);
    const chart = data?.chart?.result?.[0];
    if (!chart) throw new Error(`quote not found: ${symbol}`);
    const meta = chart.meta || {};
    const prevClose = meta.previousClose || meta.chartPreviousClose;
    const price = meta.regularMarketPrice;
    const change = price != null && prevClose != null ? price - prevClose : null;
    const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;
    return [{
      symbol: meta.symbol || symbol,
      name: meta.shortName || meta.longName || symbol,
      price: price != null ? Number(price.toFixed(4)) : null,
      change: change != null ? Number(change.toFixed(4)) : null,
      changePercent: changePct != null ? `${changePct.toFixed(2)}%` : null,
      open: chart.indicators?.quote?.[0]?.open?.[0] ?? null,
      high: meta.regularMarketDayHigh ?? null,
      low: meta.regularMarketDayLow ?? null,
      volume: meta.regularMarketVolume ?? null,
      currency: meta.currency,
      exchange: meta.exchangeName,
    }];
  },

  'fetch-xiaoyuzhou-podcast': async (p) => {
    const html = await fetchText(`https://www.xiaoyuzhoufm.com/podcast/${p.podcastId}`);
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/);
    if (!match) throw new Error('Failed to extract page data');
    const pod = JSON.parse(match[1]).props?.pageProps?.podcast;
    if (!pod) throw new Error('Podcast not found');
    return { title: pod.title, author: pod.author, description: (pod.brief || '').slice(0, 200), subscribers: pod.subscriptionCount, episodes: pod.episodeCount };
  },

  // ── HackerNews — top, new, best, show, jobs ──────────────

  'fetch-hackernews-top': async (p) => fetchHnStories('top', p.limit),
  'fetch-hackernews-new': async (p) => fetchHnStories('new', p.limit),
  'fetch-hackernews-best': async (p) => fetchHnStories('best', p.limit),
  'fetch-hackernews-show': async (p) => fetchHnStories('show', p.limit),
  'fetch-hackernews-jobs': async (p) => fetchHnStories('job', p.limit),

  // ── V2EX — latest ────────────────────────────────────────

  'fetch-v2ex-latest': async () => {
    const data = await fetchJSON('https://www.v2ex.com/api/topics/latest.json');
    return (data || []).map((t: any, i: number) => ({ rank: i + 1, title: t.title, replies: t.replies, node: t.node?.title, url: t.url }));
  },

  // ── StackOverflow — hot ──────────────────────────────────

  'fetch-stackoverflow-hot': async (p) => {
    const data = await fetchJSON(`https://api.stackexchange.com/2.3/questions?order=desc&sort=hot&site=stackoverflow&pagesize=${p.limit || 10}`);
    return (data.items || []).map((i: any, idx: number) => ({ rank: idx + 1, title: i.title, score: i.score, answers: i.answer_count, url: i.link }));
  },

  // ── Wikipedia — summary ──────────────────────────────────

  'fetch-wikipedia-summary': async (p) => {
    const lang = String(p.lang || 'en');
    const data = await fetchJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(String(p.title))}`);
    return { title: data.title, extract: data.extract, url: data.content_urls?.desktop?.page };
  },

  'fetch-wikipedia-random': async (p) => {
    const lang = String(p.lang || 'en');
    const data = await fetchJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/random/summary`);
    return [{ title: data.title, description: data.description || '', extract: data.extract || '', url: data.content_urls?.desktop?.page }];
  },

  'fetch-wikipedia-trending': async (p) => {
    const lang = String(p.lang || 'en');
    let articles: any[] = [];
    // Most-read data can lag behind featured feed publication by a day.
    for (let offset = 1; offset <= 7 && articles.length === 0; offset++) {
      const d = new Date(Date.now() - offset * 86_400_000);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const data = await fetchJSON(`https://${lang}.wikipedia.org/api/rest_v1/feed/featured/${yyyy}/${mm}/${dd}`);
      articles = data?.mostread?.articles || [];
    }
    return articles.slice(0, capInt(p.limit, 10, 50)).map((a: any, i: number) => ({
      rank: i + 1,
      title: a.title,
      description: a.description || '',
      views: a.views ?? 0,
      url: a.content_urls?.desktop?.page,
    }));
  },

  'fetch-wikipedia-page': async (p) => {
    const title = String(p.title || '').trim();
    if (!title) throw new Error('title is required');
    const lang = String(p.lang || 'en').toLowerCase();
    const paragraphs = capInt(p.paragraphs, 0, 500);
    const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('prop', 'extracts|info|description');
    url.searchParams.set('inprop', 'url');
    url.searchParams.set('explaintext', '1');
    url.searchParams.set('redirects', '1');
    url.searchParams.set('titles', title);
    const data = await fetchJSON(url.toString(), { Accept: 'application/json' });
    const page = Array.isArray(data?.query?.pages) ? data.query.pages[0] : null;
    if (!page || page.missing) throw new Error(`Wikipedia page not found: ${title}`);
    const allParas = String(page.extract || '').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
    const paras = paragraphs > 0 ? allParas.slice(0, paragraphs) : allParas;
    return [{
      title: page.title,
      description: page.description || '',
      pageId: page.pageid ?? null,
      paragraphs: paras.length,
      extract: paras.join('\n\n'),
      url: page.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(page.title).replace(/ /g, '_'))}`,
    }];
  },

  // ── Xiaoyuzhou — episodes ────────────────────────────────

  'fetch-xiaoyuzhou-episodes': async (p) => {
    const html = await fetchText(`https://www.xiaoyuzhoufm.com/podcast/${p.podcastId}`);
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/);
    if (!match) throw new Error('Failed to extract page data');
    const data = JSON.parse(match[1]);
    const episodes = data.props?.pageProps?.podcast?.episodes || data.props?.pageProps?.episodes || [];
    return episodes.slice(0, Number(p.limit) || 20).map((e: any, i: number) => ({
      rank: i + 1, title: e.title, duration: e.duration, date: e.pubDate?.split('T')[0] || '',
    }));
  },
};

/** Names of all public scraper commands */
export const PUBLIC_SCRAPER_NAMES = Object.keys(PUBLIC_SCRAPERS);

/** Run a public scraper directly (no WebSocket needed) */
export async function runPublicScraper(name: string, params: Record<string, unknown>): Promise<void> {
  const scraper = PUBLIC_SCRAPERS[name];
  if (!scraper) throw new Error(`Unknown public scraper: ${name}`);
  const result = await scraper(params);
  console.log(JSON.stringify(result, null, 2));
}
