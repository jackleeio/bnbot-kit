/**
 * Navigates to a URL using Twitter's internal router mechanism (SPA navigation).
 * Creates a temporary <a> link inside React root and clicks it, which Twitter's
 * SPA router intercepts. This avoids full page reload unlike window.location.href.
 */
export const navigateToUrl = (url: string) => {
    console.log('[navigateToUrl] Navigating to:', url);
    // Convert full URL to relative path
    const path = url.startsWith('http') ? url.replace(/^https?:\/\/[^/]+/, '') : url;
    const tempLink = document.createElement('a');
    tempLink.href = path;
    tempLink.style.display = 'none';
    const reactRoot = document.getElementById('react-root') || document.body;
    reactRoot.appendChild(tempLink);
    tempLink.click();
    reactRoot.removeChild(tempLink);
};
