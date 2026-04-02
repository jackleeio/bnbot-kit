/**
 * Xiaohongshu Note Actions
 * 小红书笔记相关的 Action Handlers
 */

import { ActionHandler } from '../../types/action';

const SCRAPE_TIMEOUT = 30000;

function isValidXiaohongshuUrl(url: string): boolean {
  if (!url) return false;
  return url.includes('xiaohongshu.com') || url.includes('xhslink.com');
}

/**
 * 抓取小红书笔记
 * 对接后端 fetch_xiaohongshu_note interrupt 流程
 * 通过 background script 抓取笔记数据，返回给后端处理
 */
export const fetchXiaohongshuNoteHandler: ActionHandler = async (params, callbacks, context) => {
  const { url } = params as { url: string };

  console.log('[XiaohongshuActions] fetch_xiaohongshu_note 开始执行, url:', url);

  // 参数验证
  if (!url) {
    console.error('[XiaohongshuActions] 缺少笔记 URL 参数');
    return {
      success: false,
      error: '缺少笔记 URL 参数'
    };
  }

  // URL 格式验证
  if (!isValidXiaohongshuUrl(url)) {
    console.error('[XiaohongshuActions] 不是有效的小红书笔记链接:', url);
    return {
      success: false,
      error: '不是有效的小红书笔记链接'
    };
  }

  // 通知进度
  callbacks.onProgress?.(context, '正在抓取小红书笔记...');

  try {
    // 通过 background script 抓取
    const scrapePromise = new Promise<any>((resolve) => {
      chrome.runtime.sendMessage({ type: 'XIAOHONGSHU_SCRAPE', url }, resolve);
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('抓取超时（30秒）')), SCRAPE_TIMEOUT);
    });

    const response = await Promise.race([scrapePromise, timeoutPromise]);

    if (!response?.success || !response?.data) {
      console.error('[XiaohongshuActions] 抓取失败:', response?.error);
      return {
        success: false,
        error: response?.error || '小红书内容抓取失败，请确保链接包含 xsec_token 参数。'
      };
    }

    const note = response.data;
    console.log('[XiaohongshuActions] 抓取成功:', note.title || note.desc?.substring(0, 30));
    callbacks.onProgress?.(context, `已抓取: ${note.title || '小红书笔记'}`);

    // 存储代理后的图片到 window 供前端显示（base64 data URLs）
    if (note.proxiedImages || note.images) {
      (window as any).__bnbotXiaohongshuMedia = {
        images: note.proxiedImages || note.images || [],
        video: note.video || null,
        noteId: note.noteId
      };
    }

    // 返回给后端的数据（使用原始 URL，不传 base64）
    return {
      success: true,
      data: {
        noteId: note.noteId,
        title: note.title || '',
        desc: note.desc || '',
        type: note.type || 'normal',
        author: note.author || '',
        likeCount: note.likeCount || '0',
        collectCount: note.collectCount || '0',
        commentCount: note.commentCount || '0',
        shareCount: note.shareCount || '0',
        images: note.images || [],  // original URLs for backend
        video: note.video || null,
        tags: note.tags || [],
        ipLocation: note.ipLocation || '',
        publishTime: note.publishTime || null
      }
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '抓取失败';
    console.error('[XiaohongshuActions] 抓取出错:', errorMessage);

    return {
      success: false,
      error: errorMessage
    };
  }
};

/**
 * 导出所有小红书相关的 handlers
 */
export const xiaohongshuHandlers: Record<string, ActionHandler> = {
  fetch_xiaohongshu_note: fetchXiaohongshuNoteHandler,
};
