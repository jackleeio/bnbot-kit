/**
 * 微信公众号文章抓取服务 (MVP)
 * 通过网络请求抓取微信公众号文章内容
 */

export interface WechatArticle {
  title: string;
  account: string;
  publishTime: string;
  content: string;
  images: string[];  // 文章中的图片URL列表
  url: string;
}

/**
 * 后端要求的数据格式
 */
export interface WeChatArticleData {
  title: string;
  author?: string;
  account_name?: string;
  publish_time?: string;
  content: string;  // 正文，图片以 ![图片N](url) 格式嵌入
  cover_image?: string;
  original_url?: string;
}

/**
 * 从 HTML 中提取文本内容
 */
function extractText(html: string, selector: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const element = doc.querySelector(selector);
  return element?.textContent?.trim() || '';
}

/**
 * 从 HTML 中提取正文内容（包含图片占位符）
 */
function extractContent(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const contentEl = doc.querySelector('#js_content');

  if (!contentEl) return '';

  let imageIndex = 0;
  const result: string[] = [];

  // 递归遍历节点，保留文本和图片位置
  function processNode(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text && text.length > 0) {
        result.push(text);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;

      // 如果是图片，插入 Markdown 图片语法
      if (element.tagName === 'IMG') {
        let src = element.getAttribute('data-src') || element.getAttribute('src');
        if (src && src.includes('mmbiz.qpic.cn')) {
          src = src.replace(/&amp;/g, '&');
          imageIndex++;
          result.push(`\n![图片${imageIndex}](${src})\n`);
        }
        return;
      }

      // 块级元素前后添加换行
      const blockTags = ['P', 'DIV', 'SECTION', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
      if (blockTags.includes(element.tagName)) {
        result.push('\n');
      }

      // 递归处理子节点
      element.childNodes.forEach(child => processNode(child));

      if (blockTags.includes(element.tagName)) {
        result.push('\n');
      }
    }
  }

  processNode(contentEl);

  // 清理多余换行
  return result.join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 从 HTML 中提取图片 URL
 */
function extractImages(html: string): string[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const contentEl = doc.querySelector('#js_content');

  if (!contentEl) return [];

  const images: string[] = [];
  const imgElements = contentEl.querySelectorAll('img');

  imgElements.forEach(img => {
    // 微信图片优先使用 data-src，其次是 src
    let src = img.getAttribute('data-src') || img.getAttribute('src');

    if (src) {
      // 解码 HTML 实体 (如 &amp; -> &)
      src = src.replace(/&amp;/g, '&');

      // 只保留有效的图片 URL
      if (src.startsWith('http') && src.includes('mmbiz.qpic.cn')) {
        images.push(src);
      }
    }
  });

  // 去重
  return [...new Set(images)];
}

/**
 * 抓取微信公众号文章
 * @param url 微信文章链接
 */
export async function scrapeWechatArticle(url: string): Promise<WechatArticle | null> {
  console.log('[WeChat Scraper] 开始抓取:', url);

  try {
    // 通过 background script 发送请求（绕过 CORS）
    const response = await chrome.runtime.sendMessage({
      type: 'WECHAT_SCRAPE',
      url
    });

    if (!response.success) {
      console.error('[WeChat Scraper] 请求失败:', response.error);
      return null;
    }

    const html = response.data;

    // 解析 HTML 提取内容
    const article: WechatArticle = {
      title: extractText(html, '#activity-name'),
      account: extractText(html, '#js_name'),
      publishTime: extractText(html, '#publish_time'),
      content: extractContent(html),
      images: extractImages(html),
      url
    };

    // 检查是否成功提取
    if (!article.title) {
      console.log('[WeChat Scraper] 未能提取到文章标题');
      return null;
    }

    console.log('[WeChat Scraper] 抓取成功:', article.title);
    return article;

  } catch (error) {
    console.error('[WeChat Scraper] 抓取出错:', error);
    return null;
  }
}

/**
 * 测试抓取功能（在控制台调用）
 */
export async function testScrape(url: string): Promise<void> {
  const article = await scrapeWechatArticle(url);

  if (article) {
    console.log('='.repeat(60));
    console.log('[WeChat Scraper] 文章抓取成功!');
    console.log('='.repeat(60));
    console.log(`标题: ${article.title}`);
    console.log(`公众号: ${article.account}`);
    console.log(`发布时间: ${article.publishTime}`);
    console.log(`URL: ${article.url}`);
    console.log('-'.repeat(60));
    console.log('正文内容:');
    console.log('-'.repeat(60));
    console.log(article.content);
    console.log('='.repeat(60));
    console.log('[WeChat Scraper] JSON 格式:');
    console.log(JSON.stringify(article, null, 2));
  } else {
    console.log('[WeChat Scraper] 未能抓取到文章内容');
  }
}

// 暴露到 window 对象方便控制台测试
// 由于扩展运行在隔离环境，需要通过 CustomEvent 与页面通信
if (typeof window !== 'undefined') {
  // 内部使用
  (window as any).testWechatScrape = testScrape;
  (window as any).scrapeWechatArticle = scrapeWechatArticle;

  // 首先设置事件监听（在注入脚本之前）
  console.log('[WeChat Scraper] 设置事件监听器...');

  document.addEventListener('bnbot-wechat-scrape', async (event: any) => {
    const { url, requestId } = event.detail;
    console.log('[WeChat Scraper Content Script] 收到抓取请求:', url, 'requestId:', requestId);

    try {
      const article = await scrapeWechatArticle(url);
      console.log('[WeChat Scraper Content Script] 抓取完成，发送结果回页面');

      // 发送结果回页面
      document.dispatchEvent(new CustomEvent('bnbot-wechat-scrape-result', {
        detail: { requestId, article }
      }));
    } catch (error) {
      console.error('[WeChat Scraper Content Script] 抓取出错:', error);
      document.dispatchEvent(new CustomEvent('bnbot-wechat-scrape-result', {
        detail: { requestId, article: null }
      }));
    }
  });

  console.log('[WeChat Scraper] 事件监听器已设置');

  // 注入外部脚本文件（绕过 CSP 限制）
  const injectScript = () => {
    console.log('[WeChat Scraper] 注入页面脚本...');
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('wechat-scraper-inject.js');
    script.onload = () => {
      console.log('[WeChat Scraper] 页面脚本注入成功');
      script.remove();
    };
    script.onerror = (e) => {
      console.error('[WeChat Scraper] 页面脚本注入失败:', e);
    };
    (document.head || document.documentElement).appendChild(script);
  };

  // 等待 DOM 准备好再注入
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectScript);
  } else {
    injectScript();
  }
}

