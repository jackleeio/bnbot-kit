/**
 * LinkedIn job search — uses Voyager API with CSRF tokens from browser session.
 *
 * Reference: opencli linkedin/search.ts
 * Requires user to be signed into LinkedIn in the browser.
 */

import { getTab, checkLoginRedirect } from '../../scraperService';

// ── Filter value mappings ──────────────────────────────────────────

const EXPERIENCE_LEVELS: Record<string, string> = {
  internship: '1', entry: '2', associate: '3', mid: '4', senior: '4',
  'mid-senior': '4', director: '5', executive: '6',
};

const JOB_TYPES: Record<string, string> = {
  'full-time': 'F', fulltime: 'F', 'part-time': 'P', parttime: 'P',
  contract: 'C', temporary: 'T', volunteer: 'V', internship: 'I', other: 'O',
};

const DATE_POSTED: Record<string, string> = {
  any: 'on', month: 'r2592000', week: 'r604800', day: 'r86400', '24h': 'r86400',
};

const REMOTE_TYPES: Record<string, string> = {
  onsite: '1', 'on-site': '1', hybrid: '3', remote: '2',
};

// ── Types ──────────────────────────────────────────────────────────

export interface LinkedInJobResult {
  rank: number;
  title: string;
  company: string;
  location: string;
  listed: string;
  salary: string;
  url: string;
}

export interface LinkedInSearchOptions {
  location?: string;
  limit?: number;
  experienceLevel?: string;
  jobType?: string;
  datePosted?: string;
  remote?: string;
}

// ── Helpers ────────────────────────────────────────────────────────

function mapFilterValues(input: string | undefined, mapping: Record<string, string>): string[] {
  if (!input?.trim()) return [];
  return input.split(',').map(v => v.trim().toLowerCase()).filter(Boolean)
    .map(v => mapping[v]).filter(Boolean);
}

function buildVoyagerSearchQuery(
  keywords: string, location: string,
  expLevels: string[], jobTypes: string[], datePosts: string[], remotes: string[],
): string {
  const hasFilters = expLevels.length || jobTypes.length || datePosts.length || remotes.length;
  const parts = [
    'origin:' + (hasFilters ? 'JOB_SEARCH_PAGE_JOB_FILTER' : 'JOB_SEARCH_PAGE_OTHER_ENTRY'),
    'keywords:' + keywords,
  ];
  if (location) parts.push('locationUnion:(seoLocation:(location:' + location + '))');
  const filters: string[] = [];
  if (expLevels.length) filters.push('experience:List(' + expLevels.join(',') + ')');
  if (jobTypes.length) filters.push('jobType:List(' + jobTypes.join(',') + ')');
  if (datePosts.length) filters.push('timePostedRange:List(' + datePosts.join(',') + ')');
  if (remotes.length) filters.push('workplaceType:List(' + remotes.join(',') + ')');
  if (filters.length) parts.push('selectedFilters:(' + filters.join(',') + ')');
  parts.push('spellCorrectionEnabled:true');
  return '(' + parts.join(',') + ')';
}

function buildVoyagerUrl(
  keywords: string, location: string, offset: number, count: number,
  expLevels: string[], jobTypes: string[], datePosts: string[], remotes: string[],
): string {
  const params = new URLSearchParams({
    decorationId: 'com.linkedin.voyager.dash.deco.jobs.search.JobSearchCardsCollection-220',
    count: String(count),
    q: 'jobSearch',
  });
  const query = encodeURIComponent(buildVoyagerSearchQuery(keywords, location, expLevels, jobTypes, datePosts, remotes))
    .replace(/%3A/gi, ':').replace(/%2C/gi, ',').replace(/%28/gi, '(').replace(/%29/gi, ')');
  return '/voyager/api/voyagerJobsDashJobCards?' + params.toString() + '&query=' + query + '&start=' + offset;
}

// ── Main search function ───────────────────────────────────────────

