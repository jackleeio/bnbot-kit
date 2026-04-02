/**
 * Reply Action Handlers
 * 回复类 Action 处理器
 */

import { ActionHandler } from '../../types/action';
import { HumanBehaviorSimulator } from '../../utils/HumanBehaviorSimulator';

// Twitter DOM 选择器
const SELECTORS = {
  replyButton: '[data-testid="reply"]',
  replyTextarea: '[data-testid="tweetTextarea_0"]',
  replyLabel: '[data-testid="tweetTextarea_0_label"]',
  submitButtonInline: '[data-testid="tweetButtonInline"]',
  submitButton: '[data-testid="tweetButton"]',
  fileInput: 'input[data-testid="fileInput"]',
  attachments: '[data-testid="attachments"]',
  dialog: '[role="dialog"]',
};

/**
 * 打开回复编辑器
 */
export const openReplyComposerHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在打开回复框...');

  const isDetailPage = window.location.href.includes('/status/');

  if (isDetailPage) {
    // 在详情页，回复框通常直接可见
    const inlineComposeArea = document.querySelector(SELECTORS.replyTextarea) as HTMLElement;
    if (inlineComposeArea) {
      inlineComposeArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await HumanBehaviorSimulator.randomDelay(500, 1000);
      inlineComposeArea.click();
      await HumanBehaviorSimulator.randomDelay(300, 500);
      return { success: true };
    }
  }

  // 点击回复按钮打开编辑器
  const replyButtons = Array.from(document.querySelectorAll(SELECTORS.replyButton));
  for (const btn of replyButtons) {
    if ((btn as HTMLElement).offsetParent !== null) {
      (btn as HTMLElement).click();
      await HumanBehaviorSimulator.randomDelay(500, 1000);
      const textarea = document.querySelector(SELECTORS.replyTextarea);
      if (textarea) {
        return { success: true };
      }
    }
  }

  return { success: false, error: '无法打开回复编辑器' };
};

/**
 * 填充回复内容
 */
export const fillReplyTextHandler: ActionHandler = async (params, callbacks) => {
  const { content, highlight = true } = params as { content: string; highlight?: boolean };
  callbacks.onProgress?.({} as any, '正在填充回复内容...');

  if (!content) {
    return { success: false, error: '缺少回复内容' };
  }

  const textarea = document.querySelector(SELECTORS.replyTextarea) as HTMLElement;
  if (!textarea) {
    return { success: false, error: '回复输入框未找到' };
  }

  // 聚焦
  textarea.click();
  textarea.focus();
  await HumanBehaviorSimulator.microPause();

  // 高亮显示
  if (highlight) {
    try {
      const container = textarea.parentElement;
      if (container) {
        const overlay = document.createElement('div');
        const computed = window.getComputedStyle(textarea);
        const radius = computed.borderRadius;

        if (window.getComputedStyle(container).position === 'static') {
          container.style.position = 'relative';
        }

        Object.assign(overlay.style, {
          position: 'absolute',
          top: '-4px', left: '-4px',
          width: `calc(${textarea.offsetWidth}px + 8px)`,
          height: `calc(${textarea.offsetHeight}px + 8px)`,
          pointerEvents: 'none',
          zIndex: '9999',
          borderRadius: radius || '16px',
          border: '4px solid rgba(29, 155, 240, 0.3)',
          boxShadow: 'inset 0 0 15px 2px rgba(29, 155, 240, 0.1)',
          opacity: '0',
          transition: 'opacity 0.4s ease-out'
        });

        container.appendChild(overlay);
        requestAnimationFrame(() => overlay.style.opacity = '1');
        setTimeout(() => overlay.remove(), 5000);
      }
    } catch (e) {
      console.warn('[fillReplyText] 高亮失败:', e);
    }
  }

  // 清除现有内容
  if (textarea.textContent && textarea.textContent.trim().length > 0) {
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    await HumanBehaviorSimulator.microPause();
  }

  // 使用粘贴模拟
  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', content);

    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer
    });

    textarea.dispatchEvent(pasteEvent);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    await HumanBehaviorSimulator.randomDelay(100, 200);

    // 验证内容
    const currentContent = textarea.textContent || '';
    if (!currentContent.includes(content.substring(0, Math.min(content.length, 20)))) {
      document.execCommand('insertText', false, content);
    }

    return { success: true };
  } catch (e) {
    console.error('[fillReplyText] 粘贴失败:', e);
    try {
      document.execCommand('insertText', false, content);
      return { success: true };
    } catch (e2) {
      return { success: false, error: '填充内容失败' };
    }
  }
};

/**
 * 上传图片到回复
 */
export const uploadImageToReplyHandler: ActionHandler = async (params, callbacks) => {
  const { imageData } = params as { imageData: string };
  callbacks.onProgress?.({} as any, '正在上传图片...');

  if (!imageData) {
    return { success: false, error: '缺少图片数据' };
  }

  // 查找文件输入框
  let fileInput = document.querySelector(
    `${SELECTORS.dialog} ${SELECTORS.fileInput}`
  ) as HTMLInputElement;

  if (!fileInput) {
    fileInput = document.querySelector(SELECTORS.fileInput) as HTMLInputElement;
  }

  if (!fileInput) {
    return { success: false, error: '文件输入框未找到' };
  }

  try {
    // 将 base64 转换为 Blob
    const blob = base64ToBlob(imageData);
    const file = new File([blob], 'reply_image.png', { type: blob.type || 'image/png' });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    // 等待上传处理
    await HumanBehaviorSimulator.randomDelay(2000, 3000);

    // 验证上传
    let imagePreview = document.querySelector(`${SELECTORS.dialog} ${SELECTORS.attachments}`);
    if (!imagePreview) {
      imagePreview = document.querySelector(SELECTORS.attachments);
    }

    if (!imagePreview) {
      console.warn('[uploadImageToReply] 图片预览未找到');
      return { success: false, error: '图片上传可能失败' };
    }

    return { success: true };
  } catch (e) {
    console.error('[uploadImageToReply] 上传失败:', e);
    return { success: false, error: '图片上传失败' };
  }
};

