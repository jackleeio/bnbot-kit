/**
 * Product Hunt hot products — DOM extraction strategy.
 *
 * Reference: opencli producthunt/hot.ts (INTERCEPT strategy, simplified to DOM scraping).
 * Navigates to the Product Hunt homepage and extracts product cards with vote counts.
 */

import { getTab, checkLoginRedirect } from '../../scraperService';

export interface ProductHuntResult {
  rank: number;
  name: string;
  tagline: string;
  votes: number;
  url: string;
}

export async function fetchProductHuntHot(limit = 20): Promise<ProductHuntResult[]> {
  const count = Math.min(limit, 50);
  const tabId = await getTab('https://www.producthunt.com');
  await new Promise(r => setTimeout(r, 4000));
  await checkLoginRedirect(tabId, 'Product Hunt');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (lim: number) => {
      try {
      const seen = new Set<string>();
      const items: any[] = [];

      // Find product card links (/products/xxx)
      const cardLinks = Array.from(document.querySelectorAll('a[href^="/products/"]')).filter(el => {
        const href = el.getAttribute('href') || '';
        const text = el.textContent?.trim() || '';
        return href && !href.includes('/reviews') && text.length > 0 && text.length < 120;
      });

      const normalizeName = (text: string) => text
        .replace(/^\d+\.\s*/, '')
        .replace(/\s*Launched\s+this\s+(month|week|year|day)\s*/gi, '')
        .replace(/\s*Featured\s*/gi, '')
        .trim();

      for (const cardLink of cardLinks) {
        const href = cardLink.getAttribute('href') || '';
        if (!href || seen.has(href)) continue;

        // Walk up to find the card container with vote count
        let card: Element = cardLink;
        let node = cardLink.parentElement;
        for (let i = 0; i < 6 && node; i++) {
          const hasReviewLink = !!node.querySelector(`a[href="${href}/reviews"]`);
          const hasNumericNode = Array.from(node.querySelectorAll('button, [role="button"], p, span, div'))
            .some(el => /^\d+$/.test(el.textContent?.trim() || ''));
          if (hasReviewLink || hasNumericNode) { card = node; break; }
          node = node.parentElement;
        }

        const name = normalizeName(cardLink.textContent?.trim() || '');
        if (!name) continue;

        // Extract tagline: look for a sibling or child element with descriptive text
        let tagline = '';
        const textEls = card.querySelectorAll('p, span, div');
        for (const te of textEls) {
          const t = te.textContent?.trim() || '';
          if (t.length > 20 && t.length < 200 && t !== name && !/^\d+$/.test(t)) {
            tagline = t;
            break;
          }
        }

        // Extract vote count from button/numeric elements
        const voteCandidates = Array.from(card.querySelectorAll('button, [role="button"], a, p, span, div'))
          .map(el => ({
            text: el.textContent?.trim() || '',
            inButton: !!el.closest('button, [role="button"]'),
            inReviewLink: !!el.closest(`a[href="${href}/reviews"]`),
          }))
          .filter(c => /^\d+$/.test(c.text) && !c.inReviewLink);

        // Pick best vote candidate: prefer button context, then highest number
        const scored = voteCandidates
          .map(c => ({ text: c.text, score: c.inButton ? 4 : 0, value: parseInt(c.text, 10) }))
          .filter(c => c.value > 0)
          .sort((a, b) => b.score !== a.score ? b.score - a.score : b.value - a.value);

        const votes = scored[0]?.value || 0;
        if (!votes) continue;

        seen.add(href);
        items.push({
          name,
          tagline,
          votes,
          url: 'https://www.producthunt.com' + href,
        });
      }

      // Sort by votes descending
      items.sort((a: any, b: any) => b.votes - a.votes);
      const final = items.slice(0, lim).map((item: any, i: number) => ({
        rank: i + 1,
        name: item.name,
        tagline: item.tagline,
        votes: item.votes,
        url: item.url,
      }));

      if (final.length === 0) {
        const url = window.location.href;
        if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
          return { error: 'Please sign in to Product Hunt first' };
        }
        // Try alternative selectors in case DOM structure changed
        const altCards = document.querySelectorAll('[data-test="post-item"], [class*="PostItem"], a[href*="/posts/"]');
        if (altCards.length === 0) {
          const bodyText = (document.body.innerText || '').length;
          if (bodyText <= 100) {
            return { error: 'ProductHunt scraper: page structure may have changed' };
          }
        }
      }

      return final;
      } catch (e: any) {
        return { error: e.message || 'Product Hunt scraper failed' };
      }
    },
    args: [count],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}