export async function searchLinkedInJobs(
  query: string,
  options: LinkedInSearchOptions = {},
): Promise<LinkedInJobResult[]> {
  const limit = Math.min(Math.max(1, options.limit ?? 20), 100);
  const location = options.location?.trim() || '';
  const expLevels = mapFilterValues(options.experienceLevel, EXPERIENCE_LEVELS);
  const jobTypes = mapFilterValues(options.jobType, JOB_TYPES);
  const datePosts = mapFilterValues(options.datePosted, DATE_POSTED);
  const remotes = mapFilterValues(options.remote, REMOTE_TYPES);

  const searchParams = new URLSearchParams({ keywords: query });
  if (location) searchParams.set('location', location);
  const tabId = await getTab(`https://www.linkedin.com/jobs/search/?${searchParams.toString()}`);
  await new Promise(r => setTimeout(r, 4000));
  await checkLoginRedirect(tabId, 'LinkedIn');

  // Build all batch URLs upfront (max 25 per batch)
  const MAX_BATCH = 25;
  const batchUrls: string[] = [];
  for (let offset = 0; offset < limit; offset += MAX_BATCH) {
    const count = Math.min(MAX_BATCH, limit - offset);
    batchUrls.push(buildVoyagerUrl(query, location, offset, count, expLevels, jobTypes, datePosts, remotes));
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (urls: string[], lim: number) => {
      try {
        // Extract CSRF token from JSESSIONID cookie
        const jsession = document.cookie.split(';').map(p => p.trim())
          .find(p => p.startsWith('JSESSIONID='))?.slice('JSESSIONID='.length);
        if (!jsession) {
          // Fallback: DOM scraping if not signed in to Voyager API
          const cards = document.querySelectorAll('.job-card-container, .jobs-search-results__list-item, [data-job-id]');
          const items: any[] = [];
          for (const card of cards) {
            if (items.length >= lim) break;
            const titleEl = card.querySelector('.job-card-list__title, .artdeco-entity-lockup__title a, a[class*="title"]');
            const companyEl = card.querySelector('.artdeco-entity-lockup__subtitle, [class*="company"], .job-card-container__primary-description');
            const locationEl = card.querySelector('[class*="location"], .artdeco-entity-lockup__caption');
            const title = titleEl?.textContent?.trim() || '';
            if (!title) continue;
            const href = titleEl?.closest('a')?.getAttribute('href') || '';
            items.push({
              rank: items.length + 1, title,
              company: companyEl?.textContent?.trim() || '',
              location: locationEl?.textContent?.trim()?.split('\n')[0]?.trim() || '',
              listed: '', salary: '',
              url: href.startsWith('http') ? href : href ? 'https://www.linkedin.com' + href : '',
            });
          }
          if (items.length === 0) return { error: 'No results found — please sign in to LinkedIn first' };
          return items;
        }

        const csrf = jsession.replace(/^"|"$/g, '');
        const allJobs: any[] = [];

        for (const apiPath of urls) {
          if (allJobs.length >= lim) break;
          try {
            const res = await fetch(apiPath, {
              credentials: 'include',
              headers: { 'csrf-token': csrf, 'x-restli-protocol-version': '2.0.0' },
            });
            if (!res.ok) break;
            const batch = await res.json();
            const elements = Array.isArray(batch?.elements) ? batch.elements : [];
            if (elements.length === 0) break;

            for (const element of elements) {
              const card = element?.jobCardUnion?.jobPostingCard;
              if (!card) continue;
              const jobId = [card.jobPostingUrn, card.jobPosting?.entityUrn, card.entityUrn]
                .filter(Boolean).map((s: string) => String(s).match(/(\d+)/)?.[1]).find(Boolean) ?? '';
              const listedItem = (card.footerItems || []).find((i: any) => i?.type === 'LISTED_DATE' && i?.timeAt);
              const listed = listedItem?.timeAt ? new Date(listedItem.timeAt).toISOString().slice(0, 10) : '';
              allJobs.push({
                rank: allJobs.length + 1,
                title: card.jobPostingTitle || card.title?.text || '',
                company: card.primaryDescription?.text || '',
                location: card.secondaryDescription?.text || '',
                listed,
                salary: card.tertiaryDescription?.text || '',
                url: jobId ? 'https://www.linkedin.com/jobs/view/' + jobId : '',
              });
            }
          } catch { break; }
        }

        const finalJobs = allJobs.slice(0, lim);
        if (finalJobs.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to LinkedIn first' };
          }
        }
        return finalJobs;
      } catch (e: any) {
        return { error: e.message || 'LinkedIn scraper failed — please sign in to LinkedIn first' };
      }
    },
    args: [batchUrls, limit],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}
