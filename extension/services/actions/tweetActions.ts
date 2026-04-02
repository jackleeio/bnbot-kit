/**
 * Tweet Action Handlers
 * 发推类 Action 处理器
 */

import { ActionHandler, ThreadTweet } from '../../types/action';
import { HumanBehaviorSimulator } from '../../utils/HumanBehaviorSimulator';
import { tweetPoster } from '../../utils/tweetPoster';
import { TweetPostInterceptor } from '../../utils/TweetPostInterceptor';
import { PostVerifier } from '../../utils/PostVerifier';

// Twitter DOM 选择器
const SELECTORS = {
  newTweetButton: '[data-testid="SideNav_NewTweet_Button"]',
  tweetTextarea: '[data-testid="tweetTextarea_0"]',
  tweetButton: '[data-testid="tweetButton"]',
  dialog: '[role="dialog"]',
  fileInput: 'input[data-testid="fileInput"]',
};

/**
 * 打开推文编辑器
 */
export const openTweetComposerHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在打开推文编辑器...');

  const newTweetBtn = document.querySelector(SELECTORS.newTweetButton) as HTMLElement;
  if (!newTweetBtn) {
    return { success: false, error: '新推文按钮未找到' };
  }

  newTweetBtn.click();
  await HumanBehaviorSimulator.randomDelay(500, 1000);

  // 等待编辑器出现
  const startTime = Date.now();
  while (Date.now() - startTime < 5000) {
    const textarea = document.querySelector(`${SELECTORS.dialog} ${SELECTORS.tweetTextarea}`);
    if (textarea) {
      return { success: true };
    }
    await HumanBehaviorSimulator.randomDelay(200, 300);
  }

  return { success: false, error: '推文编辑器未能打开' };
};

/**
 * 发布单条推文
 */
