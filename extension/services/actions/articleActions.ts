/**
 * Article Action Handlers
 * 文章类 Action 处理器
 */

import { ActionHandler, ArticleData } from '../../types/action';
import { HumanBehaviorSimulator } from '../../utils/HumanBehaviorSimulator';
import { MarkdownPasteProcessor } from '../../utils/MarkdownPasteProcessor';

// Twitter 文章编辑器选择器
const SELECTORS = {
  // 文章编辑器相关
  articleEditor: '[data-testid="articleEditor"]',
  titleInput: 'textarea[name="文章标题"], textarea[placeholder="添加标题"], textarea[name="Article Title"], textarea[placeholder="Add a title"]',
  bodyEditor: '[data-testid="composer"][contenteditable="true"]',
  headerImageInput: 'input[data-testid="fileInput"]',
  publishButton: '[data-testid="publishButton"]',
  saveDraftButton: '[data-testid="saveDraftButton"]',
  // 文章列表页 -> 创建文章入口
  emptyStateCreateLink: 'a[data-testid="empty_state_button_text"], [data-testid="empty_state_button_text"]',
  createButton: 'button[aria-label="create"], button[aria-label="Create"]',
  createEditLink: 'a[href="/compose/articles/edit/new"]',
  articleNavLink: 'a[href="/compose/articles"]',
  // 新推文按钮菜单
  newTweetButton: '[data-testid="SideNav_NewTweet_Button"]',
  // 通用
  dialog: '[role="dialog"]',
};

