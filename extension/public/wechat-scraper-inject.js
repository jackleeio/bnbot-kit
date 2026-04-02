// 微信文章抓取测试函数 - 注入到页面全局作用域
window.testWechatScrape = function(url) {
  return new Promise((resolve) => {
    const requestId = Date.now().toString();

    const handler = (event) => {
      if (event.detail.requestId === requestId) {
        document.removeEventListener('bnbot-wechat-scrape-result', handler);
        const article = event.detail.article;

        if (article) {
          console.log('='.repeat(60));
          console.log('[WeChat Scraper] 文章抓取成功!');
          console.log('='.repeat(60));
          console.log('标题:', article.title);
          console.log('公众号:', article.account);
          console.log('发布时间:', article.publishTime);
          console.log('URL:', article.url);
          console.log('-'.repeat(60));
          console.log('图片数量:', article.images?.length || 0);
          if (article.images && article.images.length > 0) {
            console.log('图片列表:');
            article.images.forEach((img, i) => console.log(`  [${i + 1}] ${img}`));
          }
          console.log('-'.repeat(60));
          console.log('正文内容:');
          console.log('-'.repeat(60));
          console.log(article.content);
          console.log('='.repeat(60));
        } else {
          console.log('[WeChat Scraper] 未能抓取到文章内容');
        }
        resolve(article);
      }
    };

    document.addEventListener('bnbot-wechat-scrape-result', handler);
    document.dispatchEvent(new CustomEvent('bnbot-wechat-scrape', {
      detail: { url, requestId }
    }));
  });
};

console.log('[WeChat Scraper] testWechatScrape 函数已注入，可在控制台使用');
