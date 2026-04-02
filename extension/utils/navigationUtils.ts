/**
 * Navigates to a URL using Twitter's internal router mechanism (SPA navigation).
 * Uses pushState + popstate which Twitter's router listens to.
 */
export const navigateToUrl = (url: string) => {
    console.log('[navigateToUrl] Navigating to:', url);
    // Convert full URL to relative path
    const path = url.startsWith('http') ? url.replace(/^https?:\/\/[^/]+/, '') : url;
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
};
