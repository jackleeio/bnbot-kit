/**
 * WeChat (Weixin) article content extraction — DOM scraping strategy.
 *
 * Reference: opencli weixin/download.ts (COOKIE strategy, simplified to content extraction).
 * Navigates to a WeChat article URL and extracts title, author, date, and content text.
 */

import { getTab, checkLoginRedirect } from '../../scraperService';

export interface WeixinArticleResult {
  title: string;
  author: string;
  publishTime: string;
  content: string;
  sourceUrl: string;
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

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (srcUrl: string) => {
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

        // Content: #js_content
        const contentEl = document.querySelector('#js_content');
        let content = '';
        if (contentEl) {
          // Remove noise elements
          contentEl.querySelectorAll('script, style, .qr_code_pc, .reward_area').forEach(el => el.remove());
          // Get text content (strip HTML but preserve newlines for paragraphs)
          const blocks: string[] = [];
          contentEl.querySelectorAll('p, section, h1, h2, h3, h4, h5, h6, li, blockquote').forEach(el => {
            const text = (el as HTMLElement).innerText?.trim();
            if (text) blocks.push(text);
          });
          content = blocks.length > 0 ? blocks.join('\n\n') : (contentEl as HTMLElement).innerText?.trim() || '';
        }

        if (!title && !content) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to WeChat first' };
          }
        }

        return { title, author, publishTime, content, sourceUrl: srcUrl };
      } catch (e: any) {
        return { error: e.message || 'WeChat article scraper failed' };
      }
    },
    args: [normalizedUrl],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || null;
}
