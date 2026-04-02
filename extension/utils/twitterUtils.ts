// Helper to get or create a specific style element
const getStyleElement = (id: string) => {
  let styleEl = document.getElementById(id) as HTMLStyleElement;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = id;
    document.head.appendChild(styleEl);
    // console.log(`[BNBot] Style element ${id} created`);
  }
  return styleEl;
};

// Control Twitter sidebar visibility
// Control Twitter sidebar visibility
export const setTwitterSidebarHidden = (hidden: boolean) => {
  const styleEl = getStyleElement('bnbot-sidebar-hidden-style');
  const css = hidden
    ? `
      /* Collapsing sidebar with smooth width transition */
      [data-testid="sidebarColumn"] { 
        width: 0 !important;
        min-width: 0 !important;
        flex-basis: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        opacity: 0 !important;
        overflow: hidden !important;
        transition: all 0.3s ease-in-out !important;
      }
      /* Expand main content to fill the space */
      main[role="main"] {
        max-width: 100% !important;
        transition: max-width 0.3s ease-in-out !important;
      }
    `
    : `
      /* Restore sidebar - Let Twitter defaults handle size, but transition opacity if possible */
      /* Note: Transitioning from width:0 to auto is not possible in pure CSS, but removing the rule snaps it back. */
      /* To avoid the "blank" issue, we stop enforcing max-width on main */
      /* Ideally we just clear the styles to be safe */
    `;

  // For the 'show' state (hidden=false), we want to reset to default Twitter styles almost immediately
  // to avoid any layout calculation errors that cause the blank screen.
  // However, removing it entirely removes the transition.
  // Compromise: We just set it to empty string when showing to guarantee correctness.
  // The 'jitter' might be re-introduced slightly vs the blank screen, but width:0 transition on HIDE helps.
  // On SHOW, it will snap back, which is safer than blank.

  if (!hidden) {
    styleEl.textContent = '';
    // console.log('[BNBot] setTwitterSidebarHidden: false (styles cleared)');
  } else {
    styleEl.textContent = css;
    // console.log('[BNBot] setTwitterSidebarHidden: true');
  }
};

