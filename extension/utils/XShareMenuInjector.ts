import { scrapeTweet } from '../services/actions/scrapeActions';
import { TwitterClient } from './TwitterClient';
import type { TweetDetailCaptureTweet } from './TwitterClient';

const MENU_SELECTOR = '[role="menu"]';
const TWEET_SELECTOR = 'article[data-testid="tweet"]';
const SHARE_BUTTON_SELECTOR = [
  'button[aria-haspopup="menu"][aria-label*="Share" i]',
  'button[aria-haspopup="menu"][aria-label*="分享"]',
].join(',');
const INJECTED_ATTR = 'data-bnbot-remix-item';
const STYLE_ID = 'bnbot-share-menu-style';
const NOTICE_ID = 'bnbot-share-menu-notice';

type BnbotIntent = 'quote' | 'remix';

const MENU_LABELS: Record<BnbotIntent, { zh: string; en: string }> = {
  quote: { zh: 'AI 引用', en: 'AI Quote' },
  remix: { zh: 'AI 创作', en: 'AI Remix' },
};

type XMedia = { type: 'photo' | 'video' | 'gif'; url: string; alt?: string; thumbnail?: string };

interface ChromeRuntimeLike {
  sendMessage?: (
    message: unknown,
    callback?: (response: { ok?: boolean; error?: string } | undefined) => void,
  ) => void;
  lastError?: { message?: string };
}

function getChromeRuntime(): ChromeRuntimeLike | null {
  const runtime = (globalThis as unknown as {
    chrome?: { runtime?: ChromeRuntimeLike };
  }).chrome?.runtime;
  return typeof runtime?.sendMessage === 'function' ? runtime : null;
}

interface XRelatedTweet {
  tweetId: string;
  tweetUrl: string;
  authorHandle: string;
  authorName: string;
  authorAvatar?: string;
  content: string;
  timestamp: string;
  metrics?: {
    replies: number;
    retweets: number;
    quotes?: number;
    likes: number;
    views: number;
    bookmarks?: number;
  };
  media: XMedia[];
}

interface XViewerCapture {
  /** Currently logged-in X account `@handle` (no leading @, lowercase).
   *  Empty string when DOM detection fails. */
  handle: string;
  /** Display name pulled from the SideNav account switcher button.
   *  Empty when not parseable. */
  name: string;
  /** Avatar URL — usually pbs.twimg.com profile_images path. Empty
   *  when no img found. */
  avatar: string;
}

interface XSourceCapture {
  source: 'x';
  capturedAt: string;
  pageUrl: string;
  tweetId: string;
  tweetUrl: string;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
  /** Whether the source-tweet author shows the blue/verified badge on
   *  X. Captured by the scraper and propagated through to the desktop
   *  so embedded quote cards can render the checkmark. */
  authorVerified: boolean;
  content: string;
  timestamp: string;
  metrics: {
    replies: number;
    retweets: number;
    likes: number;
    views: number;
  };
  media: XMedia[];
  urls: Array<{ url: string; text: string }>;
  cards: Array<{ url: string; title: string; description: string }>;
  quotedTweets: XRelatedTweet[];
  threadTweets: XRelatedTweet[];
  lang: string;
  visibleText: string;
  apiEnriched: boolean;
  apiError?: string;
  promoted: boolean;
  /** Currently logged-in X account viewing the page. Captured at the
   *  moment the share menu opens so the desktop knows whose voice to
   *  draft in / which account will receive the publish. */
  viewer: XViewerCapture;
}

export class XShareMenuInjector {
  private observer: MutationObserver | null = null;
  private lastCapture: XSourceCapture | null = null;
  private pointerListener: ((event: PointerEvent) => void) | null = null;

