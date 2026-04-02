/**
 * AnalyzeButtonInjector
 * Injects a BNBot analyze icon next to the Grok button on tweets.
 *
 * DOM structure (from user's inspection):
 * div.r-1kkk96v
 *   div.r-1awozwy.r-18u37iz (flex row, 2 children)
 *     div (Grok wrapper)        ← INSERT BEFORE THIS
 *       button[aria-label*="Grok"]
 *     div (Caret group)
 *       div
 *         div
 *           button[data-testid="caret"]
 *
 * Strategy: find caret, go up 4 levels to the flex row,
 * then insert before its first child (Grok wrapper).
 */

import { chatService } from '../services/chatService';
import { authService } from '../services/authService';

const ANALYZE_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" class="r-4qtqp9 r-yyyyoo r-dnmrzs r-bnwqim r-lrvibr r-m6rgpd r-1xvli5t r-1hdv0qi" fill="currentColor"><path d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z"/></svg>`;

// Sparkle/AI icon for the reply button
const AI_REPLY_ICON_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9.5 2l2.3 4.7L16.5 9l-4.7 2.3L9.5 16l-2.3-4.7L2.5 9l4.7-2.3L9.5 2zm8 5l1.3 2.7L21.5 11l-2.7 1.3-1.3 2.7-1.3-2.7L13.5 11l2.7-1.3L17.5 7z"/></svg>`;

export class AnalyzeButtonInjector {
  private observer: MutationObserver | null = null;
  private injectedTweets = new WeakSet<HTMLElement>();
  private debounceTimer: number | null = null;

