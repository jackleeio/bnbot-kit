/**
 * BnbotFabInjector
 *
 * Floating action button pinned to bottom-right of the X page, positioned
 * just above X's Grok drawer. Click dispatches `bnbot-toggle-popup` which
 * the React app listens for to show/hide the popup panel.
 *
 * Design:
 * - Independent `position: fixed` (does NOT attach to GrokDrawer DOM so it
 *   survives X layout reshuffles).
 * - 44×44 pill with BNBot logo, mimics X's floating button aesthetic.
 * - Position tracks the Grok drawer: FAB sits exactly above it with an
 *   8px gap. Falls back to `bottom: 90px` if Grok isn't found.
 */

declare const chrome: any;

const FAB_ID = 'bnbot-fab-trigger';
const FAB_CSS_ID = 'bnbot-fab-styles';
const GAP_ABOVE_GROK = 8;
const FALLBACK_BOTTOM = 90;
// Grok drawer height threshold — collapsed (button only) is ~50px;
// expanded panel is hundreds of px. Above this we treat the drawer
// as expanded and hide the FAB so it doesn't block the Grok content.
const GROK_EXPANDED_HEIGHT_PX = 120;

// X selectors that should immediately collapse the BNBot popup when
// clicked. Polling alone has 500ms lag — by listening on capture phase
// we react before the drawer has even started its open animation.
const X_HIDE_TRIGGERS = [
  '[data-testid^="GrokDrawer"]',
  '[aria-label*="Grok" i]',
  '[data-testid*="DMDrawer" i]',
  '[aria-label*="Direct messages" i]',
  '[aria-label*="消息"]',
];

export class BnbotFabInjector {
  private btn: HTMLButtonElement | null = null;
  private bodyObserver: MutationObserver | null = null;
  private alignTimer: number | null = null;
  private hideClickListener: ((e: Event) => void) | null = null;

  start(): void {
    this.injectStylesOnce();
    this.ensureButton();
    this.startAlignmentLoop();

    // Re-attach if body gets replaced by SPA navigation quirks.
    this.bodyObserver = new MutationObserver(() => {
      if (!document.getElementById(FAB_ID)) this.ensureButton();
    });
    if (document.body) {
      this.bodyObserver.observe(document.body, { childList: true });
    }

    // Capture-phase pointer listener — collapse BNBot the moment a
    // Grok / DM trigger is touched, not 500ms later when polling sees
    // the drawer height change.
    this.hideClickListener = (e: Event) => {
      const target = e.target as Element | null;
      if (!target || typeof target.closest !== 'function') return;
      // Don't react to clicks inside our own FAB / popup.
      if (target.closest(`#${FAB_ID}`)) return;
      if (X_HIDE_TRIGGERS.some((sel) => target.closest(sel))) {
        this.broadcastGrokExpanded(true);
        const btn = this.btn ?? (document.getElementById(FAB_ID) as HTMLButtonElement | null);
        if (btn) btn.style.display = 'none';
      }
    };
    document.addEventListener('pointerdown', this.hideClickListener, true);
  }

  stop(): void {
    this.bodyObserver?.disconnect();
    this.bodyObserver = null;
    if (this.alignTimer !== null) {
      window.clearInterval(this.alignTimer);
      this.alignTimer = null;
    }
    if (this.hideClickListener) {
      document.removeEventListener('pointerdown', this.hideClickListener, true);
      this.hideClickListener = null;
    }
    this.btn?.remove();
    this.btn = null;
  }

  private injectStylesOnce(): void {
    if (document.getElementById(FAB_CSS_ID)) return;
    const style = document.createElement('style');
    style.id = FAB_CSS_ID;
    style.textContent = `
      #${FAB_ID} {
        position: fixed;
        right: 20px;
        bottom: ${FALLBACK_BOTTOM}px;
        width: 54px;
        height: 54px;
        border-radius: 14px;
        background: #ffffff;
        border: 1px solid rgba(0, 0, 0, 0.08);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        z-index: 9998;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }
      #${FAB_ID}:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
      }
      #${FAB_ID} img {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        pointer-events: none;
      }
      @media (prefers-color-scheme: dark) {
        #${FAB_ID} {
          background: #16181c;
          border-color: rgba(255, 255, 255, 0.1);
        }
      }
    `;
    document.head.appendChild(style);
  }

