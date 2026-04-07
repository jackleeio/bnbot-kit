/**
 * Bilibili search scraper — uses WBI-signed API with browser cookies.
 *
 * API: /x/web-interface/wbi/search/type (requires WBI signature)
 * WBI signing: fetch nav data for img/sub keys, generate mixin key, MD5 sign params.
 */

import { getTab, checkLoginRedirect, executeInPage } from '../../scraperService';

export interface BilibiliResult {
  rank: number;
  title: string;
  author: string;
  score: number;
  url: string;
}

export interface BilibiliHotResult {
  rank: number;
  title: string;
  author: string;
  play: number;
  danmaku: number;
  url: string;
}

export async function fetchBilibiliHot(limit = 20): Promise<BilibiliHotResult[]> {
  const tabId = await getTab('https://www.bilibili.com');
  await checkLoginRedirect(tabId, 'Bilibili');

  const data = await executeInPage(tabId, async (lim: number) => {
      try {
        const res = await fetch('https://api.bilibili.com/x/web-interface/popular?ps=' + lim + '&pn=1', {
          credentials: 'include',
        });
        if (!res.ok) return { error: 'Bilibili hot failed: HTTP ' + res.status + ' — please sign in to Bilibili first' };
        const payload = await res.json();
        const list: any[] = payload?.data?.list ?? [];
        if (list.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Bilibili first' };
          }
        }
        return list.slice(0, lim).map((item: any, i: number) => ({
          rank: i + 1,
          title: item.title ?? '',
          author: item.owner?.name ?? '',
          play: item.stat?.view ?? 0,
          danmaku: item.stat?.danmaku ?? 0,
          url: item.bvid ? 'https://www.bilibili.com/video/' + item.bvid : '',
        }));
      } catch (e: any) {
        return { error: e.message || 'Bilibili hot scraper failed' };
      }
    }, [limit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

export interface BilibiliRankingResult {
  rank: number;
  title: string;
  author: string;
  score: number;
  url: string;
}

export async function fetchBilibiliRanking(limit = 20): Promise<BilibiliRankingResult[]> {
  const tabId = await getTab('https://www.bilibili.com');
  await checkLoginRedirect(tabId, 'Bilibili');

  const data = await executeInPage(tabId, async (lim: number) => {
      try {
        const res = await fetch('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all', {
          credentials: 'include',
        });
        if (!res.ok) return { error: 'Bilibili ranking failed: HTTP ' + res.status + ' — please sign in to Bilibili first' };
        const payload = await res.json();
        const list: any[] = payload?.data?.list ?? [];
        if (list.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Bilibili first' };
          }
        }
        return list.slice(0, lim).map((item: any, i: number) => ({
          rank: i + 1,
          title: item.title ?? '',
          author: item.owner?.name ?? '',
          score: item.stat?.view ?? 0,
          url: item.bvid ? 'https://www.bilibili.com/video/' + item.bvid : '',
        }));
      } catch (e: any) {
        return { error: e.message || 'Bilibili ranking scraper failed' };
      }
    }, [limit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

export async function searchBilibili(
  query: string,
  limit = 20,
  options: { type?: 'video' | 'user'; page?: number } = {},
): Promise<BilibiliResult[]> {
  const tabId = await getTab('https://www.bilibili.com');
  await checkLoginRedirect(tabId, 'Bilibili');

  const data = await executeInPage(tabId, async (keyword: string, lim: number, searchType: string, pageNum: number) => {
      try {
      // ── WBI signing logic (ported from opencli bilibili/utils.ts) ──
      const MIXIN_KEY_ENC_TAB = [
        46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,
        33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,
        61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,
        36,20,34,44,52,
      ];

      function getMixinKey(imgKey: string, subKey: string): string {
        const raw = imgKey + subKey;
        return MIXIN_KEY_ENC_TAB.map(i => raw[i] || '').join('').slice(0, 32);
      }

      async function md5(text: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('MD5', data).catch(async () => {
          // MD5 not available in SubtleCrypto in some browsers; use manual implementation
          return null;
        });
        if (hashBuffer) {
          return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        // Fallback: simple MD5 implementation
        function md5Fallback(str: string): string {
          function safeAdd(x: number, y: number) { const lsw = (x & 0xffff) + (y & 0xffff); return ((x >> 16) + (y >> 16) + (lsw >> 16)) << 16 | lsw & 0xffff; }
          function bitRotateLeft(num: number, cnt: number) { return num << cnt | num >>> 32 - cnt; }
          function md5cmn(q: number, a: number, b: number, x: number, s: number, t: number) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
          function md5ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return md5cmn(b & c | ~b & d, a, b, x, s, t); }
          function md5gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return md5cmn(b & d | c & ~d, a, b, x, s, t); }
          function md5hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
          function md5ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }
          function wordsToHex(input: number[]) { const hexTab = '0123456789abcdef'; let output = ''; for (let i = 0; i < input.length * 32; i += 8) output += hexTab.charAt(input[i >> 5] >>> i % 32 & 0xf) + hexTab.charAt(input[i >> 5] >>> (i % 32 + 4) & 0xf); return output; }
          function bytesToWords(input: string) { const output: number[] = []; for (let i = 0; i < input.length * 8; i += 8) output[i >> 5] |= (input.charCodeAt(i / 8) & 0xff) << i % 32; return output; }
          const x = bytesToWords(str); const len = str.length * 8; x[len >> 5] |= 0x80 << len % 32; x[(len + 64 >>> 9 << 4) + 14] = len;
          let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
          for (let i = 0; i < x.length; i += 16) {
            const olda = a, oldb = b, oldc = c, oldd = d;
            a = md5ff(a,b,c,d,x[i],7,-680876936); d = md5ff(d,a,b,c,x[i+1],12,-389564586); c = md5ff(c,d,a,b,x[i+2],17,606105819); b = md5ff(b,c,d,a,x[i+3],22,-1044525330);
            a = md5ff(a,b,c,d,x[i+4],7,-176418897); d = md5ff(d,a,b,c,x[i+5],12,1200080426); c = md5ff(c,d,a,b,x[i+6],17,-1473231341); b = md5ff(b,c,d,a,x[i+7],22,-45705983);
            a = md5ff(a,b,c,d,x[i+8],7,1770035416); d = md5ff(d,a,b,c,x[i+9],12,-1958414417); c = md5ff(c,d,a,b,x[i+10],17,-42063); b = md5ff(b,c,d,a,x[i+11],22,-1990404162);
            a = md5ff(a,b,c,d,x[i+12],7,1804603682); d = md5ff(d,a,b,c,x[i+13],12,-40341101); c = md5ff(c,d,a,b,x[i+14],17,-1502002290); b = md5ff(b,c,d,a,x[i+15],22,1236535329);
            a = md5gg(a,b,c,d,x[i+1],5,-165796510); d = md5gg(d,a,b,c,x[i+6],9,-1069501632); c = md5gg(c,d,a,b,x[i+11],14,643717713); b = md5gg(b,c,d,a,x[i],20,-373897302);
            a = md5gg(a,b,c,d,x[i+5],5,-701558691); d = md5gg(d,a,b,c,x[i+10],9,38016083); c = md5gg(c,d,a,b,x[i+15],14,-660478335); b = md5gg(b,c,d,a,x[i+4],20,-405537848);
            a = md5gg(a,b,c,d,x[i+9],5,568446438); d = md5gg(d,a,b,c,x[i+14],9,-1019803690); c = md5gg(c,d,a,b,x[i+3],14,-187363961); b = md5gg(b,c,d,a,x[i+8],20,1163531501);
            a = md5gg(a,b,c,d,x[i+13],5,-1444681467); d = md5gg(d,a,b,c,x[i+2],9,-51403784); c = md5gg(c,d,a,b,x[i+7],14,1735328473); b = md5gg(b,c,d,a,x[i+12],20,-1926607734);
            a = md5hh(a,b,c,d,x[i+5],4,-378558); d = md5hh(d,a,b,c,x[i+8],11,-2022574463); c = md5hh(c,d,a,b,x[i+11],16,1839030562); b = md5hh(b,c,d,a,x[i],23,-35309556);
            a = md5hh(a,b,c,d,x[i+3],4,-1530992060); d = md5hh(d,a,b,c,x[i+6],11,1272893353); c = md5hh(c,d,a,b,x[i+9],16,-155497632); b = md5hh(b,c,d,a,x[i+12],23,-1094730640);
            a = md5hh(a,b,c,d,x[i+15],4,681279174); d = md5hh(d,a,b,c,x[i+2],11,-358537222); c = md5hh(c,d,a,b,x[i+5],16,-722521979); b = md5hh(b,c,d,a,x[i+8],23,76029189);
            a = md5hh(a,b,c,d,x[i+11],4,-640364487); d = md5hh(d,a,b,c,x[i+14],11,-421815835); c = md5hh(c,d,a,b,x[i+1],16,530742520); b = md5hh(b,c,d,a,x[i+4],23,-995338651);
            a = md5ii(a,b,c,d,x[i],6,-198630844); d = md5ii(d,a,b,c,x[i+7],10,1126891415); c = md5ii(c,d,a,b,x[i+14],15,-1416354905); b = md5ii(b,c,d,a,x[i+5],21,-57434055);
            a = md5ii(a,b,c,d,x[i+12],6,1700485571); d = md5ii(d,a,b,c,x[i+3],10,-1894986606); c = md5ii(c,d,a,b,x[i+10],15,-1051523); b = md5ii(b,c,d,a,x[i+1],21,-2054922799);
            a = md5ii(a,b,c,d,x[i+8],6,1873313359); d = md5ii(d,a,b,c,x[i+15],10,-30611744); c = md5ii(c,d,a,b,x[i+6],15,-1560198380); b = md5ii(b,c,d,a,x[i+13],21,1309151649);
            a = md5ii(a,b,c,d,x[i+4],6,-145523070); d = md5ii(d,a,b,c,x[i+11],10,-1120210379); c = md5ii(c,d,a,b,x[i+2],15,718787259); b = md5ii(b,c,d,a,x[i+9],21,-343485551);
            a = safeAdd(a, olda); b = safeAdd(b, oldb); c = safeAdd(c, oldc); d = safeAdd(d, oldd);
          }
          return wordsToHex([a, b, c, d]);
        }
        return md5Fallback(text);
      }

      // 1. Get WBI keys from nav API
      const navRes = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
      const navData = await navRes.json();
      const wbiImg = navData?.data?.wbi_img ?? {};
      const imgKey = (wbiImg.img_url ?? '').split('/').pop()?.split('.')[0] ?? '';
      const subKey = (wbiImg.sub_url ?? '').split('/').pop()?.split('.')[0] ?? '';
      const mixinKey = getMixinKey(imgKey, subKey);

      // 2. Build and sign params
      const wts = Math.floor(Date.now() / 1000);
      const rawParams: Record<string, any> = {
        search_type: searchType,
        keyword,
        page: pageNum,
        wts: String(wts),
      };
      const sorted: Record<string, string> = {};
      for (const key of Object.keys(rawParams).sort()) {
        sorted[key] = String(rawParams[key]).replace(/[!'()*]/g, '');
      }
      const query = new URLSearchParams(sorted).toString().replace(/\+/g, '%20');
      const wRid = await md5(query + mixinKey);
      sorted.w_rid = wRid;

      // 3. Fetch search results
      const qs = new URLSearchParams(sorted).toString().replace(/\+/g, '%20');
      const res = await fetch(
        'https://api.bilibili.com/x/web-interface/wbi/search/type?' + qs,
        { credentials: 'include' },
      );
      if (!res.ok) return { error: 'Bilibili search failed: HTTP ' + res.status + ' — please sign in to Bilibili first' };
      const payload = await res.json();
      const items: any[] = payload?.data?.result ?? [];
      if (items.length === 0) {
        const url = window.location.href;
        if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
          return { error: 'Please sign in to Bilibili first' };
        }
      }

      const strip = (html: string) => (html || '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').trim();

      return items.slice(0, lim).map((item: any, i: number) => {
        if (searchType === 'bili_user') {
          return {
            rank: i + 1,
            title: strip(item.uname ?? ''),
            author: (item.usign ?? '').trim(),
            score: item.fans ?? 0,
            url: item.mid ? `https://space.bilibili.com/${item.mid}` : '',
          };
        }
        return {
          rank: i + 1,
          title: strip(item.title ?? ''),
          author: item.author ?? '',
          score: item.play ?? 0,
          url: item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : '',
        };
      });
      } catch (e: any) {
        return { error: e.message || 'Bilibili scraper failed' };
      }
    }, [
      query,
      limit,
      options.type === 'user' ? 'bili_user' : 'video',
      options.page || 1,
    ]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}
