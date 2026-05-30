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

export interface BilibiliVideoDetail {
  bvid: string;
  aid: string;
  title: string;
  author: string;
  mid: string;
  category: string;
  publish_time: string;
  duration: number;
  view: number;
  danmaku: number;
  reply: number;
  like: number;
  coin: number;
  favorite: number;
  share: number;
  parts: number;
  thumbnail: string;
  description: string;
  url: string;
}

function normalizeBvid(input: string): string {
  const raw = String(input || '').trim();
  const match = raw.match(/BV[A-Za-z0-9]+/);
  if (!match) throw new Error('Bilibili BV ID or video URL is required');
  return match[0];
}

async function biliApiGet(
  tabId: number,
  path: string,
  params: Record<string, string | number | undefined> = {},
  signed = false,
): Promise<any> {
  const payload = await executeInPage(tabId, async (
    apiPath: string,
    rawParams: Record<string, string | number | undefined>,
    needSign: boolean,
  ) => {
    try {
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
      function md5(str: string): string {
        function sa(x: number,y: number){const l=(x&0xffff)+(y&0xffff);return((x>>16)+(y>>16)+(l>>16))<<16|l&0xffff;}
        function rl(n: number,c: number){return n<<c|n>>>32-c;}
        function cm(q: number,a: number,b: number,x: number,s: number,t: number){return sa(rl(sa(sa(a,q),sa(x,t)),s),b);}
        function ff(a: number,b: number,c: number,d: number,x: number,s: number,t: number){return cm(b&c|~b&d,a,b,x,s,t);}
        function gg(a: number,b: number,c: number,d: number,x: number,s: number,t: number){return cm(b&d|c&~d,a,b,x,s,t);}
        function hh(a: number,b: number,c: number,d: number,x: number,s: number,t: number){return cm(b^c^d,a,b,x,s,t);}
        function ii(a: number,b: number,c: number,d: number,x: number,s: number,t: number){return cm(c^(b|~d),a,b,x,s,t);}
        function wth(n: number[]){const h='0123456789abcdef';let o='';for(let i=0;i<n.length*32;i+=8)o+=h.charAt(n[i>>5]>>>(i%32)&0xf)+h.charAt(n[i>>5]>>>((i%32)+4)&0xf);return o;}
        function btw(s: string){const o:number[]=[];for(let i=0;i<s.length*8;i+=8)o[i>>5]|=(s.charCodeAt(i/8)&0xff)<<i%32;return o;}
        const x=btw(str),len=str.length*8;x[len>>5]|=0x80<<len%32;x[(len+64>>>9<<4)+14]=len;let a=1732584193,b=-271733879,c=-1732584194,d=271733878;
        for(let i=0;i<x.length;i+=16){const oa=a,ob=b,oc=c,od=d;a=ff(a,b,c,d,x[i],7,-680876936);d=ff(d,a,b,c,x[i+1],12,-389564586);c=ff(c,d,a,b,x[i+2],17,606105819);b=ff(b,c,d,a,x[i+3],22,-1044525330);a=ff(a,b,c,d,x[i+4],7,-176418897);d=ff(d,a,b,c,x[i+5],12,1200080426);c=ff(c,d,a,b,x[i+6],17,-1473231341);b=ff(b,c,d,a,x[i+7],22,-45705983);a=ff(a,b,c,d,x[i+8],7,1770035416);d=ff(d,a,b,c,x[i+9],12,-1958414417);c=ff(c,d,a,b,x[i+10],17,-42063);b=ff(b,c,d,a,x[i+11],22,-1990404162);a=ff(a,b,c,d,x[i+12],7,1804603682);d=ff(d,a,b,c,x[i+13],12,-40341101);c=ff(c,d,a,b,x[i+14],17,-1502002290);b=ff(b,c,d,a,x[i+15],22,1236535329);a=gg(a,b,c,d,x[i+1],5,-165796510);d=gg(d,a,b,c,x[i+6],9,-1069501632);c=gg(c,d,a,b,x[i+11],14,643717713);b=gg(b,c,d,a,x[i],20,-373897302);a=gg(a,b,c,d,x[i+5],5,-701558691);d=gg(d,a,b,c,x[i+10],9,38016083);c=gg(c,d,a,b,x[i+15],14,-660478335);b=gg(b,c,d,a,x[i+4],20,-405537848);a=gg(a,b,c,d,x[i+9],5,568446438);d=gg(d,a,b,c,x[i+14],9,-1019803690);c=gg(c,d,a,b,x[i+3],14,-187363961);b=gg(b,c,d,a,x[i+8],20,1163531501);a=gg(a,b,c,d,x[i+13],5,-1444681467);d=gg(d,a,b,c,x[i+2],9,-51403784);c=gg(c,d,a,b,x[i+7],14,1735328473);b=gg(b,c,d,a,x[i+12],20,-1926607734);a=hh(a,b,c,d,x[i+5],4,-378558);d=hh(d,a,b,c,x[i+8],11,-2022574463);c=hh(c,d,a,b,x[i+11],16,1839030562);b=hh(b,c,d,a,x[i],23,-35309556);a=hh(a,b,c,d,x[i+3],4,-1530992060);d=hh(d,a,b,c,x[i+6],11,1272893353);c=hh(c,d,a,b,x[i+9],16,-155497632);b=hh(b,c,d,a,x[i+12],23,-1094730640);a=hh(a,b,c,d,x[i+15],4,681279174);d=hh(d,a,b,c,x[i+2],11,-358537222);c=hh(c,d,a,b,x[i+5],16,-722521979);b=hh(b,c,d,a,x[i+8],23,76029189);a=hh(a,b,c,d,x[i+11],4,-640364487);d=hh(d,a,b,c,x[i+14],11,-421815835);c=hh(c,d,a,b,x[i+1],16,530742520);b=hh(b,c,d,a,x[i+4],23,-995338651);a=ii(a,b,c,d,x[i],6,-198630844);d=ii(d,a,b,c,x[i+7],10,1126891415);c=ii(c,d,a,b,x[i+14],15,-1416354905);b=ii(b,c,d,a,x[i+5],21,-57434055);a=ii(a,b,c,d,x[i+12],6,1700485571);d=ii(d,a,b,c,x[i+3],10,-1894986606);c=ii(c,d,a,b,x[i+10],15,-1051523);b=ii(b,c,d,a,x[i+1],21,-2054922799);a=ii(a,b,c,d,x[i+8],6,1873313359);d=ii(d,a,b,c,x[i+15],10,-30611744);c=ii(c,d,a,b,x[i+6],15,-1560198380);b=ii(b,c,d,a,x[i+13],21,1309151649);a=ii(a,b,c,d,x[i+4],6,-145523070);d=ii(d,a,b,c,x[i+11],10,-1120210379);c=ii(c,d,a,b,x[i+2],15,718787259);b=ii(b,c,d,a,x[i+9],21,-343485551);a=sa(a,oa);b=sa(b,ob);c=sa(c,oc);d=sa(d,od);}
        return wth([a,b,c,d]);
      }
      const cleaned: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawParams || {})) {
        if (value == null || value === '') continue;
        cleaned[key] = String(value).replace(/[!'()*]/g, '');
      }
      if (needSign) {
        const navRes = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
        const navData = await navRes.json();
        const wbiImg = navData?.data?.wbi_img ?? {};
        const imgKey = (wbiImg.img_url ?? '').split('/').pop()?.split('.')[0] ?? '';
        const subKey = (wbiImg.sub_url ?? '').split('/').pop()?.split('.')[0] ?? '';
        const mixinKey = getMixinKey(imgKey, subKey);
        cleaned.wts = String(Math.floor(Date.now() / 1000));
        const unsigned = new URLSearchParams(Object.fromEntries(Object.entries(cleaned).sort())).toString().replace(/\+/g, '%20');
        cleaned.w_rid = md5(unsigned + mixinKey);
      }
      const qs = new URLSearchParams(Object.fromEntries(Object.entries(cleaned).sort())).toString().replace(/\+/g, '%20');
      const res = await fetch('https://api.bilibili.com' + apiPath + (qs ? '?' + qs : ''), {
        credentials: 'include',
      });
      if (!res.ok) return { error: `Bilibili API ${apiPath} failed: HTTP ${res.status}` };
      return await res.json();
    } catch (e: any) {
      return { error: e.message || `Bilibili API ${apiPath} failed` };
    }
  }, [path, params, signed]);
  if (payload && typeof payload === 'object' && 'error' in payload) throw new Error((payload as any).error);
  return payload;
}

