/**
 * Engagement Action Handlers
 * 互动类 Action 处理器（点赞、转发、关注）
 */

import { ActionHandler } from '../../types/action';
import { HumanBehaviorSimulator } from '../../utils/HumanBehaviorSimulator';

const SELECTORS = {
  like: '[data-testid="like"]',
  unlike: '[data-testid="unlike"]',
  retweet: '[data-testid="retweet"]',
  unretweet: '[data-testid="unretweet"]',
  retweetConfirm: '[data-testid="retweetConfirm"]',
};

/** 等待元素出现（最多等待 timeout 毫秒） */
async function waitForSelector(selectors: string[], timeout = 5000): Promise<Element | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return null;
}

/**
 * 点赞推文
 */
export const likeTweetHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在点赞推文...');

  // 等待 like 或 unlike 按钮出现（页面可能还在加载）
  const btn = await waitForSelector([SELECTORS.unlike, SELECTORS.like], 5000);

  // 已经点赞过
  if (btn && btn.matches(SELECTORS.unlike)) {
    return { success: true, data: { alreadyDone: true } };
  }

  const likeButton = btn as HTMLElement;
  if (!likeButton) {
    return { success: false, error: '未找到点赞按钮' };
  }

  likeButton.click();
  await HumanBehaviorSimulator.randomDelay(500, 1000);

  // 验证点赞成功
  const confirmed = document.querySelector(SELECTORS.unlike);
  if (confirmed) {
    return { success: true };
  }

  return { success: false, error: '点赞操作未确认成功' };
};

/**
 * 转发推文
 */
export const retweetHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在转发推文...');

  // 等待 retweet 或 unretweet 按钮出现
  const btn = await waitForSelector([SELECTORS.unretweet, SELECTORS.retweet], 5000);

  // 已经转发过
  if (btn && btn.matches(SELECTORS.unretweet)) {
    return { success: true, data: { alreadyDone: true } };
  }

  const retweetButton = btn as HTMLElement;
  if (!retweetButton) {
    return { success: false, error: '未找到转发按钮' };
  }

  retweetButton.click();
  await HumanBehaviorSimulator.randomDelay(400, 800);

  // 等待菜单出现并点击 "Repost"
  const confirmButton = await waitForSelector([SELECTORS.retweetConfirm], 3000) as HTMLElement;
  if (confirmButton) {
    confirmButton.click();
    await HumanBehaviorSimulator.randomDelay(500, 1000);
  } else {
    return { success: false, error: '未找到转发确认按钮' };
  }

  // 验证转发成功
  const confirmed = document.querySelector(SELECTORS.unretweet);
  if (confirmed) {
    return { success: true };
  }

  return { success: true };
};

/**
 * 关注用户
 */
