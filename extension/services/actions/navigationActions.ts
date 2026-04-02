/**
 * Navigation Action Handlers
 * 导航类 Action 处理器
 */

import { ActionHandler, ActionResult } from '../../types/action';
import { HumanBehaviorSimulator } from '../../utils/HumanBehaviorSimulator';

/**
 * SPA 导航辅助函数
 */
function navigateToUrl(url: string): void {
  const fullUrl = url.startsWith('http') ? url : `https://x.com${url.startsWith('/') ? '' : '/'}${url}`;
  window.history.pushState({}, '', fullUrl);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * 等待导航完成
 */
async function waitForNavigation(pathContains: string, timeout: number = 10000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (window.location.href.includes(pathContains)) {
      return true;
    }
    await HumanBehaviorSimulator.randomDelay(200, 300);
  }
  return false;
}

/**
 * 导航到推文详情页
 */
export const navigateToTweetHandler: ActionHandler = async (params, callbacks) => {
  const { tweetUrl } = params as { tweetUrl: string };
  callbacks.onProgress?.({} as any, '正在导航到推文...');

  if (!tweetUrl) {
    return { success: false, error: '缺少推文 URL' };
  }

  // 提取推文 ID
  const idMatch = tweetUrl.match(/\/status\/(\d+)/);
  if (!idMatch) {
    return { success: false, error: '无效的推文 URL' };
  }

  const tweetId = idMatch[1];

  // 如果已经在目标页面
  if (window.location.href.includes(`/status/${tweetId}`)) {
    return { success: true, data: { tweetId, alreadyThere: true } };
  }

  // 执行导航
  navigateToUrl(tweetUrl);
  await HumanBehaviorSimulator.randomDelay(2000, 3000);

  const success = await waitForNavigation(`/status/${tweetId}`);
  if (!success) {
    return { success: false, error: '导航超时' };
  }

  return { success: true, data: { tweetId } };
};

/**
 * 导航到任意 URL
 */
export const navigateToUrlHandler: ActionHandler = async (params, callbacks) => {
  const { url } = params as { url: string };
  callbacks.onProgress?.({} as any, '正在导航...');

  if (!url) {
    return { success: false, error: '缺少 URL' };
  }

  navigateToUrl(url);
  await HumanBehaviorSimulator.randomDelay(2000, 3000);

  return { success: true, data: { url: window.location.href } };
};

/**
 * 导航到书签页
 */
export const navigateToBookmarksHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在导航到书签...');

  const bookmarksPath = '/i/bookmarks';

  if (window.location.pathname.includes(bookmarksPath)) {
    return { success: true, data: { alreadyThere: true } };
  }

  navigateToUrl(bookmarksPath);
  await HumanBehaviorSimulator.randomDelay(2000, 3000);

  const success = await waitForNavigation(bookmarksPath);
  if (!success) {
    return { success: false, error: '导航到书签页超时' };
  }

  return { success: true };
};

/**
 * 导航到通知页
 */
export const navigateToNotificationsHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在导航到通知...');

  const notificationsPath = '/notifications';

  if (window.location.pathname.includes(notificationsPath)) {
    return { success: true, data: { alreadyThere: true } };
  }

  navigateToUrl(notificationsPath);
  await HumanBehaviorSimulator.randomDelay(2000, 3000);

  const success = await waitForNavigation(notificationsPath);
  if (!success) {
    return { success: false, error: '导航到通知页超时' };
  }

  return { success: true };
};

/**
 * 导航到搜索页
 */
export const navigateToSearchHandler: ActionHandler = async (params, callbacks) => {
  const { query, filters, sort, tab } = params as { query?: string; filters?: Record<string, unknown>; sort?: string; tab?: string };
  callbacks.onProgress?.({} as any, '正在导航到搜索...');

  let searchUrl = '/search';
  if (query) {
    searchUrl = `/search?q=${encodeURIComponent(query)}&src=typed_query`;
    // tab/sort parameter: live=Latest, user=People, image=Media, list=Lists
    const tabValue = tab || sort;
    if (tabValue) {
      searchUrl += `&f=${tabValue}`;
    }
  }

  navigateToUrl(searchUrl);
  await HumanBehaviorSimulator.randomDelay(2000, 3000);

  const success = await waitForNavigation('/search');
  if (!success) {
    return { success: false, error: '导航到搜索页超时' };
  }

  return { success: true, data: { query } };
};

/**
 * 返回时间线
 */
