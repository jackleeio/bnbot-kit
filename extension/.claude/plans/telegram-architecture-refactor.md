# Telegram 架构重构计划

## 概述

将 Telegram 消息处理从"全部转发给扩展"改为"后端处理 AI + 按需分发 Action"架构。

**状态**: ✅ 已完成 (2026-02-02)

---

## Phase 1: 后端 AI 调用 + Redis 在线状态 ✅

### 目标
- 后端直接调用 AI API 处理 Telegram 消息
- 用 Redis 存储用户 WebSocket 在线状态
- 多 worker 可共享在线状态

### 验收标准
- [x] 纯文字对话不需要扩展在线
- [x] 扩展离线时显示友好提示
- [x] 多 worker 环境下在线状态正确

---

## Phase 2: Action Queue + Pub/Sub ✅

### 目标
- 解耦 Action 分发和执行
- 支持跨 worker Action 结果回调
- 支持 Action 超时和重试

### 验收标准
- [x] Action 通过 Redis Stream 分发
- [x] 结果通过 Pub/Sub 返回
- [x] 支持 60 秒超时

---

## Phase 3: 对话上下文持久化 ✅

### 目标
- 对话历史存储到数据库
- 跨设备、跨会话保持上下文
- 支持 interrupt/resume 状态恢复

### 验收标准
- [x] 对话历史持久化
- [x] Telegram 和扩展共享上下文
- [x] 重启后可恢复中断的 Action

---

## Phase 4: WebSocket Gateway 独立服务 ✅

### 目标
- WebSocket 处理独立出来
- 支持水平扩展
- 更好的连接管理

### 实现
- `backend/app/gateway/` - 独立 Gateway 服务
- Offscreen Document 架构 (扩展端多 Tab 共享连接)

### 验收标准
- [x] Gateway 独立运行
- [x] 可水平扩展 backend workers
- [x] WebSocket 连接稳定

---

## 已实现的功能

### Telegram 命令
- `/start` - 欢迎消息
- `/help` - 帮助信息
- `/status` - 连接状态
- `/credits` - 积分余额
- `/drafts` - 草稿列表 (带 title 和预览链接)
- `/scheduled` - 定时任务
- `/lang` - 语言切换 (inline keyboard 按钮)
- `/clear` - 清除对话历史

### 后端 API
- `GET /api/v1/drafts/preview/{code}` - 公开预览草稿
- `POST /api/v1/drafts/{id}/preview-code` - 生成预览码

### 待实现
- 推文预览页面: `https://bnbot.ai/preview/{code}` (Frontend: `/Users/jacklee/Projects/bnbot-frontend`)