  start(): void {
    console.log('[AnalyzeButtonInjector] Starting...');
    this.scanAndInject();

    this.observer = new MutationObserver((mutations) => {
      // Fast path: only scan if new nodes contain caret or toolBar
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement && (
            node.querySelector?.('[data-testid="caret"], [data-testid="toolBar"]') ||
            (node as Element).matches?.('[data-testid="caret"], [data-testid="toolBar"]')
          )) {
            this.scanAndInject();
            return;
          }
        }
      }
    });

    if (document.body) {
      this.observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  private scanAndInject(): void {
    // Inject AI reply button next to the reply button in the toolbar area only.
    // The toolBar (data-testid="toolBar") and the reply button share the same parent.
    // Structure: parent > [toolBar, div > tweetButtonInline]
    const toolbars = document.querySelectorAll('[data-testid="toolBar"]');
    toolbars.forEach((toolbar) => {
      const parent = toolbar.parentElement;
      if (!parent) return;
      const replyBtn = parent.querySelector('[data-testid="tweetButtonInline"]');
      if (!replyBtn) return;
      if (replyBtn.previousElementSibling?.classList.contains('bnbot-ai-reply-btn')) return;
      // Clean up any orphaned AI buttons in the whole reply_offscreen container
      const offscreen = toolbar.closest('[data-testid="inline_reply_offscreen"]');
      if (offscreen) {
        offscreen.querySelectorAll('.bnbot-ai-reply-btn').forEach(el => el.remove());
      }
      this.injectAIReplyButton(replyBtn as HTMLElement);
    });

    // Inject BNBot image reply icon at the end of the toolbar ScrollSnap-List
    const scrollLists = document.querySelectorAll('[data-testid="ScrollSnap-List"]');
    scrollLists.forEach((list) => {
      if (list.querySelector('.bnbot-img-reply-btn')) return;
      // Only inject in the reply toolbar (must be inside inline_reply_offscreen)
      const offscreen = list.closest('[data-testid="inline_reply_offscreen"]');
      if (!offscreen) return;
      this.injectImageReplyIcon(list as HTMLElement);
    });

    // Inject AI Quote button after bookmark (before share) in tweet action bar
    const bookmarkBtns = document.querySelectorAll('[data-testid="bookmark"]');
    bookmarkBtns.forEach((bookmarkBtn) => {
      const bookmarkWrapper = bookmarkBtn.closest('[class*="r-18u37iz"][class*="r-1h0z5md"][class*="r-13awgt0"]');
      if (!bookmarkWrapper) return;
      if (bookmarkWrapper.nextElementSibling?.classList.contains('bnbot-quote-btn')) return;
      const tweet = bookmarkBtn.closest('article[data-testid="tweet"]') as HTMLElement;
      if (!tweet) return;
      const tweetId = this.extractTweetId(tweet);
      if (!tweetId) return;
      this.injectQuoteButton(bookmarkWrapper as HTMLElement, tweetId);
    });

    // Inject "Thread Summary" button next to Grok on thread tweets
    // A thread is detected when the same author has replies below the main tweet
    if (window.location.pathname.includes('/status/')) {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      if (articles.length >= 2 && !document.querySelector('.bnbot-thread-summary-btn')) {
        // Check if it's a thread: main tweet author === reply author
        const getAuthorHandle = (article: Element) => {
          const link = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
          return link?.getAttribute('href')?.replace('/', '').toLowerCase() || '';
        };
        const mainAuthor = getAuthorHandle(articles[0]);
        const replyAuthor = getAuthorHandle(articles[1]);
        if (mainAuthor && mainAuthor === replyAuthor) {
          // It's a thread! Inject summary button next to Grok on the main tweet
          const mainTweet = articles[0];
          const caret = mainTweet.querySelector('[data-testid="caret"]') as HTMLElement;
          if (caret) {
            this.injectThreadSummaryButton(caret);
          }
        }
      }
    }

    // Inject "AI 复写" button in the tweet detail page header (right side)
    if (window.location.pathname.includes('/status/')) {
      const backBtn = document.querySelector('[data-testid="app-bar-back"]');
      if (backBtn && !document.querySelector('.bnbot-rewrite-btn')) {
        this.injectRewriteButton(backBtn as HTMLElement);
      }
    }
  }

  private extractTweetId(tweet: HTMLElement): string | null {
    const link = tweet.querySelector('a[href*="/status/"]');
    if (link) {
      const href = link.getAttribute('href');
      const match = href?.match(/\/status\/(\d+)/);
      if (match) return match[1];
    }
    return null;
  }

  private injectAnalyzeButton(tweet: HTMLElement, caret: HTMLElement): void {
    this.injectedTweets.add(tweet);

    const tweetId = this.extractTweetId(tweet);
    if (!tweetId) return;

    // caret (button) → div (r-18u37iz) → div → div (caret group) → div (flex row)
    // Walk up exactly 4 levels from caret to reach the flex row
    let flexRow: HTMLElement | null = caret;
    for (let i = 0; i < 4; i++) {
      flexRow = flexRow?.parentElement || null;
    }
    if (!flexRow || flexRow.children.length < 2) return;

    // The first child of flexRow is the Grok wrapper — insert before it
    const grokWrapper = flexRow.firstElementChild;
    if (!grokWrapper) return;

    console.log('[AnalyzeButtonInjector] Injecting for tweet', tweetId);

    const btn = this.createButton(tweetId);
    flexRow.insertBefore(btn, grokWrapper);
  }

  private injectAIReplyButton(replyBtn: HTMLElement): void {
    // Extract tweetId from URL (reply composer is on /status/ pages)
    const match = window.location.pathname.match(/\/status\/(\d+)/);
    const tweetId = match?.[1];
    if (!tweetId) return;

    const container = replyBtn.parentElement;
    if (!container) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bnbot-ai-reply-btn css-175oi2r r-sdzlij r-1phboty r-rs99b7 r-lrvibr r-2yi16 r-1qi8awa r-3pj75a r-o7ynqc r-6416eg r-1ny4l3l';
    btn.style.cssText = 'cursor: pointer; background-color: transparent; border: 1px solid rgb(207, 217, 222); border-radius: 9999px; margin-left: 4px;';

    btn.innerHTML = `
      <div dir="ltr" class="css-146c3p1 r-qvutc0 r-37j5jr r-q4m81j r-a023e6 r-rjixqe r-b88u0q r-1awozwy r-6koalj r-18u37iz r-16y2uox r-bcqeeo r-1777fci" style="color: rgb(15, 20, 25); display: flex; align-items: center; gap: 3px;">
        <img src="${chrome.runtime?.getURL?.('assets/images/bnbot-rounded-logo-5.png') || ''}" style="width:16px;height:16px;border-radius:50%;" />
        <div class="css-175oi2r r-xoduu5"><span class="css-1jxf684 r-dnmrzs r-1udh08x r-1udbk01 r-3s2u2q r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3 r-a023e6 r-rjixqe"><span class="css-1jxf684 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3">回复</span></span></div>
      </div>
    `;

    btn.title = 'AI Reply';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await this.handleInlineAIReply(btn, replyBtn);
    });

    // Insert after the reply button (at the end)
    replyBtn.parentElement?.appendChild(btn);
  }

  private injectThreadSummaryButton(caret: HTMLElement): void {
    // Same navigation as analyze button: caret → 4 levels up → flex row
    let flexRow: HTMLElement | null = caret;
    for (let i = 0; i < 4; i++) {
      flexRow = flexRow?.parentElement || null;
    }
    if (!flexRow || flexRow.children.length < 2) return;

    const grokWrapper = flexRow.firstElementChild;
    if (!grokWrapper) return;

    const match = window.location.pathname.match(/\/status\/(\d+)/);
    const tweetId = match?.[1];
    if (!tweetId) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'bnbot-thread-summary-btn css-175oi2r r-18u37iz r-1h0z5md';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'css-175oi2r r-1777fci r-bt1l66 r-bztko3 r-lrvibr r-1loqt21 r-1ny4l3l';
    btn.style.cursor = 'pointer';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', 'Thread Summary');

    // Document/summary icon with "AI" text, matching Twitter's icon style
    btn.innerHTML = `
      <div dir="ltr" class="css-146c3p1 r-bcqeeo r-1ttztb7 r-qvutc0 r-37j5jr r-a023e6 r-rjixqe r-16dba41 r-1awozwy r-6koalj r-1h0z5md r-o7ynqc r-clp7b1 r-3s2u2q" style="color: rgb(15, 20, 25);">
        <div class="css-175oi2r r-xoduu5">
          <div class="bnbot-thread-hover css-175oi2r r-xoduu5 r-1p0dtai r-1d2f490 r-u8s1d r-zchlnj r-ipm5af r-1niwhzg r-sdzlij r-xf4iuw r-o7ynqc r-6416eg r-1ny4l3l" style="transition: background-color 0.2s;"></div>
          <svg viewBox="0 0 24 24" aria-hidden="true" class="r-4qtqp9 r-yyyyoo r-dnmrzs r-bnwqim r-lrvibr r-m6rgpd r-1xvli5t r-1hdv0qi" fill="currentColor">
            <path d="M3 4.5C3 3.12 4.12 2 5.5 2h10C16.88 2 18 3.12 18 4.5v11c0 1.38-1.12 2.5-2.5 2.5h-10C4.12 18 3 16.88 3 15.5v-11zM5.5 4c-.28 0-.5.22-.5.5v11c0 .28.22.5.5.5h10c.28 0 .5-.22.5-.5v-11c0-.28-.22-.5-.5-.5h-10zM7 7h7v1.5H7V7zm0 3.5h7V12H7v-1.5zm0 3.5h5v1.5H7V14z"></path>
            <path d="M7 20h8.5c2.49 0 4.5-2.01 4.5-4.5V6h-1.5v9.5c0 1.66-1.34 3-3 3H7V20z" opacity="0.5"></path>
            <text x="20.5" y="22.5" text-anchor="middle" font-size="6" font-weight="bold" fill="currentColor" font-family="Arial,sans-serif">AI</text>
          </svg>
        </div>
      </div>
    `;

    const hoverCircle = btn.querySelector('.bnbot-thread-hover') as HTMLElement;
    if (hoverCircle) {
      btn.addEventListener('mouseenter', () => {
        hoverCircle.style.backgroundColor = 'rgba(29, 155, 240, 0.1)';
      });
      btn.addEventListener('mouseleave', () => {
        hoverCircle.style.backgroundColor = 'transparent';
      });
    }

    btn.title = '长推总结';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent('bnbot-analyze-tweet', { detail: { tweetId, action: 'summary' } })
      );
    });

    wrapper.appendChild(btn);
    flexRow.insertBefore(wrapper, grokWrapper);
  }

  private injectQuoteButton(bookmarkWrapper: HTMLElement, tweetId: string): void {
    const container = bookmarkWrapper.parentElement;
    if (!container) return;

    // Clone the bookmark wrapper structure for consistent styling
    const wrapper = document.createElement('div');
    wrapper.className = 'bnbot-quote-btn css-175oi2r r-18u37iz r-1h0z5md r-13awgt0';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'css-175oi2r r-1777fci r-bt1l66 r-bztko3 r-lrvibr r-1loqt21 r-1ny4l3l';
    btn.style.cursor = 'pointer';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', 'AI 引用');

    // Quote bubble with "AI" badge icon, matching Twitter action bar style
    btn.innerHTML = `
      <div dir="ltr" class="css-146c3p1 r-bcqeeo r-1ttztb7 r-qvutc0 r-37j5jr r-a023e6 r-rjixqe r-16dba41 r-1awozwy r-6koalj r-1h0z5md r-o7ynqc r-clp7b1 r-3s2u2q" style="color: rgb(83, 100, 113);">
        <div class="css-175oi2r r-xoduu5">
          <div class="css-175oi2r r-xoduu5 r-1p0dtai r-1d2f490 r-u8s1d r-zchlnj r-ipm5af r-1niwhzg r-sdzlij r-xf4iuw r-o7ynqc r-6416eg r-1ny4l3l"></div>
          <svg viewBox="0 0 24 24" aria-hidden="true" class="r-4qtqp9 r-yyyyoo r-dnmrzs r-bnwqim r-lrvibr r-m6rgpd r-50lct3 r-1srniue" fill="currentColor">
            <path d="M14.23 2.854c.98-.977 2.56-.977 3.54 0l3.38 3.378c.97.977.97 2.559 0 3.536L9.91 21H3v-6.914L14.23 2.854zm2.12 1.414c-.19-.195-.51-.195-.7 0L5 14.914V19h4.09L19.73 8.354c.2-.196.2-.512 0-.708l-3.38-3.378z"></path>
            <text x="19" y="22" text-anchor="middle" font-size="6.5" font-weight="bold" fill="currentColor" font-family="Arial,sans-serif">AI</text>
          </svg>
        </div>
      </div>
    `;

    // Hover effect
    const hoverCircle = btn.querySelector('.r-1p0dtai') as HTMLElement;
    if (hoverCircle) {
      btn.addEventListener('mouseenter', () => {
        hoverCircle.style.backgroundColor = 'rgba(29, 155, 240, 0.1)';
      });
      btn.addEventListener('mouseleave', () => {
        hoverCircle.style.backgroundColor = 'transparent';
      });
    }

    btn.title = 'AI 引用';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent('bnbot-analyze-tweet', { detail: { tweetId, action: 'quote' } })
      );
    });

    wrapper.appendChild(btn);
    // Insert after bookmark (before share button)
    const nextSibling = bookmarkWrapper.nextElementSibling;
    if (nextSibling) {
      container.insertBefore(wrapper, nextSibling);
    } else {
      container.appendChild(wrapper);
    }
  }

  private injectImageReplyIcon(scrollList: HTMLElement): void {
    // Create a wrapper matching Twitter's toolbar button structure
    const wrapper = document.createElement('div');
    wrapper.setAttribute('role', 'presentation');
    wrapper.className = 'bnbot-img-reply-btn css-175oi2r r-14tvyh0 r-cpa5s6';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'css-175oi2r r-sdzlij r-1phboty r-rs99b7 r-lrvibr r-2yi16 r-1qi8awa r-1loqt21 r-o7ynqc r-6416eg r-1ny4l3l';
    btn.style.cssText = 'background-color: rgba(0,0,0,0); border-color: rgba(0,0,0,0); cursor: pointer;';
    btn.setAttribute('aria-label', 'BNBot Image Reply');

    // Image icon with "AI" badge, blue color matching Twitter toolbar
    btn.innerHTML = `
      <div dir="ltr" class="css-146c3p1 r-qvutc0 r-37j5jr r-q4m81j r-a023e6 r-rjixqe r-b88u0q r-1awozwy r-6koalj r-18u37iz r-16y2uox r-bcqeeo r-1777fci" style="color: rgb(29, 155, 240);">
        <svg viewBox="0 0 24 24" aria-hidden="true" class="r-4qtqp9 r-yyyyoo r-dnmrzs r-bnwqim r-lrvibr r-m6rgpd r-z80fyv r-19wmn03" fill="currentColor"><path d="M3 5.5C3 4.119 4.119 3 5.5 3h13C19.881 3 21 4.119 21 5.5v13c0 1.381-1.119 2.5-2.5 2.5h-13C4.119 21 3 19.881 3 18.5v-13zM5.5 5c-.276 0-.5.224-.5.5v9.086l3-3 3 3 5-5 3 3V5.5c0-.276-.224-.5-.5-.5h-13zM19 15.414l-3-3-5 5-3-3-3 3V18.5c0 .276.224.5.5.5h13c.276 0 .5-.224.5-.5v-3.086zM9.75 7C8.784 7 8 7.784 8 8.75s.784 1.75 1.75 1.75 1.75-.784 1.75-1.75S10.716 7 9.75 7z"></path><rect x="14" y="4" width="9" height="6" rx="1.5" fill="rgb(29,155,240)"></rect><text x="18.5" y="8.5" text-anchor="middle" font-size="5" font-weight="bold" fill="white" font-family="Arial">AI</text></svg>
        <div class="css-175oi2r r-xoduu5"><span class="css-1jxf684 r-dnmrzs r-1udh08x r-1udbk01 r-3s2u2q r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3 r-a023e6 r-rjixqe"></span></div>
      </div>
    `;
    btn.title = 'AI 图片回复';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const match = window.location.pathname.match(/\/status\/(\d+)/);
      const tweetId = match?.[1];
      if (tweetId) {
        window.dispatchEvent(
          new CustomEvent('bnbot-analyze-tweet', { detail: { tweetId, action: 'imageReply' } })
        );
      }
    });

    wrapper.appendChild(btn);
    scrollList.appendChild(wrapper);
  }

  private injectRewriteButton(backBtn: HTMLElement): void {
    // Navigate up to the header row to find the right-side container
    // Structure: header row > [left(back), center(title), right(empty)]
    // backBtn is inside the left container. Go up to the header row.
    let headerRow: HTMLElement | null = backBtn;
    for (let i = 0; i < 6; i++) {
      headerRow = headerRow?.parentElement || null;
      if (!headerRow) return;
      // The header row has 3 children (left, center, right)
      if (headerRow.children.length === 3) break;
    }
    if (!headerRow || headerRow.children.length < 3) return;

    const rightContainer = headerRow.children[2] as HTMLElement;
    if (!rightContainer) return;

    // Find the inner flex div (the empty one)
    const innerDiv = rightContainer.querySelector('div') as HTMLElement;
    if (!innerDiv) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bnbot-rewrite-btn';
    btn.style.cssText = 'cursor: pointer; background-color: transparent; border: 1px solid rgb(207, 217, 222); border-radius: 9999px; padding: 6px 12px; display: inline-flex; align-items: center; justify-content: center;';
    btn.innerHTML = `
      <div style="display: flex; align-items: center; gap: 4px; line-height: 1;">
        <img src="${chrome.runtime?.getURL?.('assets/images/bnbot-rounded-logo-5.png') || ''}" style="width:14px;height:14px;border-radius:50%;flex-shrink:0;" />
        <span style="font-size: 13px; font-weight: 700; color: rgb(15, 20, 25); line-height: 1;">二创</span>
      </div>
    `;
    btn.title = 'AI Rewrite';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const match = window.location.pathname.match(/\/status\/(\d+)/);
      const tweetId = match?.[1];
      if (tweetId) {
        window.dispatchEvent(
          new CustomEvent('bnbot-analyze-tweet', { detail: { tweetId, action: 'rewrite' } })
        );
      }
    });

    innerDiv.appendChild(btn);
  }

  private async handleInlineAIReply(aiBtn: HTMLElement, replyBtn: HTMLElement): Promise<void> {
    // Check login
    const user = await authService.getUser();
    if (!user) {
      window.dispatchEvent(new CustomEvent('bnbot-analyze-tweet', { detail: { tweetId: '', action: 'login' } }));
      return;
    }

    // Scrape tweet content from the page
    const mainTweet = document.querySelector('article[data-testid="tweet"]');
    const tweetText = mainTweet?.querySelector('[data-testid="tweetText"]')?.textContent || '';
    const authorName = mainTweet?.querySelector('[data-testid="User-Name"]')?.textContent || '';

    if (!tweetText) {
      console.warn('[AnalyzeButtonInjector] Could not scrape tweet text');
      return;
    }

    // Show loading spinner inside the button
    const originalHTML = aiBtn.innerHTML;
    // Inject spinner keyframe if not present
    if (!document.getElementById('bnbot-spin-style')) {
      const style = document.createElement('style');
      style.id = 'bnbot-spin-style';
      style.textContent = '@keyframes bnbot-spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }
    // Replace button content with spinner, keeping same dimensions
    // Keep logo, replace "回复" text with spinner, add padding to maintain width
    const textSpan = aiBtn.querySelector('span span') as HTMLElement;
    if (textSpan) {
      const spinner = document.createElement('div');
      spinner.style.cssText = 'width:14px;height:14px;border:2px solid rgba(0,0,0,0.15);border-top-color:rgb(15,20,25);border-radius:50%;animation:bnbot-spin 0.6s linear infinite;flex-shrink:0;';
      textSpan.parentElement!.replaceWith(spinner);
    }
    // Add padding to compensate for shorter content
    aiBtn.style.paddingLeft = '12px';
    aiBtn.style.paddingRight = '12px';
    (aiBtn as HTMLButtonElement).disabled = true;

    // Find the textarea
    const textarea = document.querySelector('[data-testid="tweetTextarea_0"]') as HTMLElement;
    if (!textarea) {
      aiBtn.innerHTML = originalHTML;
      (aiBtn as HTMLButtonElement).disabled = false;
      return;
    }

    // Focus the textarea
    textarea.focus();

    // Build prompt
    const lang = localStorage.getItem('bnbot-language') || 'en';
    const isZh = lang === 'zh';
    const prompt = isZh
      ? `你是一个社交媒体回复助手。请根据以下推文生成一条简短、有趣且有见解的回复。只输出回复内容，不要任何前缀或解释。\n\n推文作者：${authorName}\n推文内容：${tweetText}`
      : `You are a social media reply assistant. Generate a short, witty, and insightful reply to the following tweet. Output ONLY the reply text, no prefix or explanation.\n\nAuthor: ${authorName}\nTweet: ${tweetText}`;

    let replyText = '';

    try {
      await chatService.sendChatV2Stream(prompt, (chunk) => {
        replyText += chunk;
        // Update textarea content in real-time
        this.fillTextarea(textarea, replyText);
      });
    } catch (err) {
      console.error('[AnalyzeButtonInjector] AI reply error:', err);
    } finally {
      // Restore button to original
      aiBtn.innerHTML = originalHTML;
      (aiBtn as HTMLButtonElement).disabled = false;
    }
  }

  private fillTextarea(textarea: HTMLElement, content: string): void {
    textarea.focus();
    // Select all and replace
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, content);
  }

  private createButton(tweetId: string): HTMLElement {
    // Match Grok wrapper structure: div.r-18u37iz.r-1h0z5md > button
    const wrapper = document.createElement('div');
    wrapper.className = 'bnbot-analyze-btn css-175oi2r r-18u37iz r-1h0z5md';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'css-175oi2r r-1777fci r-bt1l66 r-bztko3 r-lrvibr r-1loqt21 r-1ny4l3l';
    button.style.cursor = 'pointer';
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', 'BNBot Analyze');

    button.innerHTML = `
      <div dir="ltr" class="css-146c3p1 r-bcqeeo r-1ttztb7 r-qvutc0 r-37j5jr r-a023e6 r-rjixqe r-16dba41 r-1awozwy r-6koalj r-1h0z5md r-o7ynqc r-clp7b1 r-3s2u2q" style="color: rgb(250, 204, 21);">
        <div class="css-175oi2r r-xoduu5">
          <div class="bnbot-analyze-hover css-175oi2r r-xoduu5 r-1p0dtai r-1d2f490 r-u8s1d r-zchlnj r-ipm5af r-1niwhzg r-sdzlij r-xf4iuw r-o7ynqc r-6416eg r-1ny4l3l" style="transition: background-color 0.2s;"></div>
          <img src="${chrome.runtime?.getURL?.('assets/images/bnbot-rounded-logo-5.png') || ''}" style="width:20px;height:20px;border-radius:50%;" />
        </div>
      </div>
    `;

    const hoverCircle = button.querySelector('.bnbot-analyze-hover') as HTMLElement;
    if (hoverCircle) {
      button.addEventListener('mouseenter', () => {
        hoverCircle.style.backgroundColor = 'rgba(250, 204, 21, 0.15)';
      });
      button.addEventListener('mouseleave', () => {
        hoverCircle.style.backgroundColor = 'transparent';
      });
    }

    button.title = 'BNBot Analyze';

    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent('bnbot-analyze-tweet', { detail: { tweetId, action: 'analyze' } })
      );
    });

    wrapper.appendChild(button);
    return wrapper;
  }
}
