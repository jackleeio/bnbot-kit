# TODO: Remove Telegram Integration

> Telegram 远程控制已被 OpenClaw 替代，需要从前端和后端完整移除 Telegram 相关代码。

## Extension（前端）

### 可直接删除的文件
- [ ] `services/telegramService.ts` — Telegram API 服务（绑定、解绑、状态查询）

### 需要清理 Telegram 代码的文件
- [ ] `components/Sidebar.tsx` — Telegram state (`telegramStatus`, `telegramEnabled`, `isBindingTelegram`)、useEffect (加载状态/WebSocket 连接)、事件处理 (`handleTelegramBind`, `handleTelegramUnbind`)、UI 已隐藏
- [ ] `services/commandService.ts` — `telegramChatId`/`telegramMsgId` 字段（`CommandMessage` 接口、`sendActionResult()`、`sendActionResultViaAPI()`、`handleAction()`）
- [ ] `services/scheduledTaskService.ts` — `NotificationType` 枚举中的 `TELEGRAM_ONLY` 和 `BOTH`
- [ ] `components/autopilot/TaskDetailView.tsx` — `telegramEnabled` state、Telegram 通知 checkbox
- [ ] `components/autopilot/TaskCreateModal.tsx` — 通知类型下拉菜单中的 Telegram 选项
- [ ] `utils/FollowDigestExecutor.ts` — 默认 `notification_type: 'telegram_only'` 改为 `'none'`
- [ ] `locales/en.ts` — 7 个 Telegram 翻译 key（telegramNotification, telegramBind 等）
- [ ] `locales/zh.ts` — 7 个 Telegram 翻译 key
- [ ] `background.ts` — Tab keep-alive 注释中提到 Telegram

## Backend（后端）

### 可直接删除的文件
- [ ] `app/api/routes/telegram.py` — Telegram webhook、绑定、设置等所有 API 路由
- [ ] `app/utils/telegram.py` — Telegram Bot API 封装（发消息、设 webhook）
- [ ] `app/utils/telegram_i18n.py` — Telegram 多语言翻译
- [ ] `app/services/telegram_ai_service.py` — Telegram 消息的 AI 处理
- [ ] `app/services/telegram_queue_service.py` — 消息队列（按 chat_id 串行处理）
- [ ] `app/services/telegram_conversation_service.py` — 对话历史管理

### 需要清理 Telegram 代码的文件
- [ ] `app/models.py` — User 表的 12+ 个 Telegram 字段、`TelegramConversation` 表、`TelegramBindingCode` 表
- [ ] `app/api/routes/websocket.py` — WebSocket 网关中 Telegram 消息路由（`telegram_chat_id`、`telegram_msg_id`）
- [ ] `app/core/config.py` — `TELEGRAM_BOT_TOKEN`、`TELEGRAM_WEBHOOK_URL`、`TELEGRAM_ALERT_BOT_TOKEN`、`TELEGRAM_ALERT_CHAT_ID` 环境变量
- [ ] `app/main.py` — 启动时注册 Telegram webhook 的逻辑
- [ ] `app/api/main.py` — 注册 Telegram 路由

### 数据库迁移（谨慎处理）
- [ ] 创建新 migration 移除 User 表 Telegram 字段
- [ ] 创建新 migration 删除 `TelegramConversation` 表
- [ ] 创建新 migration 删除 `TelegramBindingCode` 表
- [ ] 注意：`TELEGRAM_ALERT_BOT_TOKEN` 用于系统告警，考虑是否保留

## 注意事项

- **系统告警 Bot**：`TELEGRAM_ALERT_BOT_TOKEN` 和 `send_alert()` 用于后端系统告警通知（非用户功能），可能需要保留
- **数据库迁移**：已有用户绑定数据，删除字段前需要考虑数据备份
- **后端 API**：确认没有其他服务依赖 Telegram 路由后再删除
