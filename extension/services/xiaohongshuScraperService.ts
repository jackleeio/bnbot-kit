/**
 * 小红书笔记抓取服务
 * 通过打开小红书页面，从 __INITIAL_STATE__ 提取笔记数据
 */

export interface XiaohongshuNote {
  noteId: string;
  title: string;
  desc: string;
  type: 'normal' | 'video';
  author: string;
  authorAvatar?: string;
  likeCount: string;
  collectCount: string;
  commentCount: string;
  shareCount?: string;
  images: string[];
  video?: {
    url: string;
    duration: number;
  };
  tags: string[];
  ipLocation?: string;
  publishTime?: number;
  url: string;
}

/**
 * 验证是否为有效的小红书笔记链接
 */
export function isValidXiaohongshuUrl(url: string): boolean {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === 'www.xiaohongshu.com' &&
           (urlObj.pathname.includes('/explore/') || urlObj.pathname.includes('/discovery/item/'));
  } catch {
    return false;
  }
}

/**
 * 从 URL 中提取笔记 ID
 */
export function extractNoteId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    // https://www.xiaohongshu.com/explore/6982e713000000002801dd37
    const match = urlObj.pathname.match(/\/explore\/([a-f0-9]+)/);
    if (match) return match[1];

    // https://www.xiaohongshu.com/discovery/item/6982e713000000002801dd37
    const match2 = urlObj.pathname.match(/\/discovery\/item\/([a-f0-9]+)/);
    if (match2) return match2[1];

    return null;
  } catch {
    return null;
  }
}

/**
 * 从页面 __INITIAL_STATE__ 提取笔记数据的脚本
 * 这个脚本会被注入到小红书页面执行
 */
export const extractNoteScript = `
(function() {
  try {
    const state = window.__INITIAL_STATE__;
    if (!state || !state.note || !state.note.noteDetailMap) {
      return { success: false, error: '无法找到笔记数据' };
    }

    const noteId = Object.keys(state.note.noteDetailMap)[0];
    if (!noteId) {
      return { success: false, error: '笔记 ID 不存在' };
    }

    const noteDetail = state.note.noteDetailMap[noteId];
    const note = noteDetail?.note;
    if (!note) {
      return { success: false, error: '笔记内容不存在' };
    }

    // 提取标签
    const tags = (note.tagList || []).map(tag => tag.name).filter(Boolean);

    // 提取图片
    const images = (note.imageList || []).map(img => img.urlDefault).filter(Boolean);

    // 提取视频
    let video = null;
    if (note.video && note.video.media) {
      const streams = note.video.media.stream;
      // 优先使用 h264，兼容性更好
      const h264 = streams?.h264?.[0];
      const h265 = streams?.h265?.[0];
      const stream = h264 || h265;
      if (stream) {
        video = {
          url: stream.masterUrl,
          duration: note.video.capa?.duration || stream.duration / 1000
        };
      }
    }

    return {
      success: true,
      data: {
        noteId: note.noteId,
        title: note.title || '',
        desc: note.desc || '',
        type: note.type || 'normal',
        author: note.user?.nickname || '',
        authorAvatar: note.user?.avatar || '',
        likeCount: note.interactInfo?.likedCount || '0',
        collectCount: note.interactInfo?.collectedCount || '0',
        commentCount: note.interactInfo?.commentCount || '0',
        shareCount: note.interactInfo?.shareCount || '0',
        images: images,
        video: video,
        tags: tags,
        ipLocation: note.ipLocation || '',
        publishTime: note.time || null
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
})();
`;

/**
 * 抓取小红书笔记
 * @param url 小红书笔记链接
 */
export async function scrapeXiaohongshuNote(url: string): Promise<XiaohongshuNote | null> {
  console.log('[Xiaohongshu Scraper] 开始抓取:', url);

  // 验证 URL
  if (!isValidXiaohongshuUrl(url)) {
    console.error('[Xiaohongshu Scraper] 不是有效的小红书笔记链接');
    throw new Error('不是有效的小红书笔记链接');
  }

  try {
    // 通过 background script 打开页面并提取数据
    const response = await chrome.runtime.sendMessage({
      type: 'XIAOHONGSHU_SCRAPE',
      url
    });

    if (!response.success) {
      console.error('[Xiaohongshu Scraper] 抓取失败:', response.error);
      throw new Error(response.error || '抓取失败');
    }

    const note: XiaohongshuNote = {
      ...response.data,
      url
    };

    console.log('[Xiaohongshu Scraper] 抓取成功:', note.title);
    return note;

  } catch (error) {
    console.error('[Xiaohongshu Scraper] 抓取出错:', error);
    throw error;
  }
}

/**
 * 测试抓取功能（在控制台调用）
 */
export async function testScrape(url: string): Promise<void> {
  try {
    const note = await scrapeXiaohongshuNote(url);

    if (note) {
      console.log('='.repeat(60));
      console.log('[Xiaohongshu Scraper] 笔记抓取成功!');
      console.log('='.repeat(60));
      console.log(`标题: ${note.title}`);
      console.log(`作者: ${note.author}`);
      console.log(`类型: ${note.type}`);
      console.log(`点赞: ${note.likeCount}`);
      console.log(`收藏: ${note.collectCount}`);
      console.log(`评论: ${note.commentCount}`);
      console.log('-'.repeat(60));
      console.log('描述:');
      console.log(note.desc);
      console.log('-'.repeat(60));
      console.log(`图片数量: ${note.images.length}`);
      if (note.images.length > 0) {
        console.log('图片列表:');
        note.images.forEach((img, i) => console.log(`  [${i + 1}] ${img}`));
      }
      if (note.video) {
        console.log('-'.repeat(60));
        console.log(`视频时长: ${note.video.duration}秒`);
        console.log(`视频链接: ${note.video.url}`);
      }
      console.log('='.repeat(60));
    }
  } catch (error) {
    console.error('[Xiaohongshu Scraper] 测试失败:', error);
  }
}

// 暴露到 window 对象方便控制台测试
if (typeof window !== 'undefined') {
  (window as any).testXiaohongshuScrape = testScrape;
  (window as any).scrapeXiaohongshuNote = scrapeXiaohongshuNote;
}