export const returnToTimelineHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在返回时间线...');

  // 方法 1: 点击返回按钮
  const backButton = document.querySelector('[data-testid="app-bar-back"]') as HTMLElement;
  if (backButton) {
    backButton.click();
    await HumanBehaviorSimulator.randomDelay(1000, 2000);
    return { success: true };
  }

  // 方法 2: 点击关闭按钮
  const closeButton = document.querySelector('[data-testid="app-bar-close"]') as HTMLElement;
  if (closeButton) {
    closeButton.click();
    await HumanBehaviorSimulator.randomDelay(1000, 2000);
    return { success: true };
  }

  // 方法 3: 使用 history.back()
  window.history.back();
  await HumanBehaviorSimulator.randomDelay(1000, 2000);

  return { success: true };
};

/**
 * 导航到 Grok
 */
export const navigateToGrokHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在导航到 Grok...');

  const grokPath = '/i/grok';

  if (window.location.pathname.includes(grokPath)) {
    return { success: true, data: { alreadyThere: true } };
  }

  navigateToUrl(grokPath);
  await HumanBehaviorSimulator.randomDelay(2000, 3000);

  const success = await waitForNavigation(grokPath);
  if (!success) {
    return { success: false, error: '导航到 Grok 超时' };
  }

  return { success: true };
};

/**
 * 导航到创作文章页
 */
export const navigateToComposeArticleHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在导航到创作文章...');

  const composePath = '/compose/articles';

  if (window.location.pathname.includes(composePath)) {
    return { success: true, data: { alreadyThere: true } };
  }

  navigateToUrl(composePath);
  await HumanBehaviorSimulator.randomDelay(2000, 3000);

  const success = await waitForNavigation(composePath);
  if (!success) {
    return { success: false, error: '导航到创作文章页超时' };
  }

  return { success: true };
};

/**
 * 从页面获取当前登录用户的用户名
 */
function getCurrentUsername(): string | null {
  // 方法 1: 从侧边栏账户切换按钮获取
  const accountSwitcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
  if (accountSwitcher) {
    // 查找 @username 格式的文本
    const spans = accountSwitcher.querySelectorAll('span');
    for (const span of spans) {
      const text = span.textContent?.trim();
      if (text && text.startsWith('@')) {
        return text.substring(1); // 去掉 @ 符号
      }
    }
  }

  // 方法 2: 从 URL 中获取（如果在个人主页）
  const pathMatch = window.location.pathname.match(/^\/([a-zA-Z0-9_]+)(?:\/|$)/);
  if (pathMatch && !['home', 'explore', 'search', 'notifications', 'messages', 'i', 'settings', 'compose'].includes(pathMatch[1])) {
    return pathMatch[1];
  }

  // 方法 3: 从页面中查找用户链接
  const profileLink = document.querySelector('a[href^="/"][data-testid="AppTabBar_Profile_Link"]');
  if (profileLink) {
    const href = profileLink.getAttribute('href');
    if (href) {
      return href.substring(1); // 去掉开头的 /
    }
  }

  return null;
}

/**
 * 导航到社群页
 */
export const navigateToCommunitiesHandler: ActionHandler = async (params, callbacks) => {
  let { username } = params as { username?: string };
  callbacks.onProgress?.({} as any, '正在导航到社群...');

  // 如果没有提供用户名，自动从页面获取
  if (!username) {
    username = getCurrentUsername() || undefined;
    if (!username) {
      return { success: false, error: '无法获取用户名，请确保已登录' };
    }
    console.log('[navigateToCommunitiesHandler] Auto-detected username:', username);
  }

  const communitiesPath = `/${username}/communities`;

  if (window.location.pathname.includes(communitiesPath)) {
    return { success: true, data: { alreadyThere: true, username } };
  }

  navigateToUrl(communitiesPath);
  await HumanBehaviorSimulator.randomDelay(2000, 3000);

  const success = await waitForNavigation('/communities');
  if (!success) {
    return { success: false, error: '导航到社群页超时' };
  }

  return { success: true, data: { username } };
};

/**
 * 切换到 Following 时间线
 * 先导航到 /home，再点击 "Following" tab
 */
