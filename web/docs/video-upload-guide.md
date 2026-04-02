# 视频上传使用指南

## 快速开始

### 1. 安装依赖

首先安装 AWS SDK（用于 R2 上传）：

```bash
pnpm add @aws-sdk/client-s3 dotenv
```

### 2. 配置环境变量

按照 `docs/cloudflare-r2-setup.md` 完成 Cloudflare R2 配置后，在 `.env.local` 文件中添加：

```env
CLOUDFLARE_ACCOUNT_ID=你的账户ID
CLOUDFLARE_R2_ACCESS_KEY_ID=你的Access Key
CLOUDFLARE_R2_SECRET_ACCESS_KEY=你的Secret Key
CLOUDFLARE_R2_BUCKET_NAME=bnbot-videos
CLOUDFLARE_R2_PUBLIC_URL=https://pub-xxxxx.r2.dev
```

### 3. 上传视频

使用上传脚本上传你录制的视频：

```bash
node scripts/upload-video.js ./path/to/your-video.mp4
```

上传成功后，脚本会输出视频的公开 URL，例如：
```
https://pub-xxxxx.r2.dev/videos/your-video.mp4
```

### 4. 在首页使用视频

首页的视频配置在 `src/app/(modern)/page.tsx` 文件中。

找到 `FeatureTabs` 组件的 `tabs` 配置，将 `videoSrc` 替换为你上传的视频 URL：

```typescript
const tabs = [
  {
    id: 'feature-1',
    title: '功能标题',
    description: '功能描述',
    longDescription: '详细描述',
    icon: SomeIcon,
    videoSrc: 'https://pub-xxxxx.r2.dev/videos/your-video.mp4', // 替换这里
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
  // ... 其他功能
];
```

## 视频优化建议

### 推荐的视频格式
- **格式**: MP4 (H.264 编码)
- **分辨率**: 1920x1080 或 1280x720
- **帧率**: 30fps
- **码率**: 2-5 Mbps

### 压缩视频
为了加快加载速度，建议压缩视频：

使用 FFmpeg 压缩（如果已安装）：
```bash
ffmpeg -i input.mp4 -c:v libx264 -crf 28 -preset medium -c:a aac -b:a 128k output.mp4
```

或使用在线工具：
- [HandBrake](https://handbrake.fr/) - 免费开源
- [CloudConvert](https://cloudconvert.com/) - 在线转换

## 常见问题

### Q: 上传失败怎么办？
A: 检查以下几点：
1. 确认 `.env.local` 中的配置正确
2. 确认 Cloudflare R2 bucket 已创建
3. 确认 API Token 权限正确
4. 检查网络连接

### Q: 视频无法播放？
A: 确保：
1. Bucket 已设置为公开访问
2. 视频格式为浏览器支持的格式（MP4/WebM）
3. 公开 URL 配置正确

### Q: 如何删除已上传的视频？
A: 登录 Cloudflare Dashboard → R2 → 选择 bucket → 找到文件并删除