export const setTwitterSidebarCollapsed = (collapsed: boolean) => {
  const styleEl = getStyleElement('bnbot-sidebar-collapsed-style');

  // CSS to hide text labels and make sidebar just icons
  // 1. target text containers in nav items
  // 2. target text in tweet button
  // 3. target text in account switcher
  // 4. shrink width of sidebar header container
  const css = collapsed
    ? `
      /* Hide text labels in navigation - target specific nav elements */
      header[role="banner"] nav[role="navigation"] a div[dir="ltr"],
      header[role="banner"] nav[role="navigation"] button div[dir="ltr"] {
        display: none !important;
      }

      /* Hide "Tweet" text in the primary action button */
      [data-testid="SideNav_NewTweet_Button"] div[dir="ltr"] span {
        display: none !important;
      }

      /* Reduce right sidebar width */
      [data-testid="sidebarColumn"] {
        width: 64px !important;
        min-width: 64px !important;
        flex-basis: 64px !important;
        max-width: 64px !important;
        padding: 0 !important;
        margin: 0 !important;
      }

      /* Collapse left navigation header - only target the one with nav inside */
      header[role="banner"]:has(nav[role="navigation"]) {
        width: 68px !important;
        min-width: 68px !important;
        max-width: 68px !important;
        flex-shrink: 0 !important;
      }

      /* Container inside header - all nested divs */
      header[role="banner"]:has(nav[role="navigation"]) > div,
      header[role="banner"]:has(nav[role="navigation"]) > div > div,
      header[role="banner"]:has(nav[role="navigation"]) > div > div > div,
      header[role="banner"]:has(nav[role="navigation"]) > div > div > div > div {
        width: 68px !important;
        min-width: 68px !important;
        max-width: 68px !important;
        align-items: center !important;
      }

      /* Center the nav container */
      header[role="banner"] nav[role="navigation"] {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        width: 100% !important;
      }

      /* Center icons in nav */
      header[role="banner"] nav[role="navigation"] a,
      header[role="banner"] nav[role="navigation"] button {
        display: flex !important;
        justify-content: center !important;
        align-items: center !important;
        width: 50px !important;
        height: 50px !important;
        border-radius: 9999px !important;
        padding: 0 !important;
      }

      /* Inner div of nav items - center content */
      header[role="banner"] nav[role="navigation"] a > div,
      header[role="banner"] nav[role="navigation"] button > div {
        display: flex !important;
        justify-content: center !important;
        align-items: center !important;
        padding: 0 !important;
        width: auto !important;
      }

      /* Center the X logo */
      header[role="banner"] h1 {
        display: flex !important;
        justify-content: center !important;
        width: 100% !important;
      }

      header[role="banner"] h1 a {
        margin: 0 auto !important;
      }

      /* Center Tweet button container */
      header[role="banner"]:has(nav[role="navigation"]) [data-testid="SideNav_NewTweet_Button"] {
        margin: 0 auto !important;
      }

      /* Center Account Switcher container */
      header[role="banner"]:has(nav[role="navigation"]) [data-testid="SideNav_AccountSwitcher_Button"] {
        margin: 0 auto !important;
      }

      /* Adjust Tweet button to be round and icon-only */
      [data-testid="SideNav_NewTweet_Button"] {
        min-width: 50px !important;
        min-height: 50px !important;
        width: 50px !important;
        height: 50px !important;
        padding: 0 !important;
        border-radius: 9999px !important;
        justify-content: center !important;
        align-items: center !important;
        /* Inject the Feather icon (Compose) as background to ensure it appears even if DOM differs */
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M23 3c-6.62-.1-10.38 2.421-13.05 6.03C7.29 12.61 6 17.331 6 22h2c0-1.007.07-2.012.19-3H12c4.1 0 7.48-3.082 7.94-7.054C22.79 10.147 23.17 6.359 23 3zm-7 8h-1.5v2H16c.63-.016 1.2-.08 1.72-.188C16.95 15.24 14.68 17 12 17H8.55c.57-2.512 1.57-4.851 3-6.78 2.16-2.912 5.29-4.911 9.45-5.187C20.95 8.079 19.9 11 16 11zM4 9V6H1V4h3V1h2v3h3v2H6v3H4z'/%3E%3C/svg%3E") !important;
        background-repeat: no-repeat !important;
        background-position: center !important;
        background-size: 24px !important;
      }

      /* Hide all internal content of the button to avoid duplication or text showing */
      [data-testid="SideNav_NewTweet_Button"] > div,
      [data-testid="SideNav_NewTweet_Button"] > svg,
      [data-testid="SideNav_NewTweet_Button"] span {
        display: none !important;
      }

      /* Hide Account Switcher text details (Username/Handle) */
      [data-testid="SideNav_AccountSwitcher_Button"] > div:not(:first-child) {
        display: none !important;
      }

      /* Center Account Switcher */
      [data-testid="SideNav_AccountSwitcher_Button"] {
        justify-content: center !important;
        width: 50px !important;
      }

      /* Hide the "more" dots next to profile if present on side */
      [data-testid="SideNav_AccountSwitcher_Button"] svg.r-4qtqp9 {
         display: none !important;
      }

      /* Specific fix for "Post" button text container wrapper which might remain taking space */
      [data-testid="SideNav_NewTweet_Button"] .css-146c3p1 {
        display: none !important;
      }

      /* Remove auto margins on article editor sections to align left */
      section[aria-label="板块导航"],
      section[aria-label="Section navigation"],
      section[aria-labelledby="root-header"],
      section[aria-label="板块详情"],
      section[aria-label="Section details"],
      section[aria-labelledby="detail-header"] {
        margin-left: 0 !important;
        margin-right: 0 !important;
      }

      /* Narrow the Articles list section on article editor page */
      section[aria-label="板块导航"],
      section[aria-label="Section navigation"],
      section[aria-labelledby="root-header"] {
        width: 240px !important;
        min-width: 240px !important;
        max-width: 240px !important;
        flex-shrink: 0 !important;
      }

      /* Article editor section - take remaining space */
      section[aria-label="板块详情"],
      section[aria-label="Section details"],
      section[aria-labelledby="detail-header"] {
        flex: 1 !important;
        min-width: 0 !important;
      }

      /* Grok page - shrink primary column to make room for BNBot panel */
      [data-testid="primaryColumn"] {
        max-width: calc(100vw - 486px - 68px) !important;
        border-right: none !important;
      }

    `
    : '';

  styleEl.textContent = css;
  // console.log('[BNBot] setTwitterSidebarCollapsed:', collapsed);
};

// Control focus mode dialog offset when BNBot panel is visible
export const setFocusModeDialogOffset = (enabled: boolean) => {
  const styleEl = getStyleElement('bnbot-focus-dialog-offset-style');
  const css = enabled
    ? `
      /* Shift focus mode dialog left to accommodate BNBot panel */
      div[aria-modal="true"][aria-labelledby="modal-header"] {
        margin-right: 486px !important;
      }
    `
    : '';
  styleEl.textContent = css;
  // console.log('[BNBot] setFocusModeDialogOffset:', enabled);
};

// Initialize the style element (call on mount)
export const initTwitterSidebarStyle = () => {
  // console.log('[BNBot] initTwitterSidebarStyle called');
  getStyleElement('bnbot-sidebar-hidden-style');
  getStyleElement('bnbot-sidebar-collapsed-style');
  getStyleElement('bnbot-focus-dialog-offset-style');
};
