/**
 * TikTok Video Actions
 * TikTok 视频相关的 Action Handlers
 */

import { ActionHandler } from '../../types/action';
import { fetchTikTokVideoData, isTikTokUrl, TikTokVideoData } from '../tiktokService';
import videoCacheService from '../videoCacheService';

const FETCH_TIMEOUT = 30000;

/**
 * 获取 TikTok 视频数据
 * 对接后端 fetch_tiktok_video interrupt 流程
 * 返回符合后端 API 格式的视频数据
 */
export const fetchTiktokVideoHandler: ActionHandler = async (params, callbacks, context) => {
  const { url } = params as { url: string };

  console.log('[TiktokActions] fetch_tiktok_video 开始执行, url:', url);

  // 参数验证
  if (!url) {
    console.error('[TiktokActions] 缺少视频 URL 参数');
    return {
      success: false,
      error: '缺少视频 URL 参数'
    };
  }

  // URL 格式验证
  if (!isTikTokUrl(url)) {
    console.error('[TiktokActions] 不是有效的 TikTok 视频链接:', url);
    return {
      success: false,
      error: '不是有效的 TikTok 视频链接'
    };
  }

  // 通知进度
  callbacks.onProgress?.(context, '正在获取 TikTok 视频信息...');

  try {
    // 带超时的获取逻辑
    const fetchPromise = fetchTikTokVideoData(url);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('获取超时（30秒）')), FETCH_TIMEOUT);
    });

    const videoData = await Promise.race([fetchPromise, timeoutPromise]);

    if (!videoData) {
      console.error('[TiktokActions] 获取返回空数据');
      return {
        success: false,
        error: '无法获取视频信息'
      };
    }

    // 验证必需字段
    if (!videoData.video_url) {
      console.error('[TiktokActions] 视频链接为空');
      return {
        success: false,
        error: '无法获取视频下载链接'
      };
    }

    console.log('[TiktokActions] 获取成功:', videoData.description?.substring(0, 50) || videoData.video_id);
    callbacks.onProgress?.(context, `已获取视频: ${videoData.author?.display_name || videoData.author?.username || '未知作者'}`);

    // 下载视频并转为 base64
    if (videoData.video_url) {
      console.log('[TiktokActions] 开始下载视频...');
      callbacks.onProgress?.(context, '正在下载视频...');
      try {
        const blobUrl = await videoCacheService.preload(videoData.video_url);
        console.log('[TiktokActions] 视频下载完成, blobUrl:', blobUrl);
        callbacks.onProgress?.(context, '视频下载完成，正在转码...');

        // 将 blob URL 转为 base64
        const response = await fetch(blobUrl);
        const blob = await response.blob();
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            // 去掉 data:video/mp4;base64, 前缀
            const base64Data = result.split(',')[1] || result;
            resolve(base64Data);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        videoData.video_base64 = base64;
        videoData.video_size = blob.size;
        console.log('[TiktokActions] 视频转码完成, size:', blob.size);
      } catch (err) {
        console.warn('[TiktokActions] 视频下载失败:', err);
        // 下载失败不影响整体返回，video_url 仍然可用
      }
    }

    return {
      success: true,
      data: videoData
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '获取失败';
    console.error('[TiktokActions] 获取出错:', errorMessage);

    return {
      success: false,
      error: errorMessage
    };
  }
};

/**
 * 导出所有 TikTok 相关的 handlers
 */
export const tiktokHandlers: Record<string, ActionHandler> = {
  fetch_tiktok_video: fetchTiktokVideoHandler,
};
