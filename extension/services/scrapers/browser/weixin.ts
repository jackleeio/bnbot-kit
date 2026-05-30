/**
 * WeChat (Weixin) article content extraction — DOM scraping strategy.
 *
 * Reference: opencli weixin/download.ts (COOKIE strategy, simplified to content extraction).
 * Navigates to a WeChat article URL and extracts title, author, date, and content text.
 */

import { getTab, checkLoginRedirect, executeInPage } from '../../scraperService';

export interface WeixinArticleResult {
  title: string;
  author: string;
  publishTime: string;
  content: string;
  images: string[];
  coverImage: string;
  sourceUrl: string;
}

export interface WeixinSearchResult {
  rank: number;
  page: number;
  title: string;
  url: string;
  summary: string;
  publish_time: string;
}

export async function searchWeixinArticles(query: string, options: { page?: number; limit?: number } = {}): Promise<WeixinSearchResult[]> {
  const q = String(query || '').trim();
  if (!q) throw new Error('Weixin search query is required');
  const pageNo = Math.max(1, Number.isFinite(options.page || 0) ? Math.floor(options.page || 1) : 1);
  const limit = Math.max(1, Math.min(options.limit || 10, 10));
  const url = new URL('https://weixin.sogou.com/weixin');
  url.searchParams.set('query', q);
  url.searchParams.set('type', '2');
  url.searchParams.set('page', String(pageNo));
  url.searchParams.set('ie', 'utf8');

  const tabId = await getTab(url.toString());
  await new Promise(r => setTimeout(r, 2500));

  const data = await executeInPage(tabId, (lim: number, pageNum: number) => {
    try {
      const clean = (value: string | null | undefined) =>
        (value || '')
          .replace(/\s+/g, ' ')
          .replace(/<!--red_beg-->|<!--red_end-->/g, '')
          .replace(/document\.write\(timeConvert\('\d+'\)\)/g, '')
          .trim();
      const absolutize = (href: string | null | undefined) => {
        if (!href) return '';
        try { return new URL(href, window.location.origin).toString(); } catch { return href; }
      };
      const bodyText = clean(document.body?.innerText);
      if (/验证码|安全验证|异常访问|访问过于频繁|请输入验证码/.test(bodyText)) {
        return { error: 'Sogou Weixin blocked this search request; complete verification in Chrome and retry' };
      }
      const cards = Array.from(document.querySelectorAll('.news-list li'));
      const rows = cards.map((item, index) => {
        const linkEl = item.querySelector('h3 a[href]') as HTMLAnchorElement | null;
        const summaryEl = item.querySelector('p.txt-info');
        const timeEl = item.querySelector('.s-p .s2');
        return {
          rank: (pageNum - 1) * 10 + index + 1,
          page: pageNum,
          title: clean(linkEl?.textContent),
          url: absolutize(linkEl?.getAttribute('href')),
          summary: clean(summaryEl?.textContent),
          publish_time: clean(timeEl?.textContent),
        };
      }).filter((row) => row.title && row.url);
      return rows.slice(0, lim);
    } catch (e: any) {
      return { error: e.message || 'Weixin search scraper failed' };
    }
  }, [limit, pageNo]);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

/**
 * Extract a WeChat Official Account article's content.
 * @param url - Full WeChat article URL (https://mp.weixin.qq.com/s/xxx)
 */
export async function fetchWeixinArticle(url: string): Promise<WeixinArticleResult | null> {
  // Normalize URL
  let normalizedUrl = url.trim();
  if (normalizedUrl.startsWith('mp.weixin.qq.com/') || normalizedUrl.startsWith('//mp.weixin.qq.com/')) {
    normalizedUrl = 'https://' + normalizedUrl.replace(/^\/+/, '');
  }
  try {
    const parsed = new URL(normalizedUrl);
    if (parsed.hostname.toLowerCase() === 'mp.weixin.qq.com') {
      parsed.protocol = 'https:';
      normalizedUrl = parsed.toString();
    }
  } catch { /* keep as-is */ }

  if (!normalizedUrl.includes('mp.weixin.qq.com')) {
    return null;
  }

  const tabId = await getTab(normalizedUrl);
  await new Promise(r => setTimeout(r, 5000));
  await checkLoginRedirect(tabId, 'WeChat');

  const data = await executeInPage(tabId, (srcUrl: string) => {
      try {
        // Title: #activity-name
        const titleEl = document.querySelector('#activity-name');
        const title = titleEl ? titleEl.textContent!.trim() : '';

        // Author (WeChat Official Account name): #js_name
        const authorEl = document.querySelector('#js_name');
        const author = authorEl ? authorEl.textContent!.trim() : '';

        // Publish time
        const publishTimeEl = document.querySelector('#publish_time');
        let publishTime = publishTimeEl?.textContent?.trim() || '';

        // Fallback: extract create_time from page source
        if (!publishTime) {
          const html = document.documentElement.innerHTML;
          const jsDecodeMatch = html.match(/create_time\s*:\s*JsDecode\('([^']+)'\)/);
          const directMatch = html.match(/create_time\s*[:=]\s*(?:"([^"]+)"|'([^']+)'|([0-9A-Za-z]+))/);
          const raw = jsDecodeMatch?.[1] || directMatch?.[1] || directMatch?.[2] || directMatch?.[3] || '';
          if (/^\d{10}$|^\d{13}$/.test(raw)) {
            const ts = parseInt(raw, 10);
            const ms = raw.length === 13 ? ts : ts * 1000;
            const d = new Date(ms + 8 * 3600 * 1000);
            const pad = (n: number) => String(n).padStart(2, '0');
            publishTime = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
          }
        }

        const normalizeImageUrl = (raw: string | null): string => {
          if (!raw) return '';
          const decoded = raw.replace(/&amp;/g, '&').trim();
          if (!decoded || !decoded.startsWith('http')) return '';
          return decoded;
        };

        // Content: #js_content. Preserve image positions as Markdown
        // placeholders so downstream rewrite flows don't silently drop
        // visual context.
        const contentEl = document.querySelector('#js_content');
        let content = '';
        const images: string[] = [];
        if (contentEl) {
          // Remove noise elements
          contentEl.querySelectorAll('script, style, .qr_code_pc, .reward_area').forEach(el => el.remove());
          const chunks: string[] = [];
          const seenImages = new Set<string>();
          const blockTags = new Set(['P', 'DIV', 'SECTION', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE']);

          const visit = (node: Node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              const text = node.textContent?.trim();
              if (text) chunks.push(text);
              return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;

            const el = node as Element;
            if (el.tagName === 'IMG') {
              const src = normalizeImageUrl(el.getAttribute('data-src') || el.getAttribute('src'));
              if (src && (src.includes('mmbiz.qpic.cn') || src.includes('mmbiz.qlogo.cn'))) {
                if (!seenImages.has(src)) {
                  seenImages.add(src);
                  images.push(src);
                  chunks.push(`\n![图片${images.length}](${src})\n`);
                }
              }
              return;
            }

            if (blockTags.has(el.tagName)) chunks.push('\n');
            el.childNodes.forEach(visit);
            if (blockTags.has(el.tagName)) chunks.push('\n');
          };

          contentEl.childNodes.forEach(visit);
          content = chunks.join('')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        }

        let coverImage = '';
        const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
        const twitterImage = document.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
        coverImage = normalizeImageUrl(ogImage || twitterImage);

        if (!title && !content) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to WeChat first' };
          }
        }

        return { title, author, publishTime, content, images, coverImage, sourceUrl: srcUrl };
      } catch (e: any) {
        return { error: e.message || 'WeChat article scraper failed' };
      }
    }, [normalizedUrl]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || null;
}
