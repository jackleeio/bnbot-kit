/**
 * Instagram search scraper — uses Instagram's topsearch API with browser cookies.
 *
 * API: /web/search/topsearch/?query=...&context=user
 * Requires the X-IG-App-ID header (hardcoded public app ID).
 */

import { getTab, checkLoginRedirect, executeInPage } from '../../scraperService';

export interface InstagramResult {
  rank: number;
  username: string;
  name: string;
  verified: boolean;
  private: boolean;
  url: string;
}

export interface InstagramExploreResult {
  rank: number;
  user: string;
  caption: string;
  likes: number;
  comments: number;
  type: string;
}

export async function fetchInstagramExplore(limit = 20): Promise<InstagramExploreResult[]> {
  const tabId = await getTab('https://www.instagram.com');
  await checkLoginRedirect(tabId, 'Instagram');

  const data = await executeInPage(tabId, async (lim: number) => {
      try {
        const res = await fetch(
          'https://www.instagram.com/api/v1/discover/web/explore_grid/',
          {
            credentials: 'include',
            headers: { 'X-IG-App-ID': '936619743392459' },
          },
        );
        if (!res.ok) return { error: 'Instagram explore failed: HTTP ' + res.status + ' — please sign in to Instagram first' };
        const data = await res.json();
        const posts: any[] = [];
        for (const sec of (data?.sectional_items || [])) {
          for (const m of (sec?.layout_content?.medias || [])) {
            const media = m?.media;
            if (media) posts.push({
              user: media.user?.username || '',
              caption: (media.caption?.text || '').replace(/\n/g, ' ').substring(0, 100),
              likes: media.like_count ?? 0,
              comments: media.comment_count ?? 0,
              type: media.media_type === 1 ? 'photo' : media.media_type === 2 ? 'video' : 'carousel',
            });
          }
        }
        if (posts.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Instagram first' };
          }
        }
        return posts.slice(0, lim).map((p: any, i: number) => ({
          rank: i + 1,
          ...p,
        }));
      } catch (e: any) {
        return { error: e.message || 'Instagram explore scraper failed' };
      }
    }, [limit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

export async function searchInstagram(query: string, limit = 10): Promise<InstagramResult[]> {
  const tabId = await getTab('https://www.instagram.com');
  await checkLoginRedirect(tabId, 'Instagram');

  const data = await executeInPage(tabId, async (q: string, lim: number) => {
      try {
        const res = await fetch(
          'https://www.instagram.com/web/search/topsearch/?query=' + encodeURIComponent(q) + '&context=user',
          {
            credentials: 'include',
            headers: { 'X-IG-App-ID': '936619743392459' },
          },
        );
        if (!res.ok) return { error: 'Instagram search failed: HTTP ' + res.status + ' — please sign in to Instagram first' };
        const data = await res.json();
        const users = (data?.users || []).slice(0, lim);
        if (users.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Instagram first' };
          }
        }

        return users.map((item: any, i: number) => ({
          rank: i + 1,
          username: item.user?.username || '',
          name: item.user?.full_name || '',
          verified: !!item.user?.is_verified,
          private: !!item.user?.is_private,
          url: 'https://www.instagram.com/' + (item.user?.username || ''),
        }));
      } catch (e: any) {
        return { error: e.message || 'Instagram scraper failed' };
      }
    }, [query, limit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}
