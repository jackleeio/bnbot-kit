/**
 * Yahoo Finance stock quote — multi-strategy (API first, DOM fallback).
 *
 * Reference: opencli yahoo-finance/quote.ts
 * Navigates to Yahoo Finance quote page, tries v8 chart API, falls back to DOM scraping.
 */

import { getTab, checkLoginRedirect } from '../../scraperService';

export interface YahooFinanceQuote {
  symbol: string;
  name: string;
  price: string | number | null;
  change: string | null;
  changePercent: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  marketCap: number | null;
  currency: string;
  exchange: string;
}

/**
 * Fetch a stock quote from Yahoo Finance.
 * @param symbol - Stock ticker symbol (e.g. AAPL, MSFT, TSLA)
 */
export async function fetchYahooFinanceQuote(symbol: string): Promise<YahooFinanceQuote | null> {
  const sym = symbol.toUpperCase().trim();
  if (!sym) return null;

  const tabId = await getTab(`https://finance.yahoo.com/quote/${encodeURIComponent(sym)}/`);
  await new Promise(r => setTimeout(r, 4000));
  await checkLoginRedirect(tabId, 'Yahoo Finance');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (ticker: string) => {
      try {
        // Strategy 1: v8 chart API (most reliable, gives full data)
        try {
          const chartUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
            encodeURIComponent(ticker) + '?interval=1d&range=1d';
          const resp = await fetch(chartUrl);
          if (resp.ok) {
            const d = await resp.json();
            const chart = d?.chart?.result?.[0];
            if (chart) {
              const meta = chart.meta || {};
              const prevClose = meta.previousClose || meta.chartPreviousClose;
              const price = meta.regularMarketPrice;
              const change = price != null && prevClose != null ? (price - prevClose) : null;
              const changePct = change != null && prevClose ? ((change / prevClose) * 100) : null;
              return {
                symbol: meta.symbol || ticker,
                name: meta.shortName || meta.longName || ticker,
                price: price != null ? Number(price.toFixed(2)) : null,
                change: change != null ? change.toFixed(2) : null,
                changePercent: changePct != null ? changePct.toFixed(2) + '%' : null,
                open: chart.indicators?.quote?.[0]?.open?.[0] || null,
                high: meta.regularMarketDayHigh || null,
                low: meta.regularMarketDayLow || null,
                volume: meta.regularMarketVolume || null,
                marketCap: null,
                currency: meta.currency || '',
                exchange: meta.exchangeName || '',
              };
            }
          }
        } catch { /* fall through to DOM */ }

        // Strategy 2: Parse from rendered page DOM
        const titleEl = document.querySelector('title');
        const priceEl = document.querySelector('[data-testid="qsp-price"]');
        const changeEl = document.querySelector('[data-testid="qsp-price-change"]');
        const changePctEl = document.querySelector('[data-testid="qsp-price-change-percent"]');

        if (priceEl) {
          return {
            symbol: ticker,
            name: titleEl ? titleEl.textContent!.split('(')[0].trim() : ticker,
            price: priceEl.textContent!.replace(/,/g, ''),
            change: changeEl?.textContent || null,
            changePercent: changePctEl?.textContent || null,
            open: null, high: null, low: null, volume: null, marketCap: null,
            currency: '', exchange: '',
          };
        }

        // No data from either strategy — check for login wall
        const url = window.location.href;
        if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
          return { error: 'Please sign in to Yahoo Finance first' };
        }

        return null;
      } catch (e: any) {
        return { error: e.message || 'Yahoo Finance scraper failed' };
      }
    },
    args: [sym],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || null;
}