  private ensureButton(): void {
    if (document.getElementById(FAB_ID)) return;

    const btn = document.createElement('button');
    btn.id = FAB_ID;
    btn.type = 'button';
    btn.title = 'BNBot';
    btn.setAttribute('aria-label', 'Open BNBot');

    const logo = chrome.runtime?.getURL?.('assets/images/bnbot-rounded-logo-5.png') || '';
    btn.innerHTML = `<img src="${logo}" alt="BNBot" />`;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('bnbot-toggle-popup'));
    });

    document.body.appendChild(btn);
    this.btn = btn;
    // Align immediately after mount so the button doesn't flash at the
    // fallback position.
    this.alignToGrok();
  }

  /**
   * Poll the Grok drawer position every 500ms and match our FAB's
   * bottom to sit right above it (Grok may expand, collapse, or
   * disappear on different pages).
   */
  private startAlignmentLoop(): void {
    if (this.alignTimer !== null) return;
    this.alignTimer = window.setInterval(() => {
      this.alignToGrok();
    }, 500);
  }

  private alignToGrok(): void {
    const btn = this.btn ?? (document.getElementById(FAB_ID) as HTMLButtonElement | null);
    if (!btn) return;

    // Prefer the header (the circular part that's always visible), fall
    // back to the drawer root.
    const grok =
      document.querySelector('[data-testid="GrokDrawerHeader"]') ||
      document.querySelector('[data-testid="GrokDrawer"]');

    if (!grok) {
      btn.style.display = 'flex';
      btn.style.bottom = `${FALLBACK_BOTTOM}px`;
      // Match Grok's typical right edge.
      btn.style.right = '20px';
      return;
    }

    // If the Grok drawer is expanded into a full panel, hide our FAB
    // entirely — it would otherwise float above Grok's expanded view
    // and block content. Also signal the React popup to collapse so
    // the BNBot panel doesn't sit on top of Grok either. Re-show
    // automatically when Grok collapses (FAB only — the popup stays
    // closed; user re-opens it when they want it).
    const drawerRoot =
      document.querySelector('[data-testid="GrokDrawer"]') as HTMLElement | null;
    const drawerHeight = drawerRoot?.getBoundingClientRect().height ?? 0;
    const grokExpanded = drawerHeight > GROK_EXPANDED_HEIGHT_PX;
    this.broadcastGrokExpanded(grokExpanded);
    if (grokExpanded) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = 'flex';

    const rect = (grok as HTMLElement).getBoundingClientRect();
    // Distance from viewport bottom to Grok's top edge.
    const grokBottomToViewportBottom = Math.max(0, window.innerHeight - rect.top);
    // Place FAB's bottom edge `grokBottomToViewportBottom + GAP_ABOVE_GROK`
    // px above viewport bottom, so its top edge sits above Grok.
    const desiredBottom = grokBottomToViewportBottom + GAP_ABOVE_GROK;
    btn.style.bottom = `${desiredBottom}px`;

    // Right-align with Grok header so FAB and Grok share a vertical axis.
    // Use the right-edge gap: (viewport right) - (grok right).
    const grokRightGap = Math.max(0, window.innerWidth - rect.right);
    const desiredRight = grokRightGap + (rect.width - 54) / 2;
    btn.style.right = `${desiredRight}px`;

    // Broadcast FAB position so the React popup can anchor itself above
    // the FAB (so opening the popup doesn't cover the FAB).
    this.broadcastPosition(desiredBottom, desiredRight);
  }

  private lastGrokExpanded: boolean | null = null;
  private broadcastGrokExpanded(expanded: boolean): void {
    if (this.lastGrokExpanded === expanded) return;
    this.lastGrokExpanded = expanded;
    window.dispatchEvent(
      new CustomEvent('bnbot-grok-expanded', { detail: { expanded } }),
    );
  }

  private lastBroadcast: { bottom: number; right: number } | null = null;
  private broadcastPosition(bottom: number, right: number): void {
    // Dedup identical positions so we don't spam React setState every 500ms.
    if (
      this.lastBroadcast &&
      this.lastBroadcast.bottom === bottom &&
      this.lastBroadcast.right === right
    ) {
      return;
    }
    this.lastBroadcast = { bottom, right };
    window.dispatchEvent(
      new CustomEvent('bnbot-fab-aligned', {
        detail: { bottom, right, height: 54 },
      }),
    );
  }
}
