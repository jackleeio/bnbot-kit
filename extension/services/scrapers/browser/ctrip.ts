/**
 * Ctrip (携程) browser scrapers — ported from opencli clis/ctrip.
 *
 * hotel-search: reads window.__NEXT_DATA__.props.pageProps.initListData.hotelList
 *               from the SSR-rendered hotels.ctrip.com/hotels/list page.
 * flight:       scrapes .flight-list > span > div cards from flights.ctrip.com
 *               (rows arrive via post-load XHR, not in __NEXT_DATA__).
 *
 * Both navigate via getTab + run extraction inside the page via executeInPage,
 * matching the bilibili/twitter background-scraper pattern. Ctrip occasionally
 * gates traffic behind a captcha; we surface that as a clear error.
 */

import { getTab, executeInPage } from '../../scraperService';

function assertIsoDate(name: string, raw: string): string {
  const v = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${name} must be YYYY-MM-DD, got ${JSON.stringify(raw)}`);
  return v;
}

export async function getCtripHotelSearch(
  city: string,
  checkin: string,
  checkout: string,
  limit = 10,
): Promise<any[]> {
  const cityId = Number(city);
  if (!Number.isFinite(cityId) || cityId <= 0) {
    throw new Error('ctrip hotel-search: city must be a numeric Ctrip city ID (use ctrip search / hotel-suggest to discover)');
  }
  const ci = assertIsoDate('checkin', checkin);
  const co = assertIsoDate('checkout', checkout);
  if (Date.parse(ci + 'T00:00:00Z') >= Date.parse(co + 'T00:00:00Z')) {
    throw new Error(`ctrip hotel-search: checkin must be earlier than checkout (${ci} >= ${co})`);
  }
  const lim = Math.min(Math.max(1, Number(limit) || 10), 30);
  const tabId = await getTab(`https://hotels.ctrip.com/hotels/list?city=${cityId}&checkin=${ci}&checkout=${co}`);

  const data = await executeInPage(tabId, async (max: number) => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    try {
      // Wait for SSR hotelList or detect captcha (max ~6s).
      const started = Date.now();
      let state: 'content' | 'captcha' | 'timeout' = 'timeout';
      while (Date.now() - started < 6000) {
        if (location.pathname.includes('captcha') || /验证码|verify the human/i.test(document.body?.innerText || '')) { state = 'captcha'; break; }
        const hl = (window as any).__NEXT_DATA__?.props?.pageProps?.initListData?.hotelList;
        if (Array.isArray(hl)) { state = 'content'; break; }
        await sleep(300);
      }
      if (state === 'captcha') return { error: 'Ctrip is asking for a captcha; complete it in your logged-in browser and retry' };
      const list = (window as any).__NEXT_DATA__?.props?.pageProps?.initListData?.hotelList;
      if (!Array.isArray(list)) return { error: 'Ctrip hotel-search did not expose SSR hotel list (state=' + state + ')' };

      const pickCoords = (mc: any[]): { lat: number | null; lon: number | null } => {
        if (!Array.isArray(mc) || !mc.length) return { lat: null, lon: null };
        const rank = (e: any) => { const t = Number(e?.coordinateType); return t === 1 ? 0 : t === 2 ? 1 : t === 3 ? 2 : 3; };
        for (const e of [...mc].sort((a, b) => rank(a) - rank(b))) {
          const la = Number(e?.latitude), lo = Number(e?.longitude);
          if (Number.isFinite(la) && Number.isFinite(lo) && (la !== 0 || lo !== 0)) return { lat: la, lon: lo };
        }
        return { lat: null, lon: null };
      };

      const rows: any[] = [];
      list.forEach((entry: any, i: number) => {
        const hi = entry?.hotelInfo ?? {};
        const rooms = Array.isArray(entry?.roomInfo) ? entry.roomInfo : [];
        const summary = hi.summary ?? {}, nameInfo = hi.nameInfo ?? {}, hotelStar = hi.hotelStar ?? {};
        const commentInfo = hi.commentInfo ?? {}, positionInfo = hi.positionInfo ?? {};
        const priceInfo = (rooms[0] ?? {}).priceInfo ?? {};
        const hotelId = summary.hotelId ? String(summary.hotelId) : null;
        if (!hotelId || !nameInfo.name) return;
        const { lat, lon } = pickCoords(positionInfo.mapCoordinate);
        let reviewCount: number | null = null;
        if (commentInfo.commenterNumber) { const d = String(commentInfo.commenterNumber).replace(/[^\d]/g, ''); if (d) reviewCount = Number(d); }
        const score = commentInfo.commentScore ? Number(commentInfo.commentScore) : null;
        const star = Number.isFinite(hotelStar.star) && hotelStar.star > 0 ? hotelStar.star : null;
        const price = Number.isFinite(priceInfo.price) && priceInfo.price > 0 ? priceInfo.price : null;
        rows.push({
          rank: rows.length + 1, hotelId,
          name: String(nameInfo.name).trim(),
          enName: nameInfo.enName ? String(nameInfo.enName).trim() : null,
          star, score: Number.isFinite(score) && (score as number) > 0 ? score : null,
          scoreLabel: commentInfo.commentDescription ? String(commentInfo.commentDescription).trim() : null,
          reviewCount,
          cityName: positionInfo.cityName ? String(positionInfo.cityName).trim() : null,
          district: positionInfo.positionDesc ? String(positionInfo.positionDesc).trim() : null,
          address: positionInfo.address ? String(positionInfo.address).trim() : null,
          lat, lon, price,
          currency: priceInfo.currency ? String(priceInfo.currency).trim() : null,
          url: `https://hotels.ctrip.com/hotels/detail/?hotelid=${hotelId}`,
        });
      });
      if (!rows.length) return { error: 'Ctrip hotel-search SSR rows missing hotelId/name' };
      return rows.slice(0, max);
    } catch (e: any) { return { error: e.message || 'Ctrip hotel-search scraper failed' }; }
  }, [lim]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return (data as any[]) || [];
}

