# Cloudflare R2 视频存储配置指南

## 第一步：创建 Cloudflare R2 Bucket

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 在左侧菜单选择 **R2**
3. 点击 **Create bucket**
4. 输入 bucket 名称，例如：`bnbot-videos`
5. 选择区域（建议选择离你用户最近的区域）
6. 点击 **Create bucket**

## 第二步：配置公开访问

1. 进入刚创建的 bucket
2. 点击 **Settings** 标签
3. 找到 **Public access** 部分
4. 点击 **Connect Domain** 或 **Allow Access**
5. 选择 **Custom Domain** 或使用 R2.dev 子域名
   - 使用 R2.dev：自动生成，例如 `pub-xxxxx.r2.dev`
   - 自定义域名：需要你有自己的域名并配置 DNS

## 第三步：创建 API Token

1. 在 Cloudflare Dashboard 右上角，点击你的头像
2. 选择 **My Profile** → **API Tokens**
3. 点击 **Create Token**
4. 选择 **Create Custom Token**
5. 配置权限：
   - **Permissions**:
     - Account → R2 → Edit
   - **Account Resources**:
     - Include → 选择你的账户
6. 点击 **Continue to summary** → **Create Token**
7. **重要**：复制并保存这个 Token（只显示一次）

## 第四步：获取 Account ID

1. 在 Cloudflare Dashboard 右侧边栏
2. 找到 **Account ID**
3. 复制这个 ID

## 第五步：配置环境变量

将以下信息添加到项目的 `.env.local` 文件：

```env
# Cloudflare R2 Configuration
CLOUDFLARE_ACCOUNT_ID=你的账户ID
CLOUDFLARE_R2_ACCESS_KEY_ID=你的API Token
CLOUDFLARE_R2_SECRET_ACCESS_KEY=你的API Secret
CLOUDFLARE_R2_BUCKET_NAME=bnbot-videos
CLOUDFLARE_R2_PUBLIC_URL=https://pub-xxxxx.r2.dev
```

## 注意事项

- API Token 只显示一次，请妥善保管
- 公开访问的域名会在 bucket 设置中显示
- 免费套餐包含 10GB 存储，零带宽费用
- 需要绑定信用卡才能使用（即使是免费套餐）
