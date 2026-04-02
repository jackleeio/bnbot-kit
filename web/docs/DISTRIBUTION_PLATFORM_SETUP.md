# Distribution Platform Setup (BNBot)

目标：把同一篇主站文章分发到多个平台。

## Platforms in scope
- Medium
- Substack
- Dev.to
- Hashnode
- LinkedIn
- Mirror
- X (文案生成，发布由外部 agent)

---

## 1) 环境变量清单
在部署环境（或本机）设置以下变量：

```bash
# Medium
MEDIUM_TOKEN=
MEDIUM_PUBLICATION_ID=

# Substack（如用邮件/API/自动化桥接）
SUBSTACK_API_KEY=
SUBSTACK_PUBLICATION=

# Dev.to
DEVTO_API_KEY=

# Hashnode
HASHNODE_API_KEY=
HASHNODE_PUBLICATION_ID=

# LinkedIn
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_ACCESS_TOKEN=
LINKEDIN_AUTHOR_URN=

# Mirror（按你使用的发布方式填写）
MIRROR_API_KEY=
MIRROR_PUBLICATION_ID=
```

> 注：不同平台 API 形态不同。先把 token 与 publication id 准备齐，再做发布脚本串联。

---

## 2) 内容版本策略（已确定）
- 主站：完整版（canonical 主地址）
- Medium：精简长文 + 原文链接
- Substack：newsletter 口吻版本
- Dev.to/Hashnode：技术实操版本
- LinkedIn：专业摘要版
- Mirror：Web3 主题文章

---

## 3) 自动化发布流程（建议）
1. 生成主站文章并发布
2. 生成各平台改写稿（已实现 `scripts/build_distribution_assets.py`）
3. 调用各平台 API 发布
4. 记录每个平台的 post URL 到日志（用于复盘）

---

## 4) 当前状态
- [x] 主站 blog 自动化（多主题）
- [x] 分发素材生成（medium / x-thread / linkedin）
- [ ] Medium 自动发布 API 串联
- [ ] Substack 自动发布串联
- [ ] Dev.to 自动发布串联
- [ ] Hashnode 自动发布串联
- [ ] LinkedIn 自动发布串联
- [ ] Mirror 自动发布串联