export async function getCtripFlight(
  from: string,
  to: string,
  date: string,
  limit = 20,
): Promise<any[]> {
  const f = String(from || '').trim().toUpperCase();
  const t = String(to || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(f) || !/^[A-Z]{3}$/.test(t)) throw new Error('ctrip flight: from/to must be 3-letter IATA codes (e.g. PEK, SHA)');
  if (f === t) throw new Error(`ctrip flight: from and to must differ (got ${f})`);
  const d = assertIsoDate('date', date);
  const lim = Math.min(Math.max(1, Number(limit) || 20), 50);
  const searchUrl = `https://flights.ctrip.com/online/list/oneway-${f.toLowerCase()}-${t.toLowerCase()}?depdate=${d}&cabin=Y_S_C_F&adult=1&child=0&infant=0`;
  const tabId = await getTab(searchUrl);

  const data = await executeInPage(tabId, async (max: number, url: string) => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    try {
      // Wait for flight cards (post-load XHR can take 5-12s after nav) or captcha.
      const started = Date.now();
      let state: 'content' | 'captcha' | 'timeout' = 'timeout';
      while (Date.now() - started < 15000) {
        if (location.pathname.includes('captcha') || /验证码|verify the human/i.test(document.body?.innerText || '')) { state = 'captcha'; break; }
        if (document.querySelector('.flight-list > span > div')) { state = 'content'; break; }
        await sleep(300);
      }
      if (state === 'captcha') return { error: 'Ctrip is asking for a captcha; complete it in your logged-in browser and retry' };
      if (state !== 'content') return { error: 'Ctrip flight page did not render flight cards' };

      // Scroll to load more cards (lazy beyond ~8).
      for (let i = 0; i < 8; i++) {
        if (document.querySelectorAll('.flight-list > span > div').length >= max) break;
        const h = document.body.scrollHeight;
        window.scrollTo(0, h);
        await sleep(800);
        if (document.body.scrollHeight === h) break;
      }

      const cleanText = (v: string) => (v || '').replace(/\s+/g, ' ').trim();
      const isTime = (s: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(s);
      const isCurrency = (s: string) => /^[¥$€£]$/.test(s);
      const isPriceDigits = (s: string) => /^\d+([.,]\d+)?$/.test(s);
      const isFlightNo = (s: string) => /^[A-Z0-9]{2}\d{3,4}[A-Z]?$/.test(s);

      const rows: any[] = [];
      document.querySelectorAll('.flight-list > span > div').forEach((card: Element) => {
        const chunks: string[] = [];
        const walk = (node: Node) => {
          node.childNodes.forEach((c) => {
            if (c.nodeType === 3) { const tt = cleanText(c.textContent || ''); if (tt) chunks.push(tt); }
            else if (c.nodeType === 1) walk(c);
          });
        };
        walk(card);
        if (chunks.length < 8) return;
        const firstTimeIdx = chunks.findIndex(isTime);
        if (firstTimeIdx < 1) return;
        const airline = chunks[0];
        const flightNo = chunks[1] || '';
        if (!airline || !isFlightNo(flightNo)) return;
        const aircraft = chunks[2] && !isTime(chunks[2]) ? chunks[2] : null;
        const depTime = chunks[firstTimeIdx];
        const depAirport = chunks[firstTimeIdx + 1] || null;
        const arrTimeIdx = chunks.findIndex((c, i) => i > firstTimeIdx && isTime(c));
        if (arrTimeIdx < 0) return;
        const arrTime = chunks[arrTimeIdx];
        const arrAirport = chunks[arrTimeIdx + 1] || null;
        if (!depAirport || !arrAirport) return;
        let terminal: string | null = null;
        if (arrTimeIdx + 2 < chunks.length && /^T\d$/.test(chunks[arrTimeIdx + 2])) terminal = chunks[arrTimeIdx + 2];
        let price: number | null = null, currency: string | null = null;
        for (let i = 0; i < chunks.length - 1; i++) {
          if (isCurrency(chunks[i]) && isPriceDigits(chunks[i + 1])) { currency = chunks[i]; price = Number(chunks[i + 1].replace(',', '')); break; }
        }
        let cabin: string | null = null;
        for (let i = chunks.length - 1; i >= 0; i--) { if (/舱$/.test(chunks[i])) { cabin = chunks[i]; break; } }
        rows.push({ rank: rows.length + 1, airline, flightNo, aircraft, departureTime: depTime, departureAirport: depAirport, arrivalTime: arrTime, arrivalAirport: arrAirport, terminal, price, currency, cabin, url });
      });
      const complete = rows.filter(r => r.departureTime && r.departureAirport && r.arrivalTime && r.arrivalAirport && r.airline && r.flightNo).slice(0, max);
      if (!complete.length) return { error: 'Ctrip flight cards rendered but parser found no complete rows' };
      return complete;
    } catch (e: any) { return { error: e.message || 'Ctrip flight scraper failed' }; }
  }, [lim, searchUrl]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return (data as any[]) || [];
}