function navigateToUrl(url: string): void {
  const fullUrl = url.startsWith('http') ? url : `https://x.com${url.startsWith('/') ? '' : '/'}${url}`;
  window.history.pushState({}, '', fullUrl);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

async function ensureOnArticlesPage(timeout: number = 18000): Promise<boolean> {
  if (window.location.pathname.startsWith('/compose/articles')) {
    return true;
  }

  const navLink = document.querySelector(SELECTORS.articleNavLink) as HTMLAnchorElement | null;
  if (navLink) {
    navLink.click();
  } else {
    navigateToUrl('/compose/articles');
  }

  return waitForNavigation('/compose/articles', timeout);
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

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function placeCursorAtEditorEnd(editor: HTMLElement): void {
  editor.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function extractMarkdownProbe(content: string): string {
  const lines = content.split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s+/, '')
      .replace(/`+/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim())
    .filter(Boolean);
  const probe = lines.find((l) => l.length >= 6) || lines[0] || '';
  return normalizeText(probe).slice(0, 24);
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) {
    setter.call(textarea, value);
  } else {
    textarea.value = value;
  }
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

function getTitleTarget(): HTMLElement | null {
  return document.querySelector(SELECTORS.titleInput) as HTMLElement | null;
}

function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    parseFloat(style.opacity || '1') !== 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function getBodyEditor(): HTMLElement | null {
  const preferredAll = Array.from(document.querySelectorAll(SELECTORS.bodyEditor)) as HTMLElement[];
  const preferredVisible = preferredAll.filter(isElementVisible);

  // Prefer visible editor inside Twitter primary column.
  const inPrimary = preferredVisible.find((el) => !!el.closest('[data-testid="primaryColumn"]'));
  if (inPrimary) return inPrimary;
  if (preferredVisible.length > 0) return preferredVisible[0];
  if (preferredAll.length > 0) return preferredAll[0];

  const fallbackAll = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];
  const fallbackVisible = fallbackAll.filter(isElementVisible);
  const fallbackInPrimary = fallbackVisible.find((el) => !!el.closest('[data-testid="primaryColumn"]'));
  if (fallbackInPrimary) return fallbackInPrimary;
  if (fallbackVisible.length > 0) return fallbackVisible[0];
  return fallbackAll[0] || null;
}

function getBodyImageCount(editor: HTMLElement): number {
  return editor.querySelectorAll('img').length;
}

async function clickApplyButtonIfPresent(timeout: number = 12000): Promise<boolean> {
  const startTime = Date.now();
  let seenApplyButton = false;
  while (Date.now() - startTime < timeout) {
    const applyBtn = document.querySelector('[data-testid="applyButton"]') as HTMLElement | null;
    if (!applyBtn) {
      await HumanBehaviorSimulator.randomDelay(150, 250);
      continue;
    }
    seenApplyButton = true;

    applyBtn.click();
    await HumanBehaviorSimulator.randomDelay(600, 1000);

    // 等待裁剪/编辑弹层关闭（apply 按钮消失）
    const closeWaitStart = Date.now();
    while (Date.now() - closeWaitStart < 6000) {
      const stillThere = document.querySelector('[data-testid="applyButton"]');
      if (!stillThere) return true;
      await HumanBehaviorSimulator.randomDelay(120, 220);
    }

    // 若点击后仍存在，继续重试
  }
  // 若从未出现“应用”按钮，说明当前上传流程无需裁剪确认，按成功处理
  return !seenApplyButton;
}

/**
 * 模拟粘贴
 */
function simulatePaste(element: HTMLElement, text: string): void {
  const dataTransfer = new DataTransfer();
  dataTransfer.setData('text/plain', text);

  // Synthetic ClipboardEvent often drops text/html in extension context.
  // Force a stable clipboardData payload so Draft.js/handlers can read it.
  const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  const clipboardPayload = {
    getData: (type: string) => {
      if (type === 'text/plain' || type === 'text') return text;
      return '';
    },
    types: ['text/plain'],
    files: dataTransfer.files,
    items: dataTransfer.items,
  };
  Object.defineProperty(pasteEvent, 'clipboardData', {
    value: clipboardPayload,
    configurable: true,
  });

  element.dispatchEvent(pasteEvent);
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function simulateRichPaste(element: HTMLElement, plainText: string, html: string): void {
  const dataTransfer = new DataTransfer();
  dataTransfer.setData('text/plain', plainText);
  dataTransfer.setData('text/html', html);

  const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  const clipboardPayload = {
    getData: (type: string) => {
      if (type === 'text/html') return html;
      if (type === 'text/plain' || type === 'text') return plainText;
      return '';
    },
    types: ['text/html', 'text/plain'],
    files: dataTransfer.files,
    items: dataTransfer.items,
  };
  Object.defineProperty(pasteEvent, 'clipboardData', {
    value: clipboardPayload,
    configurable: true,
  });

  element.dispatchEvent(pasteEvent);
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function expandConvertedMarkdownHtml(
  htmlWithMarker: string,
  codeBlocks: Array<{ lang: string; code: string }>,
  imageBlocks: Array<{ index: number; url: string }>
): string {
  let html = htmlWithMarker.replace(MarkdownPasteProcessor.getMarker(), '');

  // Replace code placeholders with real code blocks to avoid leaving raw [CODE_x:lang] text.
  html = html.replace(/\[CODE_(\d+):([a-zA-Z0-9_-]+)\]/g, (_m, idxStr) => {
    const idx = Number(idxStr) - 1;
    const block = codeBlocks[idx];
    if (!block) return '';
    return `<pre><code>${escapeHtml(block.code || '')}</code></pre>`;
  });

  // Replace image placeholders if present.
  html = html.replace(/\[IMG_(\d+)\]/g, (_m, idxStr) => {
    const idx = Number(idxStr);
    const image = imageBlocks.find((b) => b.index === idx);
    if (!image?.url) return '';
    return `<p><img src="${image.url}" style="max-width:100%;height:auto;" /></p>`;
  });

  return html;
}

function insertHtmlIntoEditor(editor: HTMLElement, html: string): boolean {
  editor.focus();
  const inserted = document.execCommand('insertHTML', false, html);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  return inserted;
}

function insertHtmlByRange(editor: HTMLElement, html: string): boolean {
  editor.focus();
  const selection = window.getSelection();
  if (!selection) return false;

  let range: Range;
  if (selection.rangeCount > 0) {
    range = selection.getRangeAt(0);
  } else {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }

  const fragment = range.createContextualFragment(html);
  range.deleteContents();
  range.insertNode(fragment);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);

  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

async function tryNativePasteFromClipboard(editor: HTMLElement, html: string, plainText: string): Promise<boolean> {
  try {
    const htmlBlob = new Blob([html], { type: 'text/html' });
    const textBlob = new Blob([plainText], { type: 'text/plain' });
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': htmlBlob,
        'text/plain': textBlob,
      })
    ]);

    editor.focus();
    const pasted = document.execCommand('paste', false);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return pasted;
  } catch (e) {
    console.warn('[fillArticleBody] Native clipboard paste unavailable:', e);
    return false;
  }
}

function insertImageIntoEditor(editor: HTMLElement, imageUrl: string): void {
  editor.focus();
  try {
    document.execCommand('insertParagraph', false);
  } catch {
    // ignore
  }

  const inserted = document.execCommand('insertImage', false, imageUrl);
  if (!inserted) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    editor.appendChild(img);
  }

  try {
    document.execCommand('insertParagraph', false);
  } catch {
    // ignore
  }
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Base64 转 Blob
 */
function base64ToBlob(base64: string): Blob {
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
 * 打开文章编辑器
 */
export const openArticleEditorHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在打开文章编辑器...');

  const hasComposer = () => !!document.querySelector(SELECTORS.bodyEditor);
  const hasTitle = () => !!document.querySelector(SELECTORS.titleInput);

  // 已在编辑页且可编辑
  if (window.location.pathname.includes('/compose/articles/edit/') && (hasComposer() || hasTitle())) {
    return { success: true, data: { alreadyThere: true } };
  }

  // 1) 必须先到 /compose/articles
  callbacks.onProgress?.({} as any, '正在进入文章页...');
  const atCompose = await ensureOnArticlesPage(18000);
  if (!atCompose) {
    return { success: false, error: '导航到文章页超时' };
  }
  await HumanBehaviorSimulator.randomDelay(1000, 1500);

  // 2) 在页面上点击“创建文章”按钮（empty-state 或右上角 create）
  callbacks.onProgress?.({} as any, '正在点击创建文章...');
  await HumanBehaviorSimulator.randomDelay(500, 900);

  const createTrigger =
    (document.querySelector(SELECTORS.emptyStateCreateLink) as HTMLElement | null) ||
    (document.querySelector(SELECTORS.createButton) as HTMLElement | null) ||
    (document.querySelector(SELECTORS.createEditLink) as HTMLElement | null);

  if (!createTrigger) {
    // 某些页面可能已经处于编辑态，只是 URL 还未完全更新
    if (hasTitle() || hasComposer()) {
      return { success: true, data: { inferredEditorReady: true } };
    }
    return { success: false, error: '未找到创建文章按钮' };
  }

  createTrigger.click();
  await HumanBehaviorSimulator.randomDelay(1200, 1800);

  // 3) 等待进入编辑页
  const atEditor = await waitForNavigation('/compose/articles/edit/', 15000);
  if (!atEditor) {
    if (!hasTitle() && !hasComposer()) {
      return { success: false, error: '进入文章编辑器超时' };
    }
  }

  const ready = hasTitle() || hasComposer();
  if (!ready) {
    return { success: false, error: '编辑器未就绪' };
  }

  return { success: true, data: { editorReady: true } };
};

/**
 * 填充文章标题
 */
export const fillArticleTitleHandler: ActionHandler = async (params, callbacks) => {
  const { title } = params as { title: string };
  callbacks.onProgress?.({} as any, '正在填充文章标题...');

  if (!title) {
    return { success: false, error: '缺少文章标题' };
  }

  // 查找标题输入框（严格限定标题区域，避免写入正文编辑器）
  const titleInput = (await waitForElement(SELECTORS.titleInput, 5000)) || getTitleTarget();
  if (!titleInput) {
    return { success: false, error: '文章标题输入框未找到' };
  }
  if (!(titleInput instanceof HTMLTextAreaElement)) {
    return { success: false, error: '标题目标不是 textarea，已阻止误写正文' };
  }

  titleInput.focus();
  setTextareaValue(titleInput, title);
  await HumanBehaviorSimulator.randomDelay(500, 1000);

  const currentTitle = titleInput.value || '';
  const titleOk = normalizeText(currentTitle).includes(normalizeText(title).slice(0, 12));
  if (!titleOk) {
    return { success: false, error: '标题写入校验失败' };
  }

  return { success: true, data: { titleApplied: true } };
};

/**
 * 填充文章正文
 */
export const fillArticleBodyHandler: ActionHandler = async (params, callbacks) => {
  const { content = '', format = 'plain', bodyImages = [] } = params as {
    content?: string;
    format?: 'plain' | 'markdown' | 'html';
    bodyImages?: string[];
  };
  callbacks.onProgress?.({} as any, '正在填充文章正文...');

  if (!content && (!bodyImages || bodyImages.length === 0)) {
    return { success: false, error: '缺少文章内容和图片' };
  }

  const bodyEditor = getBodyEditor();

  if (!bodyEditor) {
    return { success: false, error: '文章正文编辑器未找到' };
  }

  bodyEditor.focus();
  await HumanBehaviorSimulator.microPause();

  // 根据格式处理内容
  let processedContent = content;
  if (format === 'markdown') {
    // Markdown 转换可以在这里添加
    // 目前直接使用原始内容，Twitter 编辑器会处理一些基本格式
    processedContent = content;
  }

  if (processedContent) {
    const beforeTextLen = normalizeText(bodyEditor.textContent || '').length;
    if (format === 'markdown') {
      try {
        placeCursorAtEditorEnd(bodyEditor);
        const { html: processedHtml, codeBlocks, imageBlocks } = MarkdownPasteProcessor.processMarkdownStatic(processedContent);
        MarkdownPasteProcessor.setPendingCodeBlocks(codeBlocks);
        MarkdownPasteProcessor.setPendingImageBlocks(imageBlocks);

        // Method 1: Dispatch ClipboardEvent with real DataTransfer (same as ArticleCard).
        // MarkdownPasteProcessor sees the MARKER and lets Draft.js handle the HTML natively.
        const dt = new DataTransfer();
        dt.setData('text/html', processedHtml);
        dt.setData('text/plain', processedContent);
        const pasteEvt = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        });
        bodyEditor.dispatchEvent(pasteEvt);
        await HumanBehaviorSimulator.randomDelay(800, 1200);

        // Verify content was inserted
        let bodyText = normalizeText(bodyEditor.textContent || '');
        let applied = bodyText.length > beforeTextLen;
        const probe = extractMarkdownProbe(processedContent);
        if (!applied && probe) {
          applied = bodyText.includes(probe);
        }

        // Method 2: If paste didn't work, try direct HTML insert
        if (!applied) {
          console.warn('[fillArticleBody] Rich paste did not apply, trying direct HTML insert');
          const expandedHtml = expandConvertedMarkdownHtml(processedHtml, codeBlocks, imageBlocks);
          bodyEditor.focus();
          let inserted = insertHtmlIntoEditor(bodyEditor, expandedHtml);
          if (!inserted) {
            inserted = insertHtmlByRange(bodyEditor, expandedHtml);
          }
          await HumanBehaviorSimulator.randomDelay(300, 500);
          bodyText = normalizeText(bodyEditor.textContent || '');
          applied = bodyText.length > beforeTextLen || (probe ? bodyText.includes(probe) : false);
        }

        // Method 3: Last resort — plain text paste
        if (!applied) {
          console.warn('[fillArticleBody] Direct HTML insert failed, falling back to plain text');
          placeCursorAtEditorEnd(bodyEditor);
          simulatePaste(bodyEditor, processedContent);
          await HumanBehaviorSimulator.randomDelay(300, 500);
          bodyText = normalizeText(bodyEditor.textContent || '');
          applied = bodyText.length > beforeTextLen || (probe ? bodyText.includes(probe) : false);
        }

        if (!applied) {
          return { success: false, error: 'Markdown 正文写入校验失败（三种方式均失败）' };
        }
      } catch (e) {
        console.warn('[fillArticleBody] Markdown transform failed:', e);
        return { success: false, error: 'Markdown 转换失败，请重试' };
      }
    } else {
      simulatePaste(bodyEditor, processedContent);
      await HumanBehaviorSimulator.randomDelay(500, 1000);
      const bodyText = normalizeText(bodyEditor.textContent || '');
      const lengthGrown = bodyText.length > beforeTextLen;
      const expectedSnippet = normalizeText(processedContent).slice(0, 10);
      if (!lengthGrown && !bodyText.includes(expectedSnippet)) {
        return { success: false, error: '正文写入校验失败' };
      }
    }
  }

  if (bodyImages && bodyImages.length > 0) {
    callbacks.onProgress?.({} as any, `正在插入正文图片 (${bodyImages.length})...`);
    const before = getBodyImageCount(bodyEditor);
    for (let i = 0; i < bodyImages.length; i++) {
      insertImageIntoEditor(bodyEditor, bodyImages[i]);
      await HumanBehaviorSimulator.randomDelay(600, 1000);
    }
    const after = getBodyImageCount(bodyEditor);
    if (after < before + bodyImages.length) {
      return { success: false, error: `正文图片插入校验失败: expected +${bodyImages.length}, got +${after - before}` };
    }
  }

  return { success: true, data: { bodyApplied: true, bodyImagesCount: bodyImages.length } };
};

/**
 * 上传文章头图
 */
export const uploadArticleHeaderImageHandler: ActionHandler = async (params, callbacks) => {
  const { imageData } = params as { imageData: string };
  callbacks.onProgress?.({} as any, '正在上传文章头图...');

  if (!imageData) {
    return { success: false, error: '缺少图片数据' };
  }

  // 查找文件输入框
  const fileInput = document.querySelector(SELECTORS.headerImageInput) as HTMLInputElement;
  if (!fileInput) {
    return { success: false, error: '文件输入框未找到' };
  }

  try {
    const blob = base64ToBlob(imageData);
    const file = new File([blob], 'header.png', { type: blob.type });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await HumanBehaviorSimulator.randomDelay(1000, 1600);

    // 某些 UI 会弹出“编辑媒体”弹层，需要点击“应用”才会真正写入头图
    callbacks.onProgress?.({} as any, '正在应用头图编辑...');
    const applied = await clickApplyButtonIfPresent(12000);
    if (!applied) {
      return { success: false, error: '头图应用按钮未成功完成' };
    }
    await HumanBehaviorSimulator.randomDelay(600, 1000);

    return { success: true, data: { headerApplied: true } };
  } catch (e) {
    console.error('[uploadArticleHeaderImage] 上传失败:', e);
    return { success: false, error: '头图上传失败' };
  }
};

/**
 * 发布文章
 */
export const publishArticleHandler: ActionHandler = async (params, callbacks) => {
  const { asDraft = false } = params as { asDraft?: boolean };
  callbacks.onProgress?.({} as any, asDraft ? '正在保存草稿...' : '正在发布文章...');

  const buttonSelector = asDraft ? SELECTORS.saveDraftButton : SELECTORS.publishButton;
  const button = document.querySelector(buttonSelector) as HTMLElement;

  if (!button) {
    // 兼容新 UI：按钮可能不是 <button>，也可能在 role=button 的元素里
    const candidates = Array.from(
      document.querySelectorAll('button, [role="button"], a[role="link"]')
    ) as HTMLElement[];

    for (const el of candidates) {
      const text = (el.textContent || '').toLowerCase().trim();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase().trim();
      const merged = `${text} ${aria}`;

      const isDraftBtn = merged.includes('draft') || merged.includes('草稿') || merged.includes('保存') || merged.includes('save');
      const isPublishBtn = merged.includes('publish') || merged.includes('发布');

      if (asDraft && isDraftBtn) {
        el.click();
        await HumanBehaviorSimulator.randomDelay(2000, 3000);
        return { success: true };
      }
      if (!asDraft && isPublishBtn) {
        el.click();
        await HumanBehaviorSimulator.randomDelay(2000, 3000);
        return { success: true };
      }
    }

    // 文章编辑器通常会自动保存草稿；如果目标是草稿且当前仍在编辑页，视为成功。
    if (asDraft && window.location.pathname.includes('/compose/articles/edit/')) {
      return { success: true, data: { autoSaved: true } };
    }
    return { success: false, error: '发布按钮未找到' };
  }

  button.click();
  await HumanBehaviorSimulator.randomDelay(2000, 3000);

  return { success: true };
};

/**
 * 导出所有文章 handlers
 */
export const articleHandlers: Record<string, ActionHandler> = {
  open_article_editor: openArticleEditorHandler,
  fill_article_title: fillArticleTitleHandler,
  fill_article_body: fillArticleBodyHandler,
  upload_article_header_image: uploadArticleHeaderImageHandler,
  publish_article: publishArticleHandler,
};