  start(): void {
    if (this.pointerListener) return;
    this.ensureStyles();

    this.pointerListener = (event: PointerEvent) => {
      const target = event.target as Element | null;
      const button = target?.closest?.(SHARE_BUTTON_SELECTOR) as HTMLElement | null;
      if (!button) return;
      const article = button.closest(TWEET_SELECTOR) as HTMLElement | null;
      if (!article) return;
      this.lastCapture = this.captureTweet(article);
      window.setTimeout(() => this.injectOpenMenus(), 0);
      window.setTimeout(() => this.injectOpenMenus(), 120);
    };

    document.addEventListener('pointerdown', this.pointerListener, true);
    this.observer = new MutationObserver(() => this.injectOpenMenus());
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  stop(): void {
    if (this.pointerListener) {
      document.removeEventListener('pointerdown', this.pointerListener, true);
      this.pointerListener = null;
    }
    this.observer?.disconnect();
    this.observer = null;
  }

  private injectOpenMenus(): void {
    const capture = this.lastCapture;
    if (!capture) return;
    const menus = Array.from(document.querySelectorAll(MENU_SELECTOR));
    for (const menu of menus) {
      if (!(menu instanceof HTMLElement)) continue;
      if (menu.querySelector(`[${INJECTED_ATTR}="true"]`)) continue;
      if (!this.looksLikeShareMenu(menu)) continue;
      // Two items: Quote first (drafts a tweet that embeds the original),
      // Remix second (rewrites the source as a fresh standalone tweet).
      // Order matters — Quote is the lower-commitment action that users
      // reach for first when they want to react vs. fully repurpose.
      this.injectMenuItem(menu, capture, 'quote');
      this.injectMenuItem(menu, capture, 'remix');
    }
  }

  private looksLikeShareMenu(menu: HTMLElement): boolean {
    const text = menu.textContent || '';
    return (
      text.includes('复制链接') ||
      text.includes('Copy link') ||
      text.includes('通过聊天发送') ||
      text.includes('Send via Direct Message') ||
      text.includes('Share post')
    );
  }

  private injectMenuItem(menu: HTMLElement, capture: XSourceCapture, intent: BnbotIntent): void {
    const dropdown = menu.querySelector('[data-testid="Dropdown"]') || menu.firstElementChild || menu;
    const firstItem = dropdown.querySelector('[role="menuitem"]') as HTMLElement | null;
    if (!firstItem) return;
    // When injecting the 2nd item (remix), `firstItem` is still X's own
    // "Copy link" — we want our new item placed AFTER any already-injected
    // BNBot items so the visual order matches the inject sequence
    // (Quote first, Remix second).
    let anchor: HTMLElement = firstItem;
    let sibling: Element | null = firstItem.nextElementSibling;
    while (sibling) {
      if (sibling instanceof HTMLElement && sibling.getAttribute(INJECTED_ATTR) === 'true') {
        anchor = sibling;
        sibling = sibling.nextElementSibling;
        continue;
      }
      break;
    }

    const item = firstItem.cloneNode(true) as HTMLElement;
    item.setAttribute(INJECTED_ATTR, 'true');
    item.classList.add('bnbot-share-menu-item');
    item.classList.add(`bnbot-share-menu-item-${intent}`);
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '0');
    item.removeAttribute('data-testid');
    const locale = this.detectMenuLocale(menu);
    item.dataset.bnbotLocale = locale;
    item.dataset.bnbotIntent = intent;
    item.setAttribute(
      'aria-label',
      locale === 'en' ? MENU_LABELS[intent].en : MENU_LABELS[intent].zh,
    );

    this.setMenuItemState(item, 'idle');

    let sending = false;
    const send = async () => {
      if (sending) return;
      sending = true;
      this.setMenuItemState(item, 'sending');
      try {
        const payload = await this.enrichWithTweetDetail(capture);
        const runtime = getChromeRuntime();
        if (!runtime) {
          sending = false;
          this.setMenuItemState(item, 'idle');
          this.showNotice('扩展连接已断开，请刷新 X 页面后重试', 'error');
          return;
        }
        runtime.sendMessage(
          { type: 'BNBOT_SOURCE_CAPTURE', payload: { ...payload, intent } },
          (response: { ok?: boolean; error?: string } | undefined) => {
            const lastError = runtime.lastError;
            if (lastError) {
              sending = false;
              this.setMenuItemState(item, 'idle');
              this.showNotice(this.normalizeSendError(lastError.message), 'error');
              return;
            }
            if (response?.ok) {
              this.setMenuItemState(item, 'done');
              window.setTimeout(() => this.closeMenu(menu), 700);
              return;
            }
            sending = false;
            this.setMenuItemState(item, 'idle');
            this.showNotice(this.normalizeSendError(response?.error), 'error');
          },
        );
      } catch (error) {
        sending = false;
        this.setMenuItemState(item, 'idle');
        this.showNotice(this.normalizeSendError(error instanceof Error ? error.message : String(error)), 'error');
      }
    };

    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void send();
    });
    item.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      void send();
    });

    anchor.parentElement?.insertBefore(item, anchor.nextSibling);
  }

  private ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [${INJECTED_ATTR}="true"].bnbot-share-menu-item {
        transition: background-color 140ms ease;
      }
      [${INJECTED_ATTR}="true"].bnbot-share-menu-item:hover,
      [${INJECTED_ATTR}="true"].bnbot-share-menu-item:focus-visible {
        background: rgba(0, 0, 0, 0.03);
      }
      [${INJECTED_ATTR}="true"].bnbot-share-menu-item.bnbot-remix-sending {
        pointer-events: none;
      }
      [${INJECTED_ATTR}="true"].bnbot-share-menu-item .bnbot-remix-spinner {
        transform-origin: 12px 12px;
        animation: bnbot-remix-spin 720ms linear infinite;
      }
      #${NOTICE_ID} {
        position: fixed;
        top: 18px;
        right: 18px;
        z-index: 2147483647;
        max-width: min(360px, calc(100vw - 32px));
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(15, 23, 42, 0.96);
        color: #fff;
        box-shadow: 0 18px 44px rgba(15, 23, 42, 0.24);
        font-size: 15px;
        font-weight: 700;
        line-height: 1.35;
        opacity: 0;
        transform: translateY(-8px);
        transition: opacity 160ms ease, transform 160ms ease;
        pointer-events: none;
      }
      #${NOTICE_ID}.bnbot-share-notice-visible {
        opacity: 1;
        transform: translateY(0);
      }
      @keyframes bnbot-remix-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.documentElement.appendChild(style);
  }

  private setMenuItemState(
    item: HTMLElement,
    state: 'idle' | 'sending' | 'done' | 'error',
    message?: string,
  ): void {
    item.classList.toggle('bnbot-remix-sending', state === 'sending');
    item.classList.toggle('bnbot-remix-done', state === 'done');
    item.classList.toggle('bnbot-remix-error', state === 'error');

    const label = item.querySelector('span');
    const locale = item.dataset.bnbotLocale === 'en' ? 'en' : 'zh';
    const intent: BnbotIntent = item.dataset.bnbotIntent === 'remix' ? 'remix' : 'quote';
    const idleText = locale === 'en' ? MENU_LABELS[intent].en : MENU_LABELS[intent].zh;
    const text =
      state === 'sending' ? (locale === 'en' ? 'Sending...' : '发送中...')
        : state === 'done' ? (locale === 'en' ? 'Sent' : '发送成功')
          : state === 'error' ? message || '发送失败'
            : idleText;
    if (label) label.textContent = text;
    else item.textContent = text;

    const svg = item.querySelector('svg');
    if (!svg) return;
    if (state === 'sending') {
      svg.innerHTML = '<g class="bnbot-remix-spinner"><path d="M12 3a9 9 0 1 1-8.2 5.3" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"></path></g>';
      return;
    }
    if (state === 'done') {
      svg.innerHTML = '<g><path d="M5 12.5l4.2 4.2L19.5 6.4" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"></path></g>';
      return;
    }
    if (state === 'error') {
      svg.innerHTML = '<g><path d="M12 4v9" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"></path><path d="M12 19h.01" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"></path></g>';
      return;
    }
    // Idle icons lifted verbatim from X's own repost dropdown so the
    // two BNBot rows render pixel-identical to the native 引用 / 转帖
    // items. Don't simplify these paths — the curve commands match X's
    // exported SVG character-for-character.
    if (intent === 'quote') {
      svg.innerHTML = '<g><path clip-rule="evenodd" d="M13.543 4.04275C15.3142 2.27164 18.1858 2.27164 19.957 4.04275C21.7282 5.81396 21.7282 8.68558 19.957 10.4568L11.2314 19.1834C10.4044 20.0104 9.31319 20.5208 8.14844 20.6267L2.89551 21.1043L3.37305 15.8513C3.47901 14.6866 3.99039 13.5953 4.81738 12.7683L13.543 4.04275ZM6.23145 14.1824C5.73525 14.6786 5.42881 15.3341 5.36523 16.033L5.10449 18.8943L7.9668 18.6346C8.66565 18.571 9.32019 18.2645 9.81641 17.7683L16.585 10.9988L13 7.41385L6.23145 14.1824ZM18.543 5.45682C17.5528 4.46675 15.9472 4.46675 14.957 5.45682L14.4141 5.99979L17.999 9.58475L18.543 9.04275C19.5331 8.05257 19.5331 6.44698 18.543 5.45682Z" fill-rule="evenodd"></path><path d="M21 20.9998H12.207C12.3582 20.8723 12.5047 20.7382 12.6455 20.5974L14.2432 18.9998H21V20.9998Z"></path></g>';
      return;
    }
    // Remix = AI rewrite, not retweet. Sparkles is the established "AI
    // generation" glyph across X (Grok), Anthropic, Apple Intelligence
    // etc. — using X's retweet arrows here would falsely suggest
    // "repost", which is exactly what AI Remix is NOT.
    svg.innerHTML = '<g><path d="M9 2.5l1.85 4.65L15.5 9l-4.65 1.85L9 15.5l-1.85-4.65L2.5 9l4.65-1.85L9 2.5zm9 9l1.1 2.4 2.4 1.1-2.4 1.1-1.1 2.4-1.1-2.4-2.4-1.1 2.4-1.1L18 11.5zm-3.5-1l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5z" fill="currentColor"></path></g>';
  }

  private normalizeSendError(message?: string): string {
    const text = message || '发送失败';
    if (/extension context invalidated/i.test(text)) return '扩展已重载，请刷新 X 页面后重试';
    if (/could not establish connection|receiving end does not exist/i.test(text)) return '扩展连接已断开，请刷新 X 页面后重试';
    if (/failed to fetch|network/i.test(text)) return 'BNBot 未连接，请确认桌面端已启动';
    return text;
  }

  private detectMenuLocale(menu: HTMLElement): 'zh' | 'en' {
    const text = menu.textContent || '';
    if (/Copy link|Send via Direct Message|Share post/i.test(text)) return 'en';
    return 'zh';
  }

  private showNotice(message: string, type: 'error' | 'success' = 'error'): void {
    let notice = document.getElementById(NOTICE_ID);
    if (!notice) {
      notice = document.createElement('div');
      notice.id = NOTICE_ID;
      document.body.appendChild(notice);
    }
    notice.textContent = message;
    notice.style.background = type === 'success' ? 'rgba(17, 24, 39, 0.96)' : 'rgba(15, 23, 42, 0.96)';
    notice.classList.add('bnbot-share-notice-visible');
    window.setTimeout(() => {
      notice?.classList.remove('bnbot-share-notice-visible');
    }, 3200);
  }

  private captureTweet(article: HTMLElement): XSourceCapture {
    const scraped = scrapeTweet(article);
    const tweetId = scraped?.tweetId || this.extractTweetId(article);
    const tweetUrl = this.extractTweetUrl(article, tweetId, scraped?.authorHandle || '');
    const socialContext = article.querySelector('[data-testid="socialContext"]')?.textContent || '';
    const fullText = article.textContent || '';

    return {
      source: 'x',
      capturedAt: new Date().toISOString(),
      pageUrl: window.location.href,
      tweetId,
      tweetUrl,
      authorHandle: scraped?.authorHandle || '',
      authorName: scraped?.authorName || '',
      authorAvatar: scraped?.authorAvatar || '',
      authorVerified: Boolean(scraped?.authorVerified),
      content: scraped?.content || article.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || '',
      timestamp: scraped?.timestamp || new Date().toISOString(),
      metrics: scraped?.metrics || { replies: 0, retweets: 0, likes: 0, views: 0 },
      media: this.enrichMedia(article, scraped?.media || []),
      urls: this.extractLinks(article),
      cards: this.extractCards(article),
      quotedTweets: this.extractQuotedTweets(article),
      threadTweets: [],
      lang: article.querySelector('[lang]')?.getAttribute('lang') || '',
      visibleText: this.compactText(article.textContent || ''),
      apiEnriched: false,
      promoted: /promoted|广告|推广/i.test(socialContext) || /promoted|广告|推广/i.test(fullText.slice(0, 160)),
      viewer: this.captureCurrentUser(),
    };
  }

  /** Read the currently logged-in X user from the SideNav account
   *  switcher. Mirrors TimelineScroller.resolveCurrentUser but also
   *  picks up display name + avatar so the desktop has the full
   *  identity (not just @handle). Falls back to a profile-link probe
   *  when the SideNav isn't mounted (e.g. mobile breakpoint). */
  private captureCurrentUser(): XViewerCapture {
    const empty: XViewerCapture = { handle: '', name: '', avatar: '' };
    const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (switcher instanceof HTMLElement) {
      const text = switcher.textContent || '';
      const handleMatch = text.match(/@([A-Za-z0-9_]+)/);
      const handle = handleMatch ? handleMatch[1].toLowerCase() : '';
      // Display name = textContent with the @handle suffix peeled off.
      const name = handleMatch
        ? text.slice(0, handleMatch.index ?? text.length).trim()
        : text.trim();
      const avatarImg = switcher.querySelector('img');
      const avatar = avatarImg instanceof HTMLImageElement ? avatarImg.src : '';
      if (handle || name) return { handle, name, avatar };
    }
    // Fallback: profile link in the side nav. Provides handle from the
    // href and avatar from the nested img, but no name.
    const profileLink = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    if (profileLink instanceof HTMLAnchorElement) {
      const href = profileLink.getAttribute('href') || '';
      const handle = href.startsWith('/') ? href.slice(1).split('/')[0].toLowerCase() : '';
      const avatarImg = profileLink.querySelector('img');
      const avatar = avatarImg instanceof HTMLImageElement ? avatarImg.src : '';
      if (handle) return { handle, name: '', avatar };
    }
    return empty;
  }

  private async enrichWithTweetDetail(capture: XSourceCapture): Promise<XSourceCapture> {
    if (!capture.tweetId) return capture;
    try {
      const detail = await TwitterClient.fetchTweetDetailCapture(capture.tweetId);
      if (!detail) return capture;
      const main = detail.mainTweet;
      const quoted = main.quotedTweet ? [this.fromApiTweet(main.quotedTweet)] : [];
      return {
        ...capture,
        tweetUrl: main.url || capture.tweetUrl,
        authorHandle: main.author.handle || capture.authorHandle,
        authorName: main.author.name || capture.authorName,
        authorAvatar: main.author.avatar || capture.authorAvatar,
        // Trust the API's verified flag when present — it's authoritative
        // (GraphQL `is_blue_verified` / `verification.verified`). Fall
        // back to the DOM-scraped flag otherwise.
        authorVerified: typeof main.author.verified === 'boolean'
          ? main.author.verified
          : capture.authorVerified,
        content: main.text || capture.content,
        timestamp: main.createdAt || capture.timestamp,
        metrics: {
          replies: main.metrics.replies,
          retweets: main.metrics.retweets,
          likes: main.metrics.likes,
          views: main.metrics.views,
        },
        media: main.media.length ? this.mediaFromApi(main.media) : capture.media,
        urls: this.mergeLinks(
          capture.urls,
          main.urls.map((url) => ({ url: url.expandedUrl || url.url, text: url.displayUrl || url.url })),
        ),
        quotedTweets: this.mergeRelatedTweets(quoted, capture.quotedTweets),
        threadTweets: detail.threadTweets.slice(0, 12).map((tweet) => this.fromApiTweet(tweet)),
        lang: main.lang || capture.lang,
        apiEnriched: true,
      };
    } catch (error) {
      return {
        ...capture,
        apiError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private fromApiTweet(tweet: TweetDetailCaptureTweet): XRelatedTweet {
    return {
      tweetId: tweet.id,
      tweetUrl: tweet.url,
      authorHandle: tweet.author.handle,
      authorName: tweet.author.name,
      authorAvatar: tweet.author.avatar,
      content: tweet.text,
      timestamp: tweet.createdAt,
      metrics: tweet.metrics,
      media: this.mediaFromApi(tweet.media),
    };
  }

  private mediaFromApi(media: TweetDetailCaptureTweet['media']): XMedia[] {
    return media.map((item) => ({
      type: item.type,
      url: item.url,
      alt: item.alt,
      thumbnail: item.thumbnail,
    })).filter((item) => item.url);
  }

  private mergeLinks(
    primary: Array<{ url: string; text: string }>,
    secondary: Array<{ url: string; text: string }>,
  ): Array<{ url: string; text: string }> {
    return [...primary, ...secondary]
      .filter((link) => link.url)
      .filter((link, index, all) => all.findIndex((item) => item.url === link.url) === index)
      .slice(0, 32);
  }

  private mergeRelatedTweets(primary: XRelatedTweet[], secondary: XRelatedTweet[]): XRelatedTweet[] {
    return [...primary, ...secondary]
      .filter((tweet) => tweet.content || tweet.tweetUrl)
      .filter((tweet, index, all) => all.findIndex((item) => item.tweetId && item.tweetId === tweet.tweetId) === index)
      .slice(0, 8);
  }

  private enrichMedia(
    article: HTMLElement,
    media: Array<{ type: 'photo' | 'video'; url: string }>,
  ): XMedia[] {
    return media.map((item) => {
      const img = Array.from(article.querySelectorAll('img')).find((candidate) => candidate.src === item.url);
      return img?.alt ? { ...item, alt: img.alt } : item;
    });
  }

  private extractLinks(article: HTMLElement): Array<{ url: string; text: string }> {
    const links = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .map((link) => {
        const href = link.getAttribute('href') || '';
        if (!href || href.startsWith('#')) return null;
        const url = new URL(href, window.location.origin).href;
        return { url, text: this.compactText(link.textContent || '') };
      })
      .filter((link): link is { url: string; text: string } => Boolean(link));
    return links.filter((link, index, all) => all.findIndex((item) => item.url === link.url) === index).slice(0, 24);
  }

  private extractCards(article: HTMLElement): Array<{ url: string; title: string; description: string }> {
    const cards = Array.from(article.querySelectorAll<HTMLElement>('[data-testid="card.wrapper"]'));
    return cards.map((card) => {
      const link = card.querySelector<HTMLAnchorElement>('a[href]');
      const spans = Array.from(card.querySelectorAll('span'))
        .map((span) => this.compactText(span.textContent || ''))
        .filter(Boolean);
      const title = spans.find((text) => text.length > 8) || spans[0] || '';
      const description = spans.filter((text) => text !== title).slice(0, 3).join(' · ');
      return {
        url: link?.href || '',
        title,
        description,
      };
    }).filter((card) => card.url || card.title).slice(0, 4);
  }

  private extractQuotedTweets(article: HTMLElement): XSourceCapture['quotedTweets'] {
    const nested = Array.from(article.querySelectorAll<HTMLElement>(TWEET_SELECTOR))
      .filter((candidate) => candidate !== article);
    return nested.map((tweet) => {
      const scraped = scrapeTweet(tweet);
      const tweetId = scraped?.tweetId || this.extractTweetId(tweet);
      return {
        tweetId,
        tweetUrl: this.extractTweetUrl(tweet, tweetId, scraped?.authorHandle || ''),
        authorHandle: scraped?.authorHandle || '',
        authorName: scraped?.authorName || '',
        content: scraped?.content || tweet.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || '',
        timestamp: scraped?.timestamp || '',
        media: this.enrichMedia(tweet, scraped?.media || []),
      };
    }).filter((tweet) => tweet.content || tweet.tweetUrl).slice(0, 3);
  }

  private compactText(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, 12000);
  }

  private extractTweetId(article: HTMLElement): string {
    const href = article.querySelector('a[href*="/status/"]')?.getAttribute('href') || '';
    return href.match(/\/status\/(\d+)/)?.[1] || '';
  }

  private extractTweetUrl(article: HTMLElement, tweetId: string, authorHandle: string): string {
    const timeLink = article.querySelector('a[href*="/status/"] time')?.parentElement as HTMLAnchorElement | null;
    if (timeLink?.href) return timeLink.href;
    const href = article.querySelector('a[href*="/status/"]')?.getAttribute('href');
    if (href) return new URL(href, window.location.origin).href;
    if (tweetId && authorHandle) return `https://x.com/${authorHandle}/status/${tweetId}`;
    if (tweetId) return `https://x.com/i/status/${tweetId}`;
    return window.location.href;
  }

  private closeMenu(menu?: HTMLElement): void {
    const root = menu?.closest('[role="menu"]') as HTMLElement | null;
    const wrapper = root?.parentElement as HTMLElement | null;
    if (root) {
      root.style.display = 'none';
      root.setAttribute('aria-hidden', 'true');
    }
    window.setTimeout(() => {
      wrapper?.remove();
    }, 0);
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
    } as KeyboardEventInit));
    document.body.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
  }

}
