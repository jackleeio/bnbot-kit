/**
 * LinkedIn job search — uses Voyager API with CSRF tokens from browser session.
 *
 * Reference: opencli linkedin/search.ts
 * Requires user to be signed into LinkedIn in the browser.
 */

import { getTab, checkLoginRedirect, executeInPage } from '../../scraperService';

// ── Filter value mappings ──────────────────────────────────────────

const EXPERIENCE_LEVELS: Record<string, string> = {
  internship: '1', entry: '2', 'entry-level': '2', associate: '3',
  mid: '4', senior: '4', 'mid-senior': '4', 'mid-senior-level': '4',
  director: '5', executive: '6',
};

const JOB_TYPES: Record<string, string> = {
  'full-time': 'F', fulltime: 'F', full: 'F',
  'part-time': 'P', parttime: 'P', part: 'P',
  contract: 'C', temporary: 'T', volunteer: 'V', internship: 'I', other: 'O',
};

const DATE_POSTED: Record<string, string> = {
  any: 'on', month: 'r2592000', 'past-month': 'r2592000',
  week: 'r604800', 'past-week': 'r604800', day: 'r86400',
  '24h': 'r86400', 'past-24h': 'r86400',
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

  const data = await executeInPage(tabId, async (urls: string[], lim: number) => {
      try {
        const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
        const makeUrl = (href: string) => {
          if (!href) return '';
          try {
            const parsed = new URL(href, 'https://www.linkedin.com');
            if (parsed.hostname !== 'www.linkedin.com' && parsed.hostname !== 'linkedin.com') return '';
            return parsed.toString();
          } catch {
            return href.startsWith('/') ? 'https://www.linkedin.com' + href : href;
          }
        };
        const scrapeDomJobs = async () => {
          const scroller = document.querySelector('.jobs-search-results-list, .jobs-search-results-list__list, .scaffold-layout__list, main');
          if (scroller instanceof HTMLElement) {
            scroller.scrollTo(0, Math.min(scroller.scrollHeight, 1200));
            await new Promise(r => setTimeout(r, 700));
          }
          const cards = document.querySelectorAll('[data-job-id], [data-occludable-job-id], .jobs-search-results__list-item, .job-card-container, .job-search-card, .base-search-card');
          const items: any[] = [];
          const seen = new Set<string>();
          for (const card of cards) {
            if (items.length >= lim) break;
            const titleEl = card.querySelector(
              '.job-card-list__title, .job-card-list__title--link, .base-search-card__title, a.job-card-container__link, a[href*="/jobs/view/"], strong',
            );
            const linkEl = titleEl?.closest('a') || card.querySelector('a[href*="/jobs/view/"]');
            const title = clean(titleEl?.textContent || linkEl?.textContent);
            if (!title) continue;
            const href = linkEl?.getAttribute('href') || '';
            const url = makeUrl(href);
            const companyEl = card.querySelector(
              '.job-card-container__primary-description, .job-card-container__company-name, .base-search-card__subtitle, .artdeco-entity-lockup__subtitle',
            );
            const locationEl = card.querySelector(
              '.job-search-card__location, .job-card-container__metadata-item, .artdeco-entity-lockup__caption, [class*="location"]',
            );
            const listedEl = card.querySelector('time, .job-card-container__listed-time, [class*="listed"]');
            const metadata = [...card.querySelectorAll('.job-card-container__metadata-item, li')]
              .map(el => clean(el.textContent))
              .filter(Boolean);
            const salary = metadata.find(text => /\$|salary|compensation|\/yr|\/hr/i.test(text)) || '';
            const key = url || `${title}:${clean(companyEl?.textContent)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            items.push({
              rank: items.length + 1,
              title,
              company: clean(companyEl?.textContent),
              location: clean(locationEl?.textContent).split('\n')[0]?.trim() || '',
              listed: listedEl instanceof HTMLTimeElement
                ? (listedEl.dateTime || clean(listedEl.textContent))
                : clean(listedEl?.textContent),
              salary,
              url,
            });
          }
          return items;
        };

        // Extract CSRF token from JSESSIONID cookie
        const jsession = document.cookie.split(';').map(p => p.trim())
          .find(p => p.startsWith('JSESSIONID='))?.slice('JSESSIONID='.length);
        if (!jsession) {
          const items = await scrapeDomJobs();
          if (items.length === 0) return { error: 'No results found — please sign in to LinkedIn first' };
          return items;
        }

        const csrf = jsession.replace(/^"|"$/g, '');
        const allJobs: any[] = [];
        let apiError = '';

        for (const apiPath of urls) {
          if (allJobs.length >= lim) break;
          try {
            const res = await fetch(apiPath, {
              credentials: 'include',
              headers: { 'csrf-token': csrf, 'x-restli-protocol-version': '2.0.0' },
            });
            if (res.status === 401 || res.status === 403) {
              const text = await res.text();
              apiError = 'LinkedIn API authentication failed: HTTP ' + res.status + ' ' + text.slice(0, 200);
              break;
            }
            if (!res.ok) {
              const text = await res.text();
              apiError = 'LinkedIn API error: HTTP ' + res.status + ' ' + text.slice(0, 200);
              break;
            }
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
          const domJobs = await scrapeDomJobs();
          if (domJobs.length > 0) return domJobs;
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to LinkedIn first' };
          }
          if (apiError) return { error: apiError };
        }
        return finalJobs;
      } catch (e: any) {
        return { error: e.message || 'LinkedIn scraper failed — please sign in to LinkedIn first' };
      }
    }, [batchUrls, limit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}
