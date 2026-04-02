// TikTok 视频抓取函数 - 注入到页面全局作用域
window.tiktok = function(url) {
  console.log('🎵 正在获取 TikTok 视频信息...');

  return new Promise((resolve) => {
    const requestId = Date.now().toString();

    const handler = (event) => {
      if (event.detail.requestId === requestId) {
        document.removeEventListener('bnbot-tiktok-result', handler);
        const info = event.detail.info;

        if (info) {
          console.log('\n✅ 获取成功!\n');
          console.log('📹 视频标题:', info.title);
          console.log('👤 作者:', info.author);
          console.log('⏱️ 时长:', info.duration, '秒');
          console.log('👁️ 播放:', info.playCount?.toLocaleString() || 0);
          console.log('❤️ 点赞:', info.likeCount?.toLocaleString() || 0);
          console.log('💬 评论:', info.commentCount?.toLocaleString() || 0);
          console.log('🔗 分享:', info.shareCount?.toLocaleString() || 0);
          console.log('\n🎬 视频链接（无水印）:');
          console.log(info.videoUrl);
          console.log('\n🎵 音乐链接:');
          console.log(info.musicUrl);
          console.log('\n🖼️ 封面链接:');
          console.log(info.coverUrl);
          console.log('\n📦 完整数据对象:');
          console.log(info);
        } else {
          console.log('❌ 获取失败');
        }
        resolve(info);
      }
    };

    document.addEventListener('bnbot-tiktok-result', handler);
    document.dispatchEvent(new CustomEvent('bnbot-tiktok-fetch', {
      detail: { url, requestId }
    }));
  });
};

console.log('[BNBot] tiktok() 函数已加载，在控制台输入 tiktok("链接") 获取视频');
