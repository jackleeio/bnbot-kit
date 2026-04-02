/**
 * Browser detection utilities for cross-browser compatibility
 * Firefox's chrome.* namespace is fully compatible, so most code doesn't need changes.
 * Only use these flags for APIs that differ (offscreen, service_worker, etc.)
 *
 * Uses build-time __FIREFOX__ define (set in vite configs) as primary signal,
 * with runtime navigator.userAgent as fallback.
 */

declare const __FIREFOX__: boolean;

export const isFirefox: boolean =
  typeof __FIREFOX__ !== 'undefined'
    ? __FIREFOX__
    : (typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox'));

export const isChrome: boolean = !isFirefox;