/**
 * 提交回复
 */
export const submitReplyHandler: ActionHandler = async (params, callbacks) => {
  const { waitForSuccess = true, replyText } = params as { waitForSuccess?: boolean; replyText?: string };
  callbacks.onProgress?.({} as any, '正在提交回复...');

  // 提交前记录回复内容（从参数或输入框获取）
  let expectedText = replyText || '';
  if (!expectedText) {
    const textarea = document.querySelector(SELECTORS.replyTextarea) as HTMLElement;
    if (textarea) {
      expectedText = textarea.textContent?.trim() || '';
    }
  }

  // 查找提交按钮
  let submitButton = document.querySelector(SELECTORS.submitButtonInline) as HTMLElement;
  if (!submitButton) {
    submitButton = document.querySelector(SELECTORS.submitButton) as HTMLElement;
  }

  if (!submitButton) {
    return { success: false, error: '提交按钮未找到' };
  }

  // 检查按钮是否可用
  if (submitButton.getAttribute('aria-disabled') === 'true') {
    return { success: false, error: '提交按钮不可用' };
  }

  // 获取 screen_name
  const screenName = document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.replace('/', '') || '';

  // 设置拦截标记 + 监听 CreateTweet 响应
  document.documentElement.setAttribute('data-bnbot-capture', 'true');
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

  await HumanBehaviorSimulator.randomDelay(50, 150);
  submitButton.click();

  // 等待 interceptor 拿到 tweetId
  const tweetResult = await tweetIdPromise;
  if (tweetResult) {
    const name = tweetResult.screenName || screenName;
    const tweetUrl = name ? `https://x.com/${name}/status/${tweetResult.tweetId}` : '';
    return {
      success: true,
      data: { tweetId: tweetResult.tweetId, tweetUrl, screenName: name }
    };
  }

  // fallback
  if (waitForSuccess) {
    const success = await waitForPostSuccess(15000, expectedText);
    if (!success) {
      return { success: false, error: '发布确认超时' };
    }
  }

  return { success: true };
};

/**
 * 等待发布成功（双重验证）
 * 1. 输入框清空 + 按钮禁用（快速信号）
 * 2. 对话中出现包含发送内容的新推文（最终确认）
 */
async function waitForPostSuccess(timeout: number = 30000, expectedText?: string): Promise<boolean> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const check = setInterval(() => {
      // 验证1: 输入框清空 + 按钮禁用
      const textarea = document.querySelector(SELECTORS.replyTextarea);
      const isEmpty = !textarea || !(textarea as HTMLElement).textContent?.trim();

      const submitBtn = document.querySelector(SELECTORS.submitButtonInline) as HTMLButtonElement;
      const submitBtn2 = document.querySelector(SELECTORS.submitButton) as HTMLButtonElement;
      const isDisabledOrGone = (!submitBtn && !submitBtn2) ||
        (submitBtn?.getAttribute('aria-disabled') === 'true') ||
        (submitBtn2?.getAttribute('aria-disabled') === 'true');

      const uiCleared = isEmpty && isDisabledOrGone;

      // 验证2: 对话中出现包含发送内容的新推文
      let tweetFound = false;
      if (expectedText) {
        const tweets = document.querySelectorAll('[data-testid="tweet"]');
        for (const tweet of tweets) {
          const tweetTextEl = tweet.querySelector('[data-testid="tweetText"]');
          if (!tweetTextEl) continue;
          const tweetContent = tweetTextEl.textContent?.trim() || '';
          // 检查内容匹配
          if (tweetContent.includes(expectedText.substring(0, Math.min(expectedText.length, 30)))) {
            // 检查时间戳是否刚发布（秒级）
            const timeEl = tweet.querySelector('time');
            if (timeEl) {
              const timeText = timeEl.textContent || '';
              // "1s", "2s", ... "59s" 或 "1m" 都算刚发布
              if (/^\d+s$/.test(timeText) || timeText === '1m') {
                tweetFound = true;
                break;
              }
            }
          }
        }
      }

      // 双重验证通过，或无预期文本时仅用 UI 验证
      if (uiCleared && (tweetFound || !expectedText)) {
        clearInterval(check);
        resolve(true);
        return;
      }

      // 任一验证通过也视为成功（冗余）
      if (tweetFound) {
        clearInterval(check);
        resolve(true);
        return;
      }

      if (Date.now() - startTime > timeout) {
        clearInterval(check);
        // 超时时任一通过即可
        resolve(uiCleared || tweetFound);
      }
    }, 300);
  });
}

/**
 * Base64 转 Blob
 */
function base64ToBlob(base64: string): Blob {
  // 处理 data URL
  let data = base64;
  let mimeType = 'image/png';

  if (base64.startsWith('data:')) {
    const parts = base64.split(',');
    const mimeMatch = parts[0].match(/data:([^;]+)/);
    if (mimeMatch) mimeType = mimeMatch[1];
    data = parts[1];
  }

  const byteString = atob(data);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }

  return new Blob([ab], { type: mimeType });
}

/**
 * 导出所有回复 handlers
 */
export const replyHandlers: Record<string, ActionHandler> = {
  open_reply_composer: openReplyComposerHandler,
  fill_reply_text: fillReplyTextHandler,
  upload_image_to_reply: uploadImageToReplyHandler,
  submit_reply: submitReplyHandler,
};