// ============================================
// 后端 API 相关函数
// ============================================

/**
 * 验证是否为有效的微信公众号文章链接
 */
export function isValidWechatUrl(url: string): boolean {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === 'mp.weixin.qq.com';
  } catch {
    return false;
  }
}

/**
 * 从 HTML 中提取作者名
 */
function extractAuthor(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // 尝试多个选择器
  const authorEl = doc.querySelector('#js_author_name') ||
                   doc.querySelector('.rich_media_meta_text');
  return authorEl?.textContent?.trim() || '';
}

/**
 * 从 HTML 中提取封面图
 */
function extractCoverImage(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // 尝试从 meta 标签获取
  const ogImage = doc.querySelector('meta[property="og:image"]');
  if (ogImage) {
    const content = ogImage.getAttribute('content');
    if (content) return content.replace(/&amp;/g, '&');
  }

  // 尝试从 twitter:image 获取
  const twitterImage = doc.querySelector('meta[name="twitter:image"]');
  if (twitterImage) {
    const content = twitterImage.getAttribute('content');
    if (content) return content.replace(/&amp;/g, '&');
  }

  return '';
}

/**
 * 提取 Markdown 格式内容（适配 Twitter/X 文章编辑器）
 * 保留标题、粗体、斜体、列表、图片等格式
 */