export const postTweetHandler: ActionHandler = async (params, callbacks) => {
  const { text, media, draftOnly } = params as { text: string; media?: Array<{ type: string; url: string }>; draftOnly?: boolean };
  callbacks.onProgress?.({} as any, draftOnly ? '正在填充推文（草稿模式）...' : '正在发布推文...');

  if (!text) {
    return { success: false, error: '缺少推文内容' };
  }

  // 打开编辑器
  const newTweetBtn = document.querySelector(SELECTORS.newTweetButton) as HTMLElement;
  if (newTweetBtn) {
    newTweetBtn.click();
    await HumanBehaviorSimulator.randomDelay(500, 1000);
  }

  // 等待并填充文本
  let textarea = await waitForElement(`${SELECTORS.dialog} ${SELECTORS.tweetTextarea}`, 5000);

  // 找不到输入框：回到 /home，点 Post 按钮，重试
  if (!textarea) {
    callbacks.onProgress?.({} as any, '输入框未找到，正在回到首页重试...');
    // 用链接点击方式导航（不刷新 SPA）
    const tempLink = document.createElement('a');
    tempLink.href = '/home';
    tempLink.style.display = 'none';
    document.body.appendChild(tempLink);
    tempLink.click();
    document.body.removeChild(tempLink);
    await HumanBehaviorSimulator.randomDelay(1500, 2000);

    // 重新点 Post 按钮
    const retryBtn = document.querySelector(SELECTORS.newTweetButton) as HTMLElement;
    if (retryBtn) {
      retryBtn.click();
      await HumanBehaviorSimulator.randomDelay(800, 1200);
    }

    textarea = await waitForElement(`${SELECTORS.dialog} ${SELECTORS.tweetTextarea}`, 5000);
    if (!textarea) {
      return { success: false, error: '推文输入框未找到（已重试：回到首页并点击 Post 按钮）' };
    }
  }

  textarea.focus();
  textarea.click();
  await HumanBehaviorSimulator.microPause();

  // 使用粘贴模拟填充内容
  simulatePaste(textarea, text);
  await HumanBehaviorSimulator.randomDelay(300, 500);

  // 上传媒体
  if (media && media.length > 0) {
    callbacks.onProgress?.({} as any, '正在上传媒体...');
    try {
      await uploadMediaFiles(media);
      await HumanBehaviorSimulator.randomDelay(2000, 3000);
    } catch (e) {
      console.warn('[postTweet] 媒体上传失败:', e);
    }
  }

  // 草稿模式：填好文字和媒体后不点发送，也不等待上传完成
  if (draftOnly) {
    return { success: true, data: { draftOnly: true, text, mediaCount: media?.length || 0 } };
  }

  // 等待媒体上传完成（发帖按钮变为可用）
  if (media && media.length > 0) {
    callbacks.onProgress?.({} as any, '等待媒体上传完成...');
    const uploadTimeout = 120000; // 2 分钟超时
    const startWait = Date.now();
    while (Date.now() - startWait < uploadTimeout) {
      const btn = document.querySelector(`${SELECTORS.dialog} ${SELECTORS.tweetButton}`) as HTMLElement;
      if (btn && btn.getAttribute('aria-disabled') !== 'true') {
        callbacks.onProgress?.({} as any, '媒体上传完成');
        break;
      }
      await HumanBehaviorSimulator.randomDelay(500, 1000);
    }
  }

  // 获取 screen_name（在 dialog 关闭前获取）
  const screenName = document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.replace('/', '') || '';

  // 1. 先设置 tweetId 监听（双通道：window.message + document custom event）
  const tweetIdPromise = new Promise<{ tweetId: string; screenName?: string } | null>((resolve) => {
    let resolved = false;
    const cleanup = () => {
      window.removeEventListener('message', msgHandler);
      document.removeEventListener('bnbot-tweet-created', domHandler);
    };
    const handleResult = (data: any) => {
      if (resolved) return;
      if (data?.type === 'BNBOT_TWEET_CREATED' && data.success && data.tweetId) {
        resolved = true;
        cleanup();
        resolve({ tweetId: data.tweetId, screenName: data.screenName });
      }
    };
    const msgHandler = (event: MessageEvent) => handleResult(event.data);
    const domHandler = (event: Event) => handleResult((event as CustomEvent).detail);
    window.addEventListener('message', msgHandler);
    document.addEventListener('bnbot-tweet-created', domHandler);
    setTimeout(() => { if (!resolved) { cleanup(); resolve(null); } }, 15000);
  });

  // 2. 设置捕获标记 + 点击发布按钮（拦截器已在页面加载时注入）
  document.documentElement.setAttribute('data-bnbot-capture', 'true');
  const tweetButton = document.querySelector(`${SELECTORS.dialog} ${SELECTORS.tweetButton}`) as HTMLElement;
  if (!tweetButton) {
    return { success: false, error: '发布按钮未找到' };
  }

  if (tweetButton.getAttribute('aria-disabled') === 'true') {
    return { success: false, error: '媒体上传超时，发布按钮仍不可用' };
  }

  tweetButton.click();

  // 4. 等待 tweetId
  const tweetResult = await tweetIdPromise;

  if (tweetResult) {
    const name = tweetResult.screenName || screenName;
    const tweetUrl = name ? `https://x.com/${name}/status/${tweetResult.tweetId}` : '';
    return {
      success: true,
      data: { tweetId: tweetResult.tweetId, tweetUrl, screenName: name }
    };
  }

  // fallback: 没拿到 tweetId 但推文可能已发出
  await HumanBehaviorSimulator.randomDelay(2000, 3000);
  const dialogStillExists = !!document.querySelector(SELECTORS.dialog);
  return {
    success: !dialogStillExists,
    error: dialogStillExists ? '发布可能失败' : undefined,
    data: { tweetId: null, tweetUrl: null }
  };
};

/**
 * 发布线程（长推）
 * 与 RewrittenTimeline 的 Publish 按钮完全一致，直接调用 tweetPoster.postThread()
 */
export const postThreadHandler: ActionHandler = async (params, callbacks) => {
  const { tweets, draftOnly } = params as { tweets: ThreadTweet[]; draftOnly?: boolean };
  callbacks.onProgress?.({} as any, draftOnly ? '正在填充线程（草稿模式）...' : '正在发布线程...');

  if (!tweets || tweets.length === 0) {
    return { success: false, error: '缺少推文数据' };
  }

  try {
    const formattedTweets = tweets.map(t => ({
      text: t.text,
      media: t.media?.map(m => ({
        type: m.type,
        url: m.url || '',
        media_url: m.base64 || m.url || '',
      })) || [],
    }));

    // 与 RewrittenTimeline handleAutoPost 完全一致
    await tweetPoster.postThread(
      formattedTweets as any,
      (current, total) => {
        callbacks.onProgress?.({} as any, `正在填充 ${current}/${total}...`);
      },
      (uploading) => {
        if (uploading) {
          callbacks.onProgress?.({} as any, '正在上传媒体...');
        }
      }
    );

    if (draftOnly) {
      return { success: true, data: { draftOnly: true, tweetCount: tweets.length } };
    }

    // 点击发布
    const tweetButton = document.querySelector(`${SELECTORS.dialog} ${SELECTORS.tweetButton}`) as HTMLElement;
    if (!tweetButton) {
      return { success: false, error: '发布按钮未找到' };
    }
    tweetButton.click();
    await HumanBehaviorSimulator.randomDelay(2000, 3000);

    return { success: true, data: { tweetCount: tweets.length } };
  } catch (e) {
    console.error('[postThread] 发布失败:', e);
    return { success: false, error: e instanceof Error ? e.message : '发布线程失败' };
  }
};

