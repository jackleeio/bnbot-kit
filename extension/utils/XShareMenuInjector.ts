import { scrapeTweet } from '../services/actions/scrapeActions';
import { TwitterClient } from './TwitterClient';
import type { TweetDetailCaptureTweet } from './TwitterClient';

declare const chrome: any;

const MENU_SELECTOR = '[role="menu"]';
const TWEET_SELECTOR = 'article[data-testid="tweet"]';
const SHARE_BUTTON_SELECTOR = [
  'button[aria-haspopup="menu"][aria-label*="Share" i]',
  'button[aria-haspopup="menu"][aria-label*="分享"]',
].join(',');
const INJECTED_ATTR = 'data-bnbot-remix-item';
const STYLE_ID = 'bnbot-share-menu-style';
const NOTICE_ID = 'bnbot-share-menu-notice';
const MENU_LABEL = '发送到BNBot';
const MENU_LABEL_EN = 'Send to BNBot';

type XMedia = { type: 'photo' | 'video' | 'gif'; url: string; alt?: string; thumbnail?: string };

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

interface XSourceCapture {
  source: 'x';
  capturedAt: string;
  pageUrl: string;
  tweetId: string;
  tweetUrl: string;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
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
      this.injectMenuItem(menu, capture);
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

  private injectMenuItem(menu: HTMLElement, capture: XSourceCapture): void {
    const dropdown = menu.querySelector('[data-testid="Dropdown"]') || menu.firstElementChild || menu;
    const firstItem = dropdown.querySelector('[role="menuitem"]') as HTMLElement | null;
    if (!firstItem) return;

    const item = firstItem.cloneNode(true) as HTMLElement;
    item.setAttribute(INJECTED_ATTR, 'true');
    item.classList.add('bnbot-share-menu-item');
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '0');
    item.removeAttribute('data-testid');
    const locale = this.detectMenuLocale(menu);
    item.dataset.bnbotLocale = locale;
    item.setAttribute('aria-label', locale === 'en' ? MENU_LABEL_EN : MENU_LABEL);

    this.setMenuItemState(item, 'idle');

    let sending = false;
    const send = async () => {
      if (sending) return;
      sending = true;
      this.setMenuItemState(item, 'sending');
      try {
        const payload = await this.enrichWithTweetDetail(capture);
        chrome.runtime.sendMessage(
          { type: 'BNBOT_SOURCE_CAPTURE', payload },
          (response: { ok?: boolean; error?: string } | undefined) => {
            if (chrome.runtime?.lastError) {
              sending = false;
              this.setMenuItemState(item, 'idle');
              this.showNotice(this.normalizeSendError(chrome.runtime.lastError.message), 'error');
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

    firstItem.parentElement?.insertBefore(item, firstItem.nextSibling);
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
    const text =
      state === 'sending' ? (locale === 'en' ? 'Sending...' : '发送中...')
        : state === 'done' ? (locale === 'en' ? 'Sent to BNBot' : '已发送到BNBot')
          : state === 'error' ? message || '发送失败'
            : locale === 'en' ? MENU_LABEL_EN : MENU_LABEL;
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
    svg.innerHTML = '<g><path d="M12 3l1.75 4.35L18 9l-4.25 1.65L12 15l-1.75-4.35L6 9l4.25-1.65L12 3zm6.6 11.2l.85 2.05L21.5 17l-2.05.75-.85 2.05-.85-2.05L15.7 17l2.05-.75.85-2.05zM5.4 14.2l.85 2.05L8.3 17l-2.05.75-.85 2.05-.85-2.05L2.5 17l2.05-.75.85-2.05z"></path></g>';
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
    };
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
