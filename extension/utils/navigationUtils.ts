/**
 * Navigates to a URL using Twitter's internal router mechanism (SPA navigation).
 * Creates a temporary <a> link inside React root and clicks it, which Twitter's
 * SPA router intercepts. This avoids full page reload unlike window.location.href.
 */
export const navigateToUrl = (url: string) => {
    console.log('[navigateToUrl] Navigating to:', url);
    // Convert full URL to relative path
    const path = url.startsWith('http') ? url.replace(/^https?:\/\/[^/]+/, '') : url;

    // Method 1: Click an existing <a> rendered by React (most reliable SPA nav)
    const existing = document.querySelector(`a[href="${path}"], a[href$="${path}"]`) as HTMLElement;
    if (existing) {
        console.log('[navigateToUrl] Found existing link, clicking');
        existing.click();
        return;
    }

    // Method 2: pushState + popstate — Twitter's React Router listens for popstate
    console.log('[navigateToUrl] Using pushState + popstate');
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
};
