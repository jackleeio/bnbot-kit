// 小红书笔记抓取函数 - 注入到页面全局作用域
window.xiaohongshu = function(url) {
  console.log('📕 正在获取小红书笔记信息...');

  return new Promise((resolve) => {
    const requestId = Date.now().toString();

    const handler = (event) => {
      if (event.detail.requestId === requestId) {
        document.removeEventListener('bnbot-xiaohongshu-result', handler);
        const info = event.detail.info;

        if (info) {
          console.log('\n✅ 获取成功!\n');
          console.log('📝 标题:', info.title);
          console.log('👤 作者:', info.author);
          console.log('📌 类型:', info.type === 'video' ? '视频' : '图文');
          console.log('❤️ 点赞:', info.likeCount);
          console.log('⭐ 收藏:', info.collectCount);
          console.log('💬 评论:', info.commentCount);
          console.log('\n📝 描述:');
          console.log(info.desc);
          if (info.images && info.images.length > 0) {
            console.log('\n🖼️ 图片数量:', info.images.length);
            info.images.forEach((img, i) => console.log(`  [${i + 1}] ${img}`));
          }
          if (info.video) {
            console.log('\n🎬 视频时长:', info.video.duration, '秒');
            console.log('🔗 视频链接:', info.video.url);
          }
          console.log('\n📦 完整数据对象:');
          console.log(info);
        } else {
          console.log('❌ 获取失败');
        }
        resolve(info);
      }
    };

    document.addEventListener('bnbot-xiaohongshu-result', handler);
    document.dispatchEvent(new CustomEvent('bnbot-xiaohongshu-fetch', {
      detail: { url, requestId }
    }));
  });
};

console.log('[BNBot] xiaohongshu() 函数已加载，在控制台输入 xiaohongshu("链接") 获取笔记');