function extractMarkdownContent(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const contentEl = doc.querySelector('#js_content');

  if (!contentEl) return '';

  const result: string[] = [];
  let listDepth = 0;

  function processNode(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (text.trim().length > 0) {
        result.push(text);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      const tagName = element.tagName;

      // 处理图片
      if (tagName === 'IMG') {
        let src = element.getAttribute('data-src') || element.getAttribute('src');
        if (src && src.includes('mmbiz.qpic.cn')) {
          src = src.replace(/&amp;/g, '&');
          result.push(`\n\n![image](${src})\n\n`);
        }
        return;
      }

      // 处理标题
      if (tagName === 'H1') {
        result.push('\n\n# ');
        element.childNodes.forEach(child => processNode(child));
        result.push('\n\n');
        return;
      }
      if (tagName === 'H2') {
        result.push('\n\n## ');
        element.childNodes.forEach(child => processNode(child));
        result.push('\n\n');
        return;
      }
      if (tagName === 'H3') {
        result.push('\n\n### ');
        element.childNodes.forEach(child => processNode(child));
        result.push('\n\n');
        return;
      }
      if (tagName === 'H4' || tagName === 'H5' || tagName === 'H6') {
        result.push('\n\n#### ');
        element.childNodes.forEach(child => processNode(child));
        result.push('\n\n');
        return;
      }

      // 处理粗体
      if (tagName === 'STRONG' || tagName === 'B') {
        result.push('**');
        element.childNodes.forEach(child => processNode(child));
        result.push('**');
        return;
      }

      // 处理斜体
      if (tagName === 'EM' || tagName === 'I') {
        result.push('*');
        element.childNodes.forEach(child => processNode(child));
        result.push('*');
        return;
      }

      // 处理删除线
      if (tagName === 'DEL' || tagName === 'S' || tagName === 'STRIKE') {
        result.push('~~');
        element.childNodes.forEach(child => processNode(child));
        result.push('~~');
        return;
      }

      // 处理代码
      if (tagName === 'CODE') {
        result.push('`');
        element.childNodes.forEach(child => processNode(child));
        result.push('`');
        return;
      }

      // 处理预格式化/代码块
      if (tagName === 'PRE') {
        result.push('\n\n```\n');
        element.childNodes.forEach(child => processNode(child));
        result.push('\n```\n\n');
        return;
      }

      // 处理引用
      if (tagName === 'BLOCKQUOTE') {
        result.push('\n\n> ');
        element.childNodes.forEach(child => processNode(child));
        result.push('\n\n');
        return;
      }

      // 处理无序列表
      if (tagName === 'UL') {
        result.push('\n');
        listDepth++;
        element.childNodes.forEach(child => processNode(child));
        listDepth--;
        result.push('\n');
        return;
      }

      // 处理有序列表
      if (tagName === 'OL') {
        result.push('\n');
        listDepth++;
        let index = 1;
        element.childNodes.forEach(child => {
          if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName === 'LI') {
            const indent = '  '.repeat(listDepth - 1);
            result.push(`${indent}${index}. `);
            (child as Element).childNodes.forEach(c => processNode(c));
            result.push('\n');
            index++;
          }
        });
        listDepth--;
        result.push('\n');
        return;
      }

      // 处理列表项（用于无序列表）
      if (tagName === 'LI' && element.parentElement?.tagName === 'UL') {
        const indent = '  '.repeat(listDepth - 1);
        result.push(`${indent}- `);
        element.childNodes.forEach(child => processNode(child));
        result.push('\n');
        return;
      }

      // 处理链接
      if (tagName === 'A') {
        const href = element.getAttribute('href');
        if (href) {
          result.push('[');
          element.childNodes.forEach(child => processNode(child));
          result.push(`](${href})`);
        } else {
          element.childNodes.forEach(child => processNode(child));
        }
        return;
      }

      // 处理换行
      if (tagName === 'BR') {
        result.push('\n');
        return;
      }

      // 处理段落
      if (tagName === 'P') {
        result.push('\n\n');
        element.childNodes.forEach(child => processNode(child));
        result.push('\n\n');
        return;
      }

      // 处理 div 和 section（块级元素）
      if (tagName === 'DIV' || tagName === 'SECTION') {
        result.push('\n');
        element.childNodes.forEach(child => processNode(child));
        result.push('\n');
        return;
      }

      // 处理 span（内联元素，检查样式）
      if (tagName === 'SPAN') {
        const style = element.getAttribute('style') || '';
        const isBold = style.includes('font-weight') && (style.includes('bold') || style.includes('700'));
        const isItalic = style.includes('font-style') && style.includes('italic');

        if (isBold) result.push('**');
        if (isItalic) result.push('*');
        element.childNodes.forEach(child => processNode(child));
        if (isItalic) result.push('*');
        if (isBold) result.push('**');
        return;
      }

      // 默认处理：递归处理子节点
      element.childNodes.forEach(child => processNode(child));
    }
  }

  processNode(contentEl);

  // 清理多余的换行和空白
  return result.join('')
    .replace(/\n{4,}/g, '\n\n\n')  // 最多保留三个换行
    .replace(/^\n+/, '')  // 去掉开头的换行
    .replace(/\n+$/, '')  // 去掉结尾的换行
    .trim();
}