function requireBiliData(payload: any, label: string): any {
  if (!payload || typeof payload !== 'object') throw new Error(`Bilibili ${label} API returned malformed payload`);
  if (payload.code !== 0) throw new Error(`Bilibili ${label} API failed: ${payload.message || payload.code || 'unknown'}`);
  return payload.data;
}

function stripHtml(value: unknown): string {
  return String(value ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

async function getSelfBilibiliUid(tabId: number): Promise<string> {
  const nav = requireBiliData(await biliApiGet(tabId, '/x/web-interface/nav'), 'nav');
  const uid = String(nav?.mid || '');
  if (!uid || uid === '0') throw new Error('Please sign in to Bilibili first');
  return uid;
}

async function resolveBilibiliUid(tabId: number, uidOrName?: string): Promise<string> {
  const raw = String(uidOrName ?? '').trim();
  if (!raw) return getSelfBilibiliUid(tabId);
  if (/^\d+$/.test(raw)) return raw;
  const payload = await biliApiGet(tabId, '/x/web-interface/wbi/search/type', {
    search_type: 'bili_user',
    keyword: raw,
    page: 1,
  }, true);
  const users: any[] = payload?.data?.result ?? [];
  const exact = users.find(u => String(u.uname || '').trim() === raw);
  const picked = exact || users[0];
  const uid = String(picked?.mid || '');
  if (!uid) throw new Error(`Could not resolve Bilibili user: ${raw}`);
  return uid;
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

export async function getBilibiliVideo(input: string): Promise<BilibiliVideoDetail> {
  const bvid = normalizeBvid(input);
  const tabId = await getTab(`https://www.bilibili.com/video/${bvid}/`);
  await checkLoginRedirect(tabId, 'Bilibili');

  const data = await executeInPage(tabId, async (bv: string) => {
    try {
      const res = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bv), {
        credentials: 'include',
      });
      if (!res.ok) return { error: 'Bilibili video failed: HTTP ' + res.status };
      const payload = await res.json();
      if (payload?.code !== 0) return { error: 'Bilibili video failed: ' + (payload?.message || payload?.code || 'unknown') };
      const d = payload?.data || {};
      const stat = d.stat || {};
      const owner = d.owner || {};
      return {
        bvid: d.bvid || bv,
        aid: String(d.aid || ''),
        title: d.title || '',
        author: owner.name || '',
        mid: String(owner.mid || ''),
        category: d.tname_v2 || d.tname || '',
        publish_time: d.pubdate ? new Date(d.pubdate * 1000).toISOString() : '',
        duration: d.duration || 0,
        view: stat.view || 0,
        danmaku: stat.danmaku || 0,
        reply: stat.reply || 0,
        like: stat.like || 0,
        coin: stat.coin || 0,
        favorite: stat.favorite || 0,
        share: stat.share || 0,
        parts: d.videos || 1,
        thumbnail: d.pic || '',
        description: d.desc || '',
        url: 'https://www.bilibili.com/video/' + (d.bvid || bv),
      };
    } catch (e: any) {
      return { error: e.message || 'Bilibili video scraper failed' };
    }
  }, [bvid]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data as BilibiliVideoDetail;
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

// ─── Bilibili Extended Operations ───────────────────────────────────

export async function getBilibiliDynamic(limit = 20): Promise<any[]> {
  const tabId = await getTab('https://www.bilibili.com');
  await checkLoginRedirect(tabId, 'Bilibili');
  const data = await executeInPage(tabId, async (lim: number) => {
    try {
      const res = await fetch('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all', { credentials: 'include' });
      if (!res.ok) return { error: 'Bilibili dynamic failed: HTTP ' + res.status };
      const payload = await res.json();
      const items: any[] = payload?.data?.items ?? [];
      return items.slice(0, lim).map((item: any, i: number) => {
        const modules = item.modules ?? {};
        const author = modules.module_author ?? {};
        const desc = modules.module_dynamic?.desc?.text ?? '';
        const archive = modules.module_dynamic?.major?.archive ?? {};
        const stat = modules.module_stat ?? {};
        return {
          rank: i + 1, type: item.type ?? '',
          title: archive.title || desc.slice(0, 80),
          author: author.name ?? '', mid: author.mid ?? '',
          likes: stat.like?.count ?? 0, comments: stat.comment?.count ?? 0,
          url: archive.jump_url ? ('https:' + archive.jump_url) : ('https://t.bilibili.com/' + (item.id_str ?? '')),
        };
      });
    } catch (e: any) { return { error: e.message || 'Bilibili dynamic scraper failed' }; }
  }, [limit]);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return (data as any[]) || [];
}

export async function getBilibiliHistory(limit = 30): Promise<any[]> {
  const tabId = await getTab('https://www.bilibili.com');
  await checkLoginRedirect(tabId, 'Bilibili');
  const data = await executeInPage(tabId, async (lim: number) => {
    try {
      const res = await fetch('https://api.bilibili.com/x/web-interface/history/cursor?ps=' + lim + '&type=archive', { credentials: 'include' });
      if (!res.ok) return { error: 'Bilibili history failed: HTTP ' + res.status };
      const payload = await res.json();
      const list: any[] = payload?.data?.list ?? [];
      return list.slice(0, lim).map((item: any, i: number) => ({
        rank: i + 1, title: item.title ?? '', author: item.author_name ?? '',
        progress: item.progress ?? 0, duration: item.duration ?? 0,
        url: item.history?.bvid ? 'https://www.bilibili.com/video/' + item.history.bvid : '',
      }));
    } catch (e: any) { return { error: e.message || 'Bilibili history scraper failed' }; }
  }, [limit]);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return (data as any[]) || [];
}

export async function getBilibiliFollowing(
  uidOrName?: string,
  options: { limit?: number; page?: number } = {},
): Promise<any[]> {
  const limit = Math.min(Math.max(1, Number(options.limit ?? 50) || 50), 50);
  const page = Math.max(1, Number(options.page ?? 1) || 1);
  const tabId = await getTab('https://www.bilibili.com');
  await checkLoginRedirect(tabId, 'Bilibili');
  const uid = await resolveBilibiliUid(tabId, uidOrName);
  const data = requireBiliData(await biliApiGet(tabId, '/x/relation/followings', {
    vmid: uid,
    pn: page,
    ps: limit,
    order: 'desc',
  }), 'following');
  const list: any[] = data?.list ?? [];
  return list.slice(0, limit).map((item: any, i: number) => ({
    rank: i + 1,
    mid: String(item.mid ?? ''),
    name: item.uname ?? '',
    sign: item.sign ?? '',
    mutual: item.attribute === 6,
    following: item.attribute === 6 ? 'mutual' : 'following',
    fans: item.official_verify?.desc || '',
    url: item.mid ? 'https://space.bilibili.com/' + item.mid : '',
  }));
}

export async function getBilibiliUserVideos(
  uidOrName: string,
  limit = 30,
  options: { page?: number; order?: string } = {},
): Promise<any[]> {
  const page = Math.max(1, Number(options.page ?? 1) || 1);
  const order = options.order || 'pubdate';
  const navTabId = await getTab('https://www.bilibili.com');
  await checkLoginRedirect(navTabId, 'Bilibili');
  const uid = await resolveBilibiliUid(navTabId, uidOrName);
  const spaceTabId = await getTab(`https://space.bilibili.com/${uid}/upload/video`);
  await checkLoginRedirect(spaceTabId, 'Bilibili');

  try {
    const data = requireBiliData(await biliApiGet(spaceTabId, '/x/space/wbi/arc/search', {
      mid: uid,
      pn: page,
      ps: Math.min(Math.max(1, Number(limit) || 30), 50),
      order,
    }, true), 'user-videos');
    const vlist: any[] = data?.list?.vlist ?? [];
    return vlist.slice(0, limit).map((v: any, i: number) => ({
      rank: i + 1,
      title: v.title ?? '',
      author: v.author ?? '',
      play: v.play ?? 0,
      plays: v.play ?? 0,
      like: v.like ?? 0,
      likes: v.like ?? 0,
      date: v.created ? new Date(v.created * 1000).toISOString().slice(0, 10) : '',
      bvid: v.bvid ?? '',
      thumbnail: v.pic ?? '',
      url: v.bvid ? 'https://www.bilibili.com/video/' + v.bvid : '',
    }));
  } catch (apiError) {
    const domRows = await executeInPage(spaceTabId, async (lim: number) => {
      const parseCount = (raw: string) => {
        const text = String(raw || '').trim();
        const n = Number(text.replace(/[^\d.]/g, ''));
        if (!Number.isFinite(n)) return 0;
        if (text.includes('亿')) return Math.round(n * 100_000_000);
        if (text.includes('万')) return Math.round(n * 10_000);
        return Math.round(n);
      };
      const rows = Array.from(document.querySelectorAll('.bili-video-card'));
      return rows.slice(0, lim).map((el: any, i) => {
        const link = el.querySelector('a[href*="/video/BV"]') as HTMLAnchorElement | null;
        const href = link?.href || '';
        const bvid = href.match(/\/video\/(BV[A-Za-z0-9]+)/)?.[1] ?? '';
        const stats = Array.from(el.querySelectorAll('.bili-cover-card__stat')).map((x: any) => String(x.textContent || '').trim());
        const img = el.querySelector('img') as HTMLImageElement | null;
        return {
          rank: i + 1,
          title: String(el.querySelector('.bili-video-card__title')?.textContent || img?.alt || '').trim(),
          author: '',
          play: parseCount(stats[0] || ''),
          plays: parseCount(stats[0] || ''),
          danmaku: parseCount(stats[1] || ''),
          duration: stats[2] || '',
          date: String(el.querySelector('.bili-video-card__subtitle')?.textContent || '').trim(),
          bvid,
          thumbnail: img?.src || '',
          url: bvid ? `https://www.bilibili.com/video/${bvid}` : href,
        };
      }).filter((row) => row.bvid || row.title);
    }, [Math.min(Math.max(1, Number(limit) || 30), 50)]);
    if (domRows.length > 0) return domRows;
    throw apiError;
  }
}

export async function getBilibiliComments(
  bvid: string,
  limit = 20,
  options: { parent?: string | number } = {},
): Promise<any[]> {
  const normalizedBvid = normalizeBvid(bvid);
  const tabId = await getTab('https://www.bilibili.com');
  await checkLoginRedirect(tabId, 'Bilibili');
  const data = await executeInPage(tabId, async (bv: string, lim: number, parent: string) => {
    try {
      const MIXIN_KEY_ENC_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
      function getMixinKey(imgKey: string, subKey: string) { const raw = imgKey + subKey; return MIXIN_KEY_ENC_TAB.map((i: number) => raw[i] || '').join('').slice(0, 32); }
      function md5(str: string) {
        function sa(x: number,y: number){const l=(x&0xffff)+(y&0xffff);return((x>>16)+(y>>16)+(l>>16))<<16|l&0xffff;}
        function rl(n: number,c: number){return n<<c|n>>>32-c;}
        function cm(q: number,a: number,b: number,x: number,s: number,t: number){return sa(rl(sa(sa(a,q),sa(x,t)),s),b);}
        function ff(a: number,b: number,c: number,d: number,x: number,s: number,t: number){return cm(b&c|~b&d,a,b,x,s,t);}
        function gg(a: number,b: number,c: number,d: number,x: number,s: number,t: number){return cm(b&d|c&~d,a,b,x,s,t);}
        function hh(a: number,b: number,c: number,d: number,x: number,s: number,t: number){return cm(b^c^d,a,b,x,s,t);}
        function ii(a: number,b: number,c: number,d: number,x: number,s: number,t: number){return cm(c^(b|~d),a,b,x,s,t);}
        function wth(n: number[]){const h='0123456789abcdef';let o='';for(let i=0;i<n.length*32;i+=8)o+=h.charAt(n[i>>5]>>>(i%32)&0xf)+h.charAt(n[i>>5]>>>((i%32)+4)&0xf);return o;}
        function btw(s: string){const o:number[]=[];for(let i=0;i<s.length*8;i+=8)o[i>>5]|=(s.charCodeAt(i/8)&0xff)<<i%32;return o;}
        const x=btw(str),len=str.length*8;x[len>>5]|=0x80<<len%32;x[(len+64>>>9<<4)+14]=len;let a=1732584193,b=-271733879,c=-1732584194,d=271733878;
        for(let i=0;i<x.length;i+=16){const oa=a,ob=b,oc=c,od=d;a=ff(a,b,c,d,x[i],7,-680876936);d=ff(d,a,b,c,x[i+1],12,-389564586);c=ff(c,d,a,b,x[i+2],17,606105819);b=ff(b,c,d,a,x[i+3],22,-1044525330);a=ff(a,b,c,d,x[i+4],7,-176418897);d=ff(d,a,b,c,x[i+5],12,1200080426);c=ff(c,d,a,b,x[i+6],17,-1473231341);b=ff(b,c,d,a,x[i+7],22,-45705983);a=ff(a,b,c,d,x[i+8],7,1770035416);d=ff(d,a,b,c,x[i+9],12,-1958414417);c=ff(c,d,a,b,x[i+10],17,-42063);b=ff(b,c,d,a,x[i+11],22,-1990404162);a=ff(a,b,c,d,x[i+12],7,1804603682);d=ff(d,a,b,c,x[i+13],12,-40341101);c=ff(c,d,a,b,x[i+14],17,-1502002290);b=ff(b,c,d,a,x[i+15],22,1236535329);a=gg(a,b,c,d,x[i+1],5,-165796510);d=gg(d,a,b,c,x[i+6],9,-1069501632);c=gg(c,d,a,b,x[i+11],14,643717713);b=gg(b,c,d,a,x[i],20,-373897302);a=gg(a,b,c,d,x[i+5],5,-701558691);d=gg(d,a,b,c,x[i+10],9,38016083);c=gg(c,d,a,b,x[i+15],14,-660478335);b=gg(b,c,d,a,x[i+4],20,-405537848);a=gg(a,b,c,d,x[i+9],5,568446438);d=gg(d,a,b,c,x[i+14],9,-1019803690);c=gg(c,d,a,b,x[i+3],14,-187363961);b=gg(b,c,d,a,x[i+8],20,1163531501);a=gg(a,b,c,d,x[i+13],5,-1444681467);d=gg(d,a,b,c,x[i+2],9,-51403784);c=gg(c,d,a,b,x[i+7],14,1735328473);b=gg(b,c,d,a,x[i+12],20,-1926607734);a=hh(a,b,c,d,x[i+5],4,-378558);d=hh(d,a,b,c,x[i+8],11,-2022574463);c=hh(c,d,a,b,x[i+11],16,1839030562);b=hh(b,c,d,a,x[i],23,-35309556);a=hh(a,b,c,d,x[i+3],4,-1530992060);d=hh(d,a,b,c,x[i+6],11,1272893353);c=hh(c,d,a,b,x[i+9],16,-155497632);b=hh(b,c,d,a,x[i+12],23,-1094730640);a=hh(a,b,c,d,x[i+15],4,681279174);d=hh(d,a,b,c,x[i+2],11,-358537222);c=hh(c,d,a,b,x[i+5],16,-722521979);b=hh(b,c,d,a,x[i+8],23,76029189);a=hh(a,b,c,d,x[i+11],4,-640364487);d=hh(d,a,b,c,x[i+14],11,-421815835);c=hh(c,d,a,b,x[i+1],16,530742520);b=hh(b,c,d,a,x[i+4],23,-995338651);a=ii(a,b,c,d,x[i],6,-198630844);d=ii(d,a,b,c,x[i+7],10,1126891415);c=ii(c,d,a,b,x[i+14],15,-1416354905);b=ii(b,c,d,a,x[i+5],21,-57434055);a=ii(a,b,c,d,x[i+12],6,1700485571);d=ii(d,a,b,c,x[i+3],10,-1894986606);c=ii(c,d,a,b,x[i+10],15,-1051523);b=ii(b,c,d,a,x[i+1],21,-2054922799);a=ii(a,b,c,d,x[i+8],6,1873313359);d=ii(d,a,b,c,x[i+15],10,-30611744);c=ii(c,d,a,b,x[i+6],15,-1560198380);b=ii(b,c,d,a,x[i+13],21,1309151649);a=ii(a,b,c,d,x[i+4],6,-145523070);d=ii(d,a,b,c,x[i+11],10,-1120210379);c=ii(c,d,a,b,x[i+2],15,718787259);b=ii(b,c,d,a,x[i+9],21,-343485551);a=sa(a,oa);b=sa(b,ob);c=sa(c,oc);d=sa(d,od);}
        return wth([a,b,c,d]);
      }
      const viewRes = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bv), { credentials: 'include' });
      if (!viewRes.ok) return { error: 'Failed to get video info: HTTP ' + viewRes.status };
      const viewData = await viewRes.json();
      const aid = viewData?.data?.aid;
      if (!aid) return { error: 'Could not get video AID from BVID: ' + bv };
      let apiUrl = '';
      if (parent) {
        const params = new URLSearchParams({ oid: String(aid), type: '1', root: parent, pn: '1', ps: String(lim) });
        apiUrl = 'https://api.bilibili.com/x/v2/reply/reply?' + params.toString();
      } else {
        const navRes = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
        const navData = await navRes.json();
        const wbiImg = navData?.data?.wbi_img ?? {};
        const imgKey = (wbiImg.img_url ?? '').split('/').pop()?.split('.')[0] ?? '';
        const subKey = (wbiImg.sub_url ?? '').split('/').pop()?.split('.')[0] ?? '';
        const mixinKey = getMixinKey(imgKey, subKey);
        const wts = Math.floor(Date.now() / 1000);
        const rawParams: Record<string,any> = { oid: aid, type: 1, mode: 3, ps: lim, wts: String(wts) };
        const sorted: Record<string,string> = {};
        for (const key of Object.keys(rawParams).sort()) sorted[key] = String(rawParams[key]).replace(/[!'()*]/g,'');
        const qs0 = new URLSearchParams(sorted).toString().replace(/\+/g,'%20');
        sorted.w_rid = md5(qs0 + mixinKey);
        const qs = new URLSearchParams(sorted).toString().replace(/\+/g,'%20');
        apiUrl = 'https://api.bilibili.com/x/v2/reply/main?' + qs;
      }
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'Bilibili comments failed: HTTP ' + res.status };
      const payload = await res.json();
      const replies: any[] = payload?.data?.replies ?? [];
      return replies.slice(0, lim).map((r: any, i: number) => ({
        rank: i + 1, author: r.member?.uname ?? '',
        rpid: String(r.rpid ?? ''),
        content: r.content?.message ?? '', text: r.content?.message ?? '',
        likes: r.like ?? 0, replies: r.rcount ?? 0,
        time: r.ctime ? new Date(r.ctime * 1000).toISOString().slice(0, 16).replace('T', ' ') : '',
      }));
    } catch (e: any) { return { error: e.message || 'Bilibili comments scraper failed' }; }
  }, [normalizedBvid, limit, options.parent ? String(options.parent) : '']);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return (data as any[]) || [];
}

export async function getBilibiliMe(): Promise<any> {
  const tabId = await getTab('https://www.bilibili.com');
  await checkLoginRedirect(tabId, 'Bilibili');
  const data = requireBiliData(await biliApiGet(tabId, '/x/web-interface/nav'), 'me');
  const uid = String(data?.mid || '');
  if (!uid || uid === '0') throw new Error('Please sign in to Bilibili first');
  return {
    name: data.uname ?? data.name ?? '',
    uid,
    level: data.level_info?.current_level ?? data.level ?? 0,
    current_exp: data.level_info?.current_exp ?? 0,
    next_exp: data.level_info?.next_exp ?? 0,
    coins: data.money ?? data.coins ?? 0,
    vip_status: data.vipStatus ?? data.vip?.status ?? 0,
    vip_type: data.vipType ?? data.vip?.type ?? 0,
    ip_region: data.ip_region ?? '',
    face: data.face ?? '',
    url: 'https://space.bilibili.com/' + uid,
  };
}

export async function getBilibiliFavorite(
  options: { fid?: string | number; limit?: number; page?: number } = {},
): Promise<any[]> {
  const limit = Math.min(Math.max(1, Number(options.limit ?? 20) || 20), 40);
  const page = Math.max(1, Number(options.page ?? 1) || 1);
  const tabId = await getTab('https://www.bilibili.com');
  await checkLoginRedirect(tabId, 'Bilibili');
  let fid = options.fid ? String(options.fid) : '';
  if (!fid) {
    const uid = await getSelfBilibiliUid(tabId);
    const folders = requireBiliData(await biliApiGet(tabId, '/x/v3/fav/folder/created/list-all', {
      up_mid: uid,
    }, true), 'favorite-folders')?.list ?? [];
    fid = String(folders[0]?.id || '');
    if (!fid) return [];
  }
  const data = requireBiliData(await biliApiGet(tabId, '/x/v3/fav/resource/list', {
    media_id: fid,
    pn: page,
    ps: limit,
  }, true), 'favorite');
  const medias: any[] = data?.medias ?? [];
  return medias.slice(0, limit).map((item: any, i: number) => ({
    rank: i + 1,
    fid,
    title: item.title ?? '',
    author: item.upper?.name ?? '',
    mid: String(item.upper?.mid ?? ''),
    plays: item.cnt_info?.play ?? 0,
    favorite: item.cnt_info?.collect ?? 0,
    bvid: item.bvid ?? '',
    url: item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : '',
  }));
}

const BILIBILI_DYNAMIC_TYPES: Record<string, string> = {
  DYNAMIC_TYPE_AV: 'video',
  DYNAMIC_TYPE_DRAW: 'draw',
  DYNAMIC_TYPE_ARTICLE: 'article',
  DYNAMIC_TYPE_FORWARD: 'forward',
  DYNAMIC_TYPE_WORD: 'text',
  DYNAMIC_TYPE_LIVE_RCMD: 'live',
  DYNAMIC_TYPE_PGC: 'bangumi',
};

function parseBilibiliDynamicItem(item: any): any {
  const modules = item.modules ?? {};
  const author = modules.module_author ?? {};
  const dynamic = modules.module_dynamic ?? {};
  const major = dynamic.major ?? {};
  const stat = modules.module_stat ?? {};
  const type = BILIBILI_DYNAMIC_TYPES[item.type] ?? item.type ?? '';
  let title = '';
  let url = item.id_str ? `https://t.bilibili.com/${item.id_str}` : '';
  if (major.archive) {
    title = major.archive.title ?? '';
    url = major.archive.jump_url ? `https:${major.archive.jump_url}` : url;
  }
  if (!title && major.article) {
    title = major.article.title ?? '';
    url = major.article.jump_url ? `https:${major.article.jump_url}` : url;
  }
  if (!title && dynamic.desc?.text) title = stripHtml(dynamic.desc.text).slice(0, 100);
  if (!title && major.draw) title = major.draw.items?.length ? `[images:${major.draw.items.length}]` : '[image dynamic]';
  if (!title && item.basic?.is_only_fans) title = '[exclusive]';
  if (!title && item.type === 'DYNAMIC_TYPE_FORWARD') title = '[forward]';
  if (!title) title = `[${type || 'dynamic'}]`;
  return {
    id: item.id_str ?? '',
    time: author.pub_time ?? '',
    author: author.name ?? '',
    mid: String(author.mid ?? ''),
    title,
    type,
    likes: stat.like?.count ?? 0,
    comments: stat.comment?.count ?? 0,
    forwards: stat.forward?.count ?? 0,
    url,
  };
}

export async function getBilibiliFeed(
  uidOrName?: string,
  options: { limit?: number; pages?: number; type?: string } = {},
): Promise<any[]> {
  const limit = Math.min(Math.max(1, Number(options.limit ?? 20) || 20), 100);
  const pages = Math.min(Math.max(1, Number(options.pages ?? 1) || 1), 5);
  const filterType = options.type && options.type !== 'all' ? options.type : '';
  const tabId = await getTab('https://www.bilibili.com');
  await checkLoginRedirect(tabId, 'Bilibili');
  const uid = uidOrName ? await resolveBilibiliUid(tabId, uidOrName) : '';
  const rows: any[] = [];
  let offset = '';

  for (let p = 0; p < pages && rows.length < limit; p += 1) {
    const data = uid
      ? requireBiliData(await biliApiGet(tabId, '/x/polymer/web-dynamic/v1/feed/space', {
          host_mid: uid,
          timezone_offset: -480,
          offset,
        }), 'feed-space')
      : requireBiliData(await biliApiGet(tabId, '/x/polymer/web-dynamic/v1/feed/all', {
          timezone_offset: -480,
          type: filterType || 'all',
          page: p + 1,
          offset,
        }), 'feed');
    const items: any[] = data?.items ?? [];
    if (items.length === 0) break;
    for (const item of items) {
      if (rows.length >= limit) break;
      const parsed = parseBilibiliDynamicItem(item);
      if (filterType && parsed.type !== filterType) continue;
      rows.push({ rank: rows.length + 1, ...parsed });
    }
    offset = data?.offset ?? items[items.length - 1]?.id_str ?? '';
    if (!offset || !data?.has_more) break;
  }
  return rows;
}

export async function getBilibiliFeedDetail(id: string): Promise<any> {
  const dynamicId = String(id || '').trim();
  if (!dynamicId) throw new Error('Bilibili dynamic id is required');
  const tabId = await getTab('https://www.bilibili.com');
  await checkLoginRedirect(tabId, 'Bilibili');
  const data = requireBiliData(await biliApiGet(tabId, '/x/polymer/web-dynamic/v1/detail', {
    id: dynamicId,
    timezone_offset: -480,
  }), 'feed-detail');
  const item = data?.item;
  if (!item) return { id: dynamicId, error: 'dynamic not found or not visible' };
  const modules = item.modules ?? {};
  const author = modules.module_author ?? {};
  const dynamic = modules.module_dynamic ?? {};
  const major = dynamic.major ?? {};
  const stat = modules.module_stat ?? {};
  return {
    id: item.id_str ?? dynamicId,
    author: author.name ?? '',
    mid: String(author.mid ?? ''),
    time: author.pub_time ?? '',
    type: BILIBILI_DYNAMIC_TYPES[item.type] ?? item.type ?? '',
    text: stripHtml(dynamic.desc?.text ?? ''),
    video_title: major.archive?.title ?? '',
    video_desc: major.archive?.desc ?? '',
    video_url: major.archive?.jump_url ? `https:${major.archive.jump_url}` : '',
    article_title: major.article?.title ?? '',
    article_url: major.article?.jump_url ? `https:${major.article.jump_url}` : '',
    images: Array.isArray(major.draw?.items) ? major.draw.items.map((img: any) => img.src).filter(Boolean) : [],
    opus_title: major.opus?.title ?? '',
    opus_text: stripHtml(major.opus?.summary?.text ?? ''),
    forward_from: item.orig?.modules?.module_author?.name ?? '',
    forward_text: stripHtml(item.orig?.modules?.module_dynamic?.desc?.text ?? '').slice(0, 500),
    likes: stat.like?.count ?? 0,
    comments: stat.comment?.count ?? 0,
    forwards: stat.forward?.count ?? 0,
    url: `https://t.bilibili.com/${item.id_str ?? dynamicId}`,
  };
}

function formatBiliTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export async function getBilibiliSummary(input: string): Promise<any> {
  const bvid = normalizeBvid(input);
  const tabId = await getTab(`https://www.bilibili.com/video/${bvid}/`);
  await checkLoginRedirect(tabId, 'Bilibili');
  const view = requireBiliData(await biliApiGet(tabId, '/x/web-interface/view', { bvid }), 'view');
  const cid = view?.cid;
  const upMid = view?.owner?.mid;
  if (!cid || !upMid) throw new Error(`Bilibili view API did not return cid/up_mid for ${bvid}`);
  const conclusion = requireBiliData(await biliApiGet(tabId, '/x/web-interface/view/conclusion/get', {
    bvid,
    cid,
    up_mid: upMid,
  }, true), 'summary');
  let model = conclusion?.model_result;
  if (typeof model === 'string') model = JSON.parse(model);
  const summary = String(model?.summary ?? '').trim();
  const outline = Array.isArray(model?.outline) ? model.outline : [];
  const rows: any[] = summary ? [{ time: '', content: summary }] : [];
  const parsedOutline = outline.map((section: any) => {
    const points = Array.isArray(section?.part_outline) ? section.part_outline : [];
    const parsedPoints = points.map((point: any) => ({
      timestamp: Number(point?.timestamp ?? 0),
      time: formatBiliTime(Number(point?.timestamp ?? 0)),
      content: String(point?.content ?? '').trim(),
    })).filter((point: any) => point.content);
    const title = String(section?.title ?? '').trim();
    if (title) rows.push({ time: formatBiliTime(Number(section?.timestamp ?? 0)), content: `# ${title}` });
    rows.push(...parsedPoints.map((point: any) => ({ time: point.time, content: point.content })));
    return {
      title,
      timestamp: Number(section?.timestamp ?? 0),
      time: formatBiliTime(Number(section?.timestamp ?? 0)),
      points: parsedPoints,
    };
  });
  return { bvid, summary, outline: parsedOutline, rows };
}

export async function getBilibiliSubtitle(
  input: string,
  options: { lang?: string } = {},
): Promise<any> {
  const bvid = normalizeBvid(input);
  const tabId = await getTab(`https://www.bilibili.com/video/${bvid}/`);
  await checkLoginRedirect(tabId, 'Bilibili');
  const view = requireBiliData(await biliApiGet(tabId, '/x/web-interface/view', { bvid }), 'view');
  const cid = view?.cid;
  if (!cid) throw new Error(`Could not resolve cid for ${bvid}`);
  const player = requireBiliData(await biliApiGet(tabId, '/x/player/wbi/v2', { bvid, cid }, true), 'player');
  const subtitles: any[] = player?.subtitle?.subtitles ?? [];
  if (!subtitles.length) {
    if (player?.need_login_subtitle) throw new Error('Bilibili subtitles require login for this video');
    return { bvid, lang: options.lang || '', subtitles: [], lines: [] };
  }
  const target = options.lang ? subtitles.find(s => s.lan === options.lang) || subtitles[0] : subtitles[0];
  const rawUrl = String(target?.subtitle_url || '').trim();
  if (!rawUrl) throw new Error('Bilibili subtitle_url is empty');
  const subtitleUrl = rawUrl.startsWith('//') ? 'https:' + rawUrl : rawUrl;
  const fetched = await executeInPage(tabId, async (url: string) => {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (/^\s*</.test(text)) return { error: 'subtitle CDN returned HTML' };
      const json = JSON.parse(text);
      const body = Array.isArray(json?.body) ? json.body : Array.isArray(json) ? json : [];
      return { body };
    } catch (e: any) {
      return { error: e.message || 'Bilibili subtitle fetch failed' };
    }
  }, [subtitleUrl]);
  if (fetched && typeof fetched === 'object' && 'error' in fetched) throw new Error((fetched as any).error);
  const body: any[] = (fetched as any)?.body ?? [];
  return {
    bvid,
    lang: target?.lan || '',
    lan_doc: target?.lan_doc || '',
    subtitle_url: subtitleUrl,
    subtitles: subtitles.map(s => ({ lang: s.lan, lan_doc: s.lan_doc, id: s.id })),
    lines: body.map((item: any, i: number) => ({
      index: i + 1,
      from: Number(item?.from ?? 0),
      to: Number(item?.to ?? 0),
      content: String(item?.content ?? ''),
    })),
  };
}
