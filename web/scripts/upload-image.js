#!/usr/bin/env node

/**
 * Cloudflare R2 图片上传脚本
 * 使用方法: node scripts/upload-image.js <图片文件路径>
 * 示例: node scripts/upload-image.js ./my-image.png
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

// 验证环境变量
const requiredEnvVars = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_BUCKET_NAME',
  'CLOUDFLARE_R2_PUBLIC_URL'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error('❌ 缺少必要的环境变量:');
  missingVars.forEach(varName => console.error(`   - ${varName}`));
  console.error('\n请在 .env.local 文件中配置这些变量');
  process.exit(1);
}

// 配置 S3 客户端（R2 兼容 S3 API）
const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  },
});

async function uploadImage(filePath) {
  try {
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }

    // 读取文件
    const fileContent = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const fileExtension = path.extname(fileName).toLowerCase();

    // 验证文件类型
    const allowedExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    if (!allowedExtensions.includes(fileExtension)) {
      throw new Error(`不支持的文件类型: ${fileExtension}。支持的格式: ${allowedExtensions.join(', ')}`);
    }

    // 设置 Content-Type
    const contentTypeMap = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
    };

    console.log(`📤 正在上传: ${fileName}`);
    console.log(`📦 文件大小: ${(fileContent.length / 1024 / 1024).toFixed(2)} MB`);

    // 上传到 R2
    const command = new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: `images/${fileName}`,
      Body: fileContent,
      ContentType: contentTypeMap[fileExtension],
      CacheControl: 'public, max-age=31536000', // 缓存1年
    });

    await s3Client.send(command);

    // 生成公开访问 URL
    const publicUrl = `${process.env.CLOUDFLARE_R2_PUBLIC_URL}/images/${fileName}`;

    console.log('\n✅ 上传成功！');
    console.log('\n📋 图片信息:');
    console.log(`   文件名: ${fileName}`);
    console.log(`   公开URL: ${publicUrl}`);

    return publicUrl;
  } catch (error) {
    console.error('\n❌ 上传失败:', error.message);
    process.exit(1);
  }
}

// 主函数
const filePath = process.argv[2];

if (!filePath) {
  console.error('❌ 请提供图片文件路径');
  console.error('\n使用方法:');
  console.error('  node scripts/upload-image.js <图片文件路径>');
  console.error('\n示例:');
  console.error('  node scripts/upload-image.js ./my-image.png');
  process.exit(1);
}

uploadImage(filePath);