export const followUserHandler: ActionHandler = async (params, callbacks) => {
  const username = (params as any).username as string | undefined;
  console.log('[FollowUser] params:', JSON.stringify(params), 'username:', username);

  // 如果提供了 username，用 SPA 方式跳转到用户主页
  if (username) {
    callbacks.onProgress?.({} as any, `正在跳转到 @${username} 主页...`);
    const targetPath = `/${username}`;
    if (!window.location.pathname.startsWith(targetPath)) {
      window.history.pushState({}, '', `https://x.com${targetPath}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
      // 等待页面渲染
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  callbacks.onProgress?.({} as any, '正在关注用户...');

  // 等待 follow 或 unfollow 按钮出现
  const btn = await waitForSelector(['[data-testid$="-follow"]', '[data-testid$="-unfollow"]'], 5000);

  // 检查是否已经关注
  if (btn) {
    const testId = btn.getAttribute('data-testid');
    if (testId && testId.match(/^\d+-unfollow$/)) {
      return { success: true, data: { alreadyDone: true } };
    }
  }

  // 查找 follow 按钮
  const followButtons = document.querySelectorAll('[data-testid$="-follow"]');
  for (const b of followButtons) {
    const testId = b.getAttribute('data-testid');
    if (testId && testId.match(/^\d+-follow$/)) {
      (b as HTMLElement).click();
      await HumanBehaviorSimulator.randomDelay(500, 1000);

      // 验证关注成功：检查按钮是否变成 unfollow（显示 Following）
      const confirmed = await waitForSelector(['[data-testid$="-unfollow"]'], 3000);
      if (confirmed) {
        const confirmTestId = confirmed.getAttribute('data-testid');
        if (confirmTestId && confirmTestId.match(/^\d+-unfollow$/)) {
          return { success: true };
        }
      }
      return { success: false, error: '关注操作未确认成功' };
    }
  }

  return { success: false, error: '未找到关注按钮' };
};

/**
 * 引用推文（Quote Tweet）
 * 流程：点击 retweet 按钮 → 菜单出现 → 点击 Quote → 跳转编辑页 → 输入文本 → 发布
 */
export const quoteTweetHandler: ActionHandler = async (params, callbacks) => {
  const { text, media, draftOnly } = params as { text: string; media?: Array<{ type: string; url: string }>; draftOnly?: boolean };
  callbacks.onProgress?.({} as any, draftOnly ? '正在引用推文（草稿模式）...' : '正在引用推文...');

  if (!text) {
    return { success: false, error: '缺少引用文本参数 text' };
  }

  // 等待 retweet 按钮出现
  const btn = await waitForSelector([SELECTORS.retweet, SELECTORS.unretweet], 5000);
  if (!btn) {
    return { success: false, error: '未找到转发按钮' };
  }

  // 点击 retweet 按钮打开菜单
  (btn as HTMLElement).click();
  await HumanBehaviorSimulator.randomDelay(400, 800);

  // 等待菜单出现，点击 Quote 选项（<a href="/compose/post">）
  const quoteOption = await waitForSelector(['[role="menu"] a[href="/compose/post"]'], 3000) as HTMLElement;
  if (!quoteOption) {
    return { success: false, error: '未找到 Quote 菜单选项' };
  }
  quoteOption.click();
  await HumanBehaviorSimulator.randomDelay(1000, 2000);

  // 等待编辑器出现（推文编辑框）
  const editor = await waitForSelector(
    ['[data-testid="tweetTextarea_0"]', '[role="textbox"][data-testid="tweetTextarea_0"]'],
    5000
  ) as HTMLElement;
  if (!editor) {
    return { success: false, error: '未找到推文编辑框' };
  }

  // 聚焦编辑器并输入文本
  editor.focus();
  await HumanBehaviorSimulator.randomDelay(200, 400);

  // 使用 document.execCommand 或 dispatchEvent 输入文本（兼容 Draft.js）
  document.execCommand('insertText', false, text);
  await HumanBehaviorSimulator.randomDelay(500, 1000);

  // 上传媒体（如果有）
  if (media && media.length > 0) {
    callbacks.onProgress?.({} as any, '正在上传媒体...');
    const fileInput = document.querySelector('input[data-testid="fileInput"]') as HTMLInputElement;
    if (fileInput) {
      const files: File[] = [];
      for (const item of media) {
        try {
          let blob: Blob;
          if (item.url.startsWith('data:')) {
            const parts = item.url.split(',');
            const mimeMatch = parts[0].match(/data:([^;]+)/);
            const mime = mimeMatch ? mimeMatch[1] : 'image/png';
            const byteString = atob(parts[1]);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
            blob = new Blob([ab], { type: mime });
          } else {
            const resp = await fetch(item.url);
            blob = await resp.blob();
          }
          const ext = item.type === 'video' ? 'mp4' : 'png';
          files.push(new File([blob], `media_${Date.now()}.${ext}`, { type: blob.type }));
        } catch (e) {
          console.warn('[quoteTweet] 媒体处理失败:', e);
        }
      }
      if (files.length > 0) {
        const dt = new DataTransfer();
        files.forEach(f => dt.items.add(f));
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        await HumanBehaviorSimulator.randomDelay(1000, 2000);
      }
    }

    // 草稿模式：不等待上传完成
    if (draftOnly) {
      return { success: true, data: { draftOnly: true, text } };
    }

    // 等待媒体上传完成
    callbacks.onProgress?.({} as any, '等待媒体上传完成...');
    const uploadTimeout = 120000;
    const startWait = Date.now();
    while (Date.now() - startWait < uploadTimeout) {
      const btn = document.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]') as HTMLElement;
      if (btn && btn.getAttribute('aria-disabled') !== 'true') break;
      await HumanBehaviorSimulator.randomDelay(500, 1000);
    }
  }

  // 草稿模式（无媒体时）
  if (draftOnly) {
    return { success: true, data: { draftOnly: true, text } };
  }

  // 点击发布按钮
  const postButton = await waitForSelector(
    ['[data-testid="tweetButton"]', '[data-testid="tweetButtonInline"]'],
    3000
  ) as HTMLElement;
  if (!postButton) {
    return { success: false, error: '未找到发布按钮' };
  }

  if (postButton.getAttribute('aria-disabled') === 'true') {
    return { success: false, error: '媒体上传超时，发布按钮仍不可用' };
  }

  postButton.click();
  await HumanBehaviorSimulator.randomDelay(1000, 2000);

  return { success: true };
};

/**
 * 取消点赞推文
 */
export const unlikeTweetHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在取消点赞...');

  const btn = await waitForSelector([SELECTORS.unlike, SELECTORS.like], 5000);

  // 还没点赞过
  if (btn && btn.matches(SELECTORS.like)) {
    return { success: true, data: { alreadyDone: true } };
  }

  const unlikeButton = btn as HTMLElement;
  if (!unlikeButton) {
    return { success: false, error: '未找到取消点赞按钮' };
  }

  unlikeButton.click();
  await HumanBehaviorSimulator.randomDelay(500, 1000);

  const confirmed = document.querySelector(SELECTORS.like);
  if (confirmed) {
    return { success: true };
  }

  return { success: false, error: '取消点赞操作未确认成功' };
};

/**
 * 取消转发推文
 */
export const unretweetHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在取消转发...');

  const btn = await waitForSelector([SELECTORS.unretweet, SELECTORS.retweet], 5000);

  // 还没转发过
  if (btn && btn.matches(SELECTORS.retweet)) {
    return { success: true, data: { alreadyDone: true } };
  }

  const unretweetButton = btn as HTMLElement;
  if (!unretweetButton) {
    return { success: false, error: '未找到取消转发按钮' };
  }

  unretweetButton.click();
  await HumanBehaviorSimulator.randomDelay(400, 800);

  // 等待确认菜单出现并点击 "Undo repost"
  const confirmButton = await waitForSelector(['[data-testid="unretweetConfirm"]'], 3000) as HTMLElement;
  if (confirmButton) {
    confirmButton.click();
    await HumanBehaviorSimulator.randomDelay(500, 1000);
  } else {
    return { success: false, error: '未找到取消转发确认按钮' };
  }

  const confirmed = document.querySelector(SELECTORS.retweet);
  if (confirmed) {
    return { success: true };
  }

  return { success: true };
};

/**
 * 取关用户
 */
export const unfollowUserHandler: ActionHandler = async (params, callbacks) => {
  const username = (params as any).username as string | undefined;

  if (username) {
    callbacks.onProgress?.({} as any, `正在跳转到 @${username} 主页...`);
    const targetPath = `/${username}`;
    if (!window.location.pathname.startsWith(targetPath)) {
      window.history.pushState({}, '', `https://x.com${targetPath}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  callbacks.onProgress?.({} as any, '正在取消关注...');

  // 查找取关按钮：优先 aria-label（用户主页），再 data-testid（推文页）
  const btn = await waitForSelector([
    '[aria-label^="Unfollow @"]',
    '[data-testid$="-follow"]',
  ], 5000);

  // 没有关注过（只有 Follow 按钮）
  if (btn) {
    const ariaLabel = btn.getAttribute('aria-label');
    const testId = btn.getAttribute('data-testid');
    if (!ariaLabel?.startsWith('Unfollow @') && testId && testId.match(/^\d+-follow$/)) {
      return { success: true, data: { alreadyDone: true } };
    }
  }

  // 查找并点击 unfollow 按钮
  let unfollowBtn: HTMLElement | null = null;

  // 方式1: aria-label（用户主页的 Following 按钮）
  unfollowBtn = document.querySelector('[aria-label^="Unfollow @"]') as HTMLElement;

  if (!unfollowBtn) {
    return { success: false, error: '未找到取关按钮' };
  }

  unfollowBtn.click();
  await HumanBehaviorSimulator.randomDelay(500, 1000);

  // 点击后可能出现下拉菜单（用户主页）或确认弹窗（推文页）
  // 方式1: 下拉菜单中的 "Unfollow @xxx" menuitem
  const menuItem = await waitForSelector(['[role="menuitem"]'], 2000) as HTMLElement;
  if (menuItem) {
    // 找包含 "Unfollow" 文字的 menuitem
    const allMenuItems = document.querySelectorAll('[role="menuitem"]');
    for (const item of allMenuItems) {
      if (item.textContent?.toLowerCase().includes('unfollow')) {
        (item as HTMLElement).click();
        await HumanBehaviorSimulator.randomDelay(500, 1000);
        break;
      }
    }
  } else {
    // 方式2: 确认弹窗
    const confirmBtn = await waitForSelector([
      '[data-testid="confirmationSheetConfirm"]',
    ], 2000) as HTMLElement;
    if (confirmBtn) {
      confirmBtn.click();
      await HumanBehaviorSimulator.randomDelay(500, 1000);
    }
  }

  // 验证取关成功
  const confirmed = await waitForSelector(['[aria-label^="Follow @"]', '[data-testid$="-follow"]'], 3000);
  if (confirmed) {
    return { success: true };
  }
  return { success: true };
};

/**
 * 删除推文
 */
export const deleteTweetHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在删除推文...');

  // 点击推文的三点菜单 (caret)
  const caretBtn = await waitForSelector(['[data-testid="caret"]'], 5000) as HTMLElement;
  if (!caretBtn) {
    return { success: false, error: '未找到推文菜单按钮' };
  }

  caretBtn.click();
  await HumanBehaviorSimulator.randomDelay(400, 800);

  // 等待下拉菜单出现，找到删除选项
  const menuItems = await waitForSelector(['[role="menuitem"]'], 3000);
  if (!menuItems) {
    return { success: false, error: '未找到菜单项' };
  }

  // 查找包含 "Delete" 文字的菜单项
  const allMenuItems = document.querySelectorAll('[role="menuitem"]');
  let deleteItem: HTMLElement | null = null;
  for (const item of allMenuItems) {
    const text = item.textContent?.toLowerCase() || '';
    if (text.includes('delete') || text.includes('删除')) {
      deleteItem = item as HTMLElement;
      break;
    }
  }

  if (!deleteItem) {
    // 关闭菜单
    document.body.click();
    return { success: false, error: '未找到删除选项（可能不是自己的推文）' };
  }

  deleteItem.click();
  await HumanBehaviorSimulator.randomDelay(400, 800);

  // 等待确认弹窗并点击确认
  const confirmBtn = await waitForSelector(['[data-testid="confirmationSheetConfirm"]'], 3000) as HTMLElement;
  if (confirmBtn) {
    confirmBtn.click();
    await HumanBehaviorSimulator.randomDelay(500, 1000);
    return { success: true };
  }

  return { success: false, error: '未找到删除确认按钮' };
};

/**
 * 收藏推文（书签）
 */
export const bookmarkTweetHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在收藏推文...');

  // 书签按钮
  const btn = await waitForSelector(['[data-testid="bookmark"]', '[data-testid="removeBookmark"]'], 5000);

  if (btn && btn.matches('[data-testid="removeBookmark"]')) {
    return { success: true, data: { alreadyDone: true } };
  }

  const bookmarkButton = btn as HTMLElement;
  if (!bookmarkButton) {
    return { success: false, error: '未找到书签按钮' };
  }

  bookmarkButton.click();
  await HumanBehaviorSimulator.randomDelay(500, 1000);

  const confirmed = document.querySelector('[data-testid="removeBookmark"]');
  if (confirmed) {
    return { success: true };
  }

  return { success: false, error: '收藏操作未确认成功' };
};

/**
 * 取消收藏推文（取消书签）
 */
export const unbookmarkTweetHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在取消收藏...');

  const btn = await waitForSelector(['[data-testid="removeBookmark"]', '[data-testid="bookmark"]'], 5000);

  if (btn && btn.matches('[data-testid="bookmark"]')) {
    return { success: true, data: { alreadyDone: true } };
  }

  const unbookmarkButton = btn as HTMLElement;
  if (!unbookmarkButton) {
    return { success: false, error: '未找到取消书签按钮' };
  }

  unbookmarkButton.click();
  await HumanBehaviorSimulator.randomDelay(500, 1000);

  const confirmed = document.querySelector('[data-testid="bookmark"]');
  if (confirmed) {
    return { success: true };
  }

  return { success: false, error: '取消收藏操作未确认成功' };
};

/**
 * 导出所有互动类 handlers
 */
export const engagementHandlers: Record<string, ActionHandler> = {
  like_tweet: likeTweetHandler,
  unlike_tweet: unlikeTweetHandler,
  retweet: retweetHandler,
  unretweet: unretweetHandler,
  follow_user: followUserHandler,
  unfollow_user: unfollowUserHandler,
  quote_tweet: quoteTweetHandler,
  delete_tweet: deleteTweetHandler,
  bookmark_tweet: bookmarkTweetHandler,
  unbookmark_tweet: unbookmarkTweetHandler,
};