/**
 * 提取纯文本内容（不含图片占位符）
 */
function extractPlainTextContent(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const contentEl = doc.querySelector('#js_content');

  if (!contentEl) return '';

  const result: string[] = [];

  function processNode(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text && text.length > 0) {
        result.push(text);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;

      // 跳过图片
      if (element.tagName === 'IMG') {
        return;
      }

      // 块级元素前后添加换行
      const blockTags = ['P', 'DIV', 'SECTION', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
      if (blockTags.includes(element.tagName)) {
        result.push('\n');
      }

      element.childNodes.forEach(child => processNode(child));

      if (blockTags.includes(element.tagName)) {
        result.push('\n');
      }
    }
  }

  processNode(contentEl);

  return result.join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 检查文章错误状态
 */
function checkArticleErrors(html: string): string | null {
  // 检查文章是否被删除
  if (html.includes('该内容已被发布者删除') ||
      html.includes('此内容因违规无法查看') ||
      html.includes('该公众号已被封禁')) {
    return '文章已被删除或不存在';
  }

  // 检查是否需要登录
  if (html.includes('环境异常') ||
      html.includes('请在微信客户端打开') ||
      html.includes('请在手机点击确认登录')) {
    return '该文章需要在微信客户端中打开';
  }

  // 检查是否是付费内容
  if (html.includes('付费内容') && html.includes('订阅后可阅读')) {
    return '该文章为付费内容，无法抓取';
  }

  return null;
}

/**
 * 为后端 API 抓取微信公众号文章
 * 返回后端要求的数据格式（Markdown 格式）
 * @param url 微信公众号文章链接
 */
export async function scrapeWechatArticleForBackend(url: string): Promise<WeChatArticleData | null> {
  console.log('[WeChat Scraper] 为后端抓取文章:', url);

  // 验证 URL
  if (!isValidWechatUrl(url)) {
    console.error('[WeChat Scraper] 不是有效的微信公众号文章链接');
    throw new Error('不是有效的微信公众号文章链接');
  }

  try {
    // 通过 background script 发送请求（绕过 CORS）
    const response = await chrome.runtime.sendMessage({
      type: 'WECHAT_SCRAPE',
      url
    });

    if (!response.success) {
      console.error('[WeChat Scraper] 请求失败:', response.error);
      throw new Error(`网络请求失败: ${response.error}`);
    }

    const html = response.data;

    // 检查错误状态
    const errorMessage = checkArticleErrors(html);
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    // 提取标题
    const title = extractText(html, '#activity-name');
    if (!title) {
      throw new Error('无法获取文章标题');
    }

    // 提取正文（在原文位置保留图片占位符）
    const content = extractContent(html);
    if (!content) {
      throw new Error('无法获取文章内容');
    }

    // 构建后端要求的数据格式
    const articleData: WeChatArticleData = {
      title,
      author: extractAuthor(html) || undefined,
      account_name: extractText(html, '#js_name') || undefined,
      publish_time: extractText(html, '#publish_time') || undefined,
      content,
      cover_image: extractCoverImage(html) || undefined,
      original_url: url
    };

    console.log('[WeChat Scraper] 后端数据抓取成功:', articleData.title);
    return articleData;

  } catch (error) {
    console.error('[WeChat Scraper] 抓取出错:', error);
    throw error;
  }
}
