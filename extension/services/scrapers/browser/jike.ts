/**
 * Jike search scraper — navigates to search page and extracts posts via React fiber tree.
 *
 * Unlike other scrapers that call JSON APIs, Jike requires navigating to the search URL
 * and extracting data from the DOM via React internal fiber properties.
 */

import { getTab, checkLoginRedirect } from '../../scraperService';

export interface JikeResult {
  rank: number;
  author: string;
  content: string;
  likes: number;
  comments: number;
  time: string;
  url: string;
}

export async function searchJike(query: string, limit = 20): Promise<JikeResult[]> {
  // Navigate directly to the search results page
  const searchUrl = 'https://web.okjike.com/search?q=' + encodeURIComponent(query);
  const tabId = await getTab(searchUrl);

  // Wait for search results to render
  await new Promise(r => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'Jike');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (lim: number) => {
      try {
        // React fiber extraction — walk up to 10 levels to find post data
        function getPostData(element: Element): any {
          for (const key of Object.keys(element)) {
            if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
              let fiber = (element as any)[key];
              for (let i = 0; i < 10 && fiber; i++) {
                const props = fiber.memoizedProps || fiber.pendingProps;
                if (props && props.data && props.data.id) return props.data;
                fiber = fiber.return;
              }
            }
          }
          return null;
        }

        const postResults: any[] = [];
        const seen = new Set<string>();
        const elements = document.querySelectorAll('[class*="_post_"], [class*="_postItem_"]');

        for (const el of elements) {
          if (postResults.length >= lim) break;
          const data = getPostData(el);
          if (!data || !data.id || seen.has(data.id)) continue;
          seen.add(data.id);

          const author = data.user?.screenName || data.target?.user?.screenName || '';
          const content = data.content || data.target?.content || '';
          if (!author && !content) continue;

          postResults.push({
            rank: postResults.length + 1,
            author,
            content: content.replace(/\n/g, ' ').slice(0, 120),
            likes: data.likeCount || 0,
            comments: data.commentCount || 0,
            time: data.actionTime || data.createdAt || '',
            url: 'https://web.okjike.com/originalPost/' + data.id,
          });
        }

        if (postResults.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Jike first' };
          }
        }

        return postResults;
      } catch (e: any) {
        return { error: e.message || 'Jike scraper failed — please sign in to Jike first' };
      }
    },
    args: [limit],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}