/**
 * 等待元素出现
 */
async function waitForElement(selector: string, timeout: number = 5000): Promise<HTMLElement | null> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const el = document.querySelector(selector) as HTMLElement;
    if (el) return el;
    await HumanBehaviorSimulator.randomDelay(100, 200);
  }
  return null;
}


/**
 * 模拟粘贴
 */
function simulatePaste(element: HTMLElement, text: string): void {
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(text, 'text/plain');

  const pasteEvent = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: dataTransfer
  });

  element.dispatchEvent(pasteEvent);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * 上传媒体文件
 */
async function uploadMediaFiles(media: Array<{ type: string; url: string }>): Promise<void> {
  const fileInput = document.querySelector(`${SELECTORS.dialog} ${SELECTORS.fileInput}`) as HTMLInputElement;
  if (!fileInput) throw new Error('文件输入框未找到');

  const files: File[] = [];

  for (const item of media) {
    try {
      let blob: Blob;

      if (item.url.startsWith('data:')) {
        // Base64 数据
        const parts = item.url.split(',');
        const mimeMatch = parts[0].match(/data:([^;]+)/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
        const byteString = atob(parts[1]);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        blob = new Blob([ab], { type: mime });
      } else {
        // URL
        const response = await fetch(item.url);
        blob = await response.blob();
      }

      const ext = item.type === 'video' ? 'mp4' : 'png';
      const filename = `media_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${ext}`;
      files.push(new File([blob], filename, { type: blob.type }));
    } catch (e) {
      console.error('[uploadMediaFiles] 处理媒体失败:', item, e);
    }
  }

  if (files.length > 0) {
    const dataTransfer = new DataTransfer();
    files.forEach(file => dataTransfer.items.add(file));
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/**
 * 关闭推文编辑器
 * save=true: 保存为草稿；save=false: 放弃内容
 */
export const closeComposerHandler: ActionHandler = async (params, callbacks) => {
  const { save } = params as { save?: boolean };
  callbacks.onProgress?.({} as any, save ? '正在保存草稿...' : '正在关闭编辑器...');

  // 检查编辑器是否打开
  const dialog = document.querySelector(SELECTORS.dialog);
  if (!dialog) {
    return { success: false, error: '推文编辑器未打开' };
  }

  // 点击关闭按钮 (X)
  const closeBtn = document.querySelector('[data-testid="app-bar-close"]') as HTMLElement;
  if (!closeBtn) {
    return { success: false, error: '关闭按钮未找到' };
  }
  closeBtn.click();
  await HumanBehaviorSimulator.randomDelay(500, 800);

  // 检查是否弹出确认对话框（有内容时会弹出"保存帖子？"）
  const confirmDialog = document.querySelector('[data-testid="confirmationSheetDialog"]') as HTMLElement;
  if (confirmDialog) {
    if (save) {
      // 点击"保存"
      const saveBtn = confirmDialog.querySelector('[data-testid="confirmationSheetConfirm"]') as HTMLElement;
      if (saveBtn) {
        saveBtn.click();
        await HumanBehaviorSimulator.randomDelay(300, 500);
        return { success: true, data: { action: 'saved_as_draft' } };
      }
      return { success: false, error: '保存按钮未找到' };
    } else {
      // 点击"放弃"
      const discardBtn = confirmDialog.querySelector('[data-testid="confirmationSheetCancel"]') as HTMLElement;
      if (discardBtn) {
        discardBtn.click();
        await HumanBehaviorSimulator.randomDelay(300, 500);
        return { success: true, data: { action: 'discarded' } };
      }
      return { success: false, error: '放弃按钮未找到' };
    }
  }

  // 没有确认对话框说明编辑器是空的，直接关闭了
  return { success: true, data: { action: 'closed' } };
};

/**
 * 导出所有发推 handlers
 */
export const tweetHandlers: Record<string, ActionHandler> = {
  open_tweet_composer: openTweetComposerHandler,
  post_tweet: postTweetHandler,
  post_thread: postThreadHandler,
  close_composer: closeComposerHandler,
};
