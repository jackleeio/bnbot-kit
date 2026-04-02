// TikTok Service - 获取 TikTok 视频信息
// 按照后端 API 文档格式提供数据

/**
 * TikTok 视频数据结构 - 匹配后端 API 要求
 */
export interface TikTokVideoData {
  // 基本信息
  video_id: string;                    // 视频 ID
  video_url: string;                   // 视频下载链接（带水印）
  video_url_no_watermark?: string;     // 无水印视频链接（如能提取）
  thumbnail: string;                   // 视频封面图 URL
  duration: number;                    // 视频时长（秒）

  // 内容
  description: string;                 // 视频描述/文案
  hashtags: string[];                  // 标签列表（不含 #）

  // 作者信息
  author: {
    username: string;                  // @用户名
    display_name: string;              // 显示名称
    avatar: string;                    // 头像 URL
    verified: boolean;                 // 是否认证账号
  };

  // 音乐信息
  music: {
    title: string;                     // 音乐标题
    author: string;                    // 音乐作者
    original: boolean;                 // 是否原创音频
  };

  // 统计数据
  stats: {
    likes: number;
    comments: number;
    shares: number;
    views: number;
  };

  // 元数据
  original_url: string;                // 原始 TikTok URL
}

/**
 * 旧版接口（保持向后兼容）
 */
export interface TiktokVideoInfo {
  title: string;
  author: string;
  videoUrl: string;
  musicUrl: string;
  coverUrl: string;
  duration: number;
  playCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
}

/**
 * TikTok URL 格式正则表达式
 */
const TIKTOK_URL_PATTERNS = [
  /^https?:\/\/(www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/,
  /^https?:\/\/vm\.tiktok\.com\/\w+/,
  /^https?:\/\/(www\.)?tiktok\.com\/t\/\w+/,
  /^https?:\/\/m\.tiktok\.com\/v\/\d+/,
];

/**
 * 检查是否为有效的 TikTok URL
 */
export function isTikTokUrl(url: string): boolean {
  return TIKTOK_URL_PATTERNS.some(pattern => pattern.test(url));
}

/**
 * 从 URL 提取视频 ID
 */
export function extractVideoId(url: string): string | null {
  const match = url.match(/\/video\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * 获取 TikTok 视频信息（旧版 API，保持兼容）
 * @param url TikTok 视频链接
 * @returns 视频信息
 */
export async function fetchTiktokVideo(url: string): Promise<TiktokVideoInfo> {
  const response = await chrome.runtime.sendMessage({
    type: 'TIKTOK_FETCH',
    url,
  });

  if (!response.success) {
    throw new Error(response.error || '获取 TikTok 视频失败');
  }

  return response.data;
}

/**
 * 获取 TikTok 视频数据（新版 API，符合后端文档格式）
 * @param url TikTok 视频链接
 * @returns 符合后端 API 格式的视频数据
 */
export async function fetchTikTokVideoData(url: string): Promise<TikTokVideoData> {
  console.log('[TikTok Service] 获取视频数据:', url);

  const response = await chrome.runtime.sendMessage({
    type: 'TIKTOK_FETCH_V2',
    url,
  });

  if (!response.success) {
    throw new Error(response.error || '获取 TikTok 视频失败');
  }

  return response.data;
}

/**
 * 下载 TikTok 视频（返回 base64 data URL）
 * @param videoUrl 视频直链
 * @returns base64 data URL
 */
export async function downloadTiktokVideo(videoUrl: string): Promise<string> {
  const response = await chrome.runtime.sendMessage({
    type: 'FETCH_VIDEO',
    url: videoUrl,
  });

  if (response.error) {
    throw new Error(response.error);
  }

  return response.blobUrl;
}

/**
 * 通过 Port 下载视频（支持进度回调）
 * @param videoUrl 视频直链
 * @param onProgress 进度回调
 * @returns Blob
 */
export async function downloadTikTokVideoWithProgress(
  videoUrl: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'DOWNLOAD_PORT' });
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    let loadedSize = 0;

    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case 'DOWNLOAD_START':
          totalSize = msg.total || 0;
          console.log('[TikTok Service] 开始下载，大小:', totalSize);
          break;
        case 'DOWNLOAD_CHUNK':
          const chunk = new Uint8Array(msg.chunk);
          chunks.push(chunk);
          loadedSize += chunk.length;
          onProgress?.(loadedSize, totalSize);
          break;
        case 'DOWNLOAD_END':
          console.log('[TikTok Service] 下载完成');
          const blob = new Blob(chunks, { type: 'video/mp4' });
          port.disconnect();
          resolve(blob);
          break;
        case 'DOWNLOAD_ERROR':
          console.error('[TikTok Service] 下载失败:', msg.error);
          port.disconnect();
          reject(new Error(msg.error));
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      if (chunks.length === 0) {
        reject(new Error('连接断开'));
      }
    });

    port.postMessage({ type: 'START_DOWNLOAD', url: videoUrl });
  });
}

/**
 * 将旧版 TiktokVideoInfo 转换为新版 TikTokVideoData 格式
 */
export function convertToVideoData(info: TiktokVideoInfo, originalUrl: string): TikTokVideoData {
  // 从 URL 提取视频 ID
  const videoId = extractVideoId(originalUrl) || '';

  // 从描述中提取 hashtags
  const hashtagMatches = info.title.match(/#(\w+)/g) || [];
  const hashtags = hashtagMatches.map(tag => tag.replace('#', ''));

  return {
    video_id: videoId,
    video_url: info.videoUrl,
    video_url_no_watermark: undefined, // 旧版不支持
    thumbnail: info.coverUrl,
    duration: info.duration,
    description: info.title,
    hashtags,
    author: {
      username: info.author,
      display_name: info.author,
      avatar: '',
      verified: false,
    },
    music: {
      title: 'Original Sound',
      author: info.author,
      original: true,
    },
    stats: {
      likes: info.likeCount,
      comments: info.commentCount,
      shares: info.shareCount,
      views: info.playCount,
    },
    original_url: originalUrl,
  };
}

// ========== 页面脚本注入（暴露到控制台） ==========

if (typeof window !== 'undefined') {
  console.log('[TikTok Service] 设置事件监听器...');

  // 监听来自页面脚本的请求
  document.addEventListener('bnbot-tiktok-fetch', async (event: any) => {
    const { url, requestId } = event.detail;
    console.log('[TikTok Service] 收到抓取请求:', url);

    try {
      const info = await fetchTiktokVideo(url);
      console.log('[TikTok Service] 抓取完成');

      // 发送结果回页面
      document.dispatchEvent(new CustomEvent('bnbot-tiktok-result', {
        detail: { requestId, info }
      }));
    } catch (error) {
      console.error('[TikTok Service] 抓取出错:', error);
      document.dispatchEvent(new CustomEvent('bnbot-tiktok-result', {
        detail: { requestId, info: null }
      }));
    }
  });

  // 注入页面脚本
  const injectScript = () => {
    console.log('[TikTok Service] 注入页面脚本...');
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('tiktok-inject.js');
    script.onload = () => {
      console.log('[TikTok Service] 页面脚本注入成功');
      script.remove();
    };
    script.onerror = (e) => {
      console.error('[TikTok Service] 页面脚本注入失败:', e);
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
