/**
 * WeChat Article Actions
 * 微信公众号文章相关的 Action Handlers
 */

import { ActionHandler } from '../../types/action';
import { scrapeWechatArticleForBackend, isValidWechatUrl } from '../wechatScraperService';

const SCRAPE_TIMEOUT = 30000;

/**
 * 抓取微信公众号文章
 * 对接后端 fetch_wechat_article interrupt 流程
 * 返回 Markdown 格式内容，由后端根据用户提示词决定是保留原文还是二次创作
 */
export const fetchWechatArticleHandler: ActionHandler = async (params, callbacks, context) => {
  const { url } = params as { url: string };

  console.log('[WechatActions] fetch_wechat_article 开始执行, url:', url);

  // 参数验证
  if (!url) {
    console.error('[WechatActions] 缺少文章 URL 参数');
    return {
      success: false,
      error: '缺少文章 URL 参数'
    };
  }

  // URL 格式验证
  if (!isValidWechatUrl(url)) {
    console.error('[WechatActions] 不是有效的微信公众号文章链接:', url);
    return {
      success: false,
      error: '不是有效的微信公众号文章链接'
    };
  }

  // 通知进度
  callbacks.onProgress?.(context, '正在抓取微信公众号文章...');

  try {
    // 带超时的抓取逻辑
    const scrapePromise = scrapeWechatArticleForBackend(url);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('抓取超时（30秒）')), SCRAPE_TIMEOUT);
    });

    const articleData = await Promise.race([scrapePromise, timeoutPromise]);

    if (!articleData) {
      console.error('[WechatActions] 抓取返回空数据');
      return {
        success: false,
        error: '无法获取文章内容'
      };
    }

    console.log('[WechatActions] 抓取成功:', articleData.title);
    callbacks.onProgress?.(context, `已抓取: ${articleData.title}`);

    return {
      success: true,
      data: articleData
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '抓取失败';
    console.error('[WechatActions] 抓取出错:', errorMessage);

    return {
      success: false,
      error: errorMessage
    };
  }
};

/**
 * 导出所有微信相关的 handlers
 */
export const wechatHandlers: Record<string, ActionHandler> = {
  fetch_wechat_article: fetchWechatArticleHandler,
};