export const navigateToFollowingHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在切换到 Following 时间线...');

  // 先确保在首页
  if (!window.location.pathname.startsWith('/home')) {
    navigateToUrl('/home');
    await HumanBehaviorSimulator.randomDelay(2000, 3000);
    const atHome = await waitForNavigation('/home');
    if (!atHome) {
      return { success: false, error: '导航到首页超时' };
    }
  }

  // 通过 ScrollSnap-List 查找 tab
  const tabList = document.querySelector('[data-testid="ScrollSnap-List"]');
  const tabs = tabList
    ? tabList.querySelectorAll('[role="tab"]')
    : document.querySelectorAll('[role="tab"]');

  for (const tab of tabs) {
    const text = tab.textContent?.trim();
    if (text === 'Following') {
      // 已经选中则直接返回
      if (tab.getAttribute('aria-selected') === 'true') {
        return { success: true, data: { alreadySelected: true } };
      }
      (tab as HTMLElement).click();
      await HumanBehaviorSimulator.randomDelay(500, 1000);
      // 验证选中状态
      if (tab.getAttribute('aria-selected') === 'true') {
        return { success: true };
      }
      await HumanBehaviorSimulator.randomDelay(500, 1000);
      return {
        success: true,
        data: { selected: tab.getAttribute('aria-selected') === 'true' },
      };
    }
  }

  return { success: false, error: '未找到 Following tab' };
};

/**
 * 获取当前页面 URL
 */
export const getCurrentUrlHandler: ActionHandler = async (_params, callbacks) => {
  callbacks.onProgress?.({} as any, '获取当前页面地址...');
  return {
    success: true,
    data: {
      url: window.location.href,
      pathname: window.location.pathname,
      title: document.title,
    }
  };
};

/**
 * 获取扩展状态
 */
export const getExtensionStatusHandler: ActionHandler = async (_params, callbacks) => {
  callbacks.onProgress?.({} as any, '获取扩展状态...');
  const manifest = chrome.runtime.getManifest();
  return {
    success: true,
    data: {
      version: manifest.version,
      name: manifest.name,
      url: window.location.href,
    }
  };
};

/**
 * 切换 Twitter 账号
 * 1. 点击 SideNav_AccountSwitcher_Button 打开账号菜单
 * 2. 在菜单中找到目标用户名对应的 UserCell 按钮并点击
 */
export const switchAccountHandler: ActionHandler = async (params, callbacks) => {
  const username = (params.username as string || '').replace(/^@/, '').toLowerCase();
  if (!username) {
    return { success: false, error: '请提供要切换的用户名 (username)' };
  }

  // 0. Check if already on the target account
  const current = getCurrentUsername()?.toLowerCase();
  if (current === username) {
    return { success: true, data: { switchedTo: username, alreadyActive: true } };
  }

  callbacks.onProgress?.({} as any, `正在切换到 @${username}...`);

  // 1. Click account switcher button
  const switcherBtn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') as HTMLElement;
  if (!switcherBtn) {
    return { success: false, error: '未找到账号切换按钮，请确保在 Twitter 页面' };
  }
  switcherBtn.click();

  // 2. Wait for account menu to appear
  const menuStart = Date.now();
  let targetCell: HTMLElement | null = null;
  while (Date.now() - menuStart < 5000) {
    // Look for button with aria-label matching "切换到 @username" or "Switch to @username"
    const cells = document.querySelectorAll('[data-testid="UserCell"]') as NodeListOf<HTMLElement>;
    for (const cell of cells) {
      const label = cell.getAttribute('aria-label') || '';
      // Match by aria-label (e.g. "切换到 @ClawMoneyAI" or "Switch to @ClawMoneyAI")
      if (label.toLowerCase().includes(username)) {
        targetCell = cell;
        break;
      }
      // Fallback: match by UserAvatar-Container-{username}
      const avatar = cell.querySelector(`[data-testid="UserAvatar-Container-${username}" i]`);
      if (avatar) {
        targetCell = cell;
        break;
      }
    }
    if (targetCell) break;
    await new Promise(r => setTimeout(r, 200));
  }

  if (!targetCell) {
    // Close menu by pressing Escape
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { success: false, error: `未找到账号 @${username}，请确认已登录该账号` };
  }

  // 3. Click target account
  targetCell.click();

  // 4. Wait for page reload (account switch triggers a full reload)
  await new Promise(r => setTimeout(r, 2000));

  return {
    success: true,
    data: { switchedTo: username }
  };
};

/**
 * 导出所有导航 handlers
 */
export const navigationHandlers: Record<string, ActionHandler> = {
  navigate_to_tweet: navigateToTweetHandler,
  navigate_to_url: navigateToUrlHandler,
  navigate_to_bookmarks: navigateToBookmarksHandler,
  navigate_to_notifications: navigateToNotificationsHandler,
  navigate_to_search: navigateToSearchHandler,
  return_to_timeline: returnToTimelineHandler,
  navigate_to_grok: navigateToGrokHandler,
  navigate_to_compose_article: navigateToComposeArticleHandler,
  navigate_to_communities: navigateToCommunitiesHandler,
  navigate_to_following: navigateToFollowingHandler,
  get_current_url: getCurrentUrlHandler,
  get_extension_status: getExtensionStatusHandler,
  switch_account: switchAccountHandler,
};
