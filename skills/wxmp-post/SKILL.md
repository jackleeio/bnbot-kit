---
name: wxmp-post
version: "0.1.0"
description: "Generate a WeChat MP (微信公众号 / mp.weixin.qq.com) article and push it to the user's draft box (草稿箱). Handles full rich text — h1/h2/h3, bold, italic, lists, blockquote, code, inline color — and auto-uploads any local or external image to mmbiz.qpic.cn so the draft is server-persisted. Stops at draft; never publishes (发表 must remain a manual click)."
argument-hint: "wxmp-post 生成一篇关于 X 的公众号文章 / wxmp-post 把这篇 markdown 发到公众号草稿箱"
allowed-tools: Bash, Read, Write, Edit, WebFetch
user-invocable: true
trigger: /wxmp-post
---

# /wxmp-post — 写好一篇公众号文章并送进草稿箱

This skill bridges 「Claude generates content」 和 「微信公众号草稿箱」.
The user describes the article(主题 / 调性 / 长度); Claude writes it with
proper 公众号-style 排版; bnbot CLI pastes it into the editor with all
images auto-uploaded to mmbiz CDN; draft saved.

## When to use

- 用户说"帮我写一篇公众号文章 / 公众号长文",或"发到公众号草稿箱"
- 已经有 markdown / HTML 草稿,要"搬到公众号"(无论原文在哪)
- 从一篇网页 / 别的公众号文章 / 自己 ops 文档,转成公众号草稿

DON'T use this skill for:
- 推特文(用主 `/bnbot` 流程)
- 视频号(那是 `channels.weixin.qq.com`,task #84)
- 直接发表(本 skill 不会点发表;发表必须用户在公众号后台手动确认)

## What "公众号 style" means

公众号文章和推文/小红书完全是另一种文体。Claude 写的时候要按这个写:

1. **长度**:1500–3500 字。短了不像公众号文,长了读者跳出。
2. **结构**:必须有 `<h1>` 标题 + 多个 `<h2>` 小节;每节下用 `<h3>` 拆开会更顺。
3. **段落**:**短**段落,2–3 句一段,空行隔开。读者多用手机看,长段落直接走。
4. **图**:每 500–800 字插一张图。封面 1 张(必须),正文 2–4 张。可以是
   - 用户提供的本地图(`/abs/path/to.png`)
   - 远程外链图(`https://...`)CLI 端会自动 fetch
   - AI 生图(走 `bnbot-api` 的 generate 接口)
5. **加粗**:每个 h2 段落里挑 1–2 个关键短语 `<strong>` 加粗,不要超过 3 个;过多读起来像广告。
6. **列表**:观点拆成 `<ul><li>` / `<ol><li>` 比连续段落好读。
7. **引用块**:`<blockquote>` 用于"原文摘录" / "数据点" / "对话片段"。
8. **链接**:`<a href="https://...">` 都允许;微信会自动处理 `linktype` 标注。
9. **颜色**:可选,inline `style="color:#xxx"`。**不要花哨**,一篇文章最多两种强调色(主色 + 一种辅色)。
10. **结尾**:必须有"结尾段" + 引导关注 / 推阅读 / 留言 — 但**不要**写"喜欢请点在看转发"这种 AI 味浓的话术。让收尾自然。

避免的 AI tone(参考 `references/persona.md`):
- 破折号 ——
- "I'd argue"、"It's worth noting that"、"颇为耐人寻味"、"不容忽视的是"
- 整齐的"开头 / 中间 / 结尾"三段式宣讲
- 每段都加"反观"、"诚然"、"实际上"

## Preflight

1. **Verify the editor reachable**:
   ```bash
   bnbot debug eval --host "mp.weixin.qq.com" "JSON.stringify({ok: true, url: location.href})"
   ```
   If the pool tab isn't on `mp.weixin.qq.com`, navigate first:
   ```bash
   bnbot navigate "https://mp.weixin.qq.com/cgi-bin/home?t=home/index&token=&lang=zh_CN"
   ```
   The user must be logged in (cookie). If 401/redirect, ask user to manually
   sign in once,Chrome cookie 持久化后下次 CLI 直接复用.

2. **Decide brand**:If multiple 品牌(`projects/<slug>/`)绑定了不同公众号,
   read `projects/<slug>/accounts/wxmp.json` to confirm the right token. If
   only one account, just go.

3. **Collect images** the user wants in this article. Three sources:
   - Local files in `projects/<slug>/assets/` or temp paths
   - URLs(blog / 微信文章 / 任何 https)
   - AI 生图(call `bnbot-api` to generate, get back local path)

## Core flow

### 1. Generate the article (Claude does this part)

Output a JSON `plan` that maps to `bnbot wxmp post` plan schema:

```json
{
  "title":   "为什么我们都低估了 X(≤30 字)",
  "author":  "BNBot",
  "digest":  "可选;不填微信会自动从正文取前 54 字",
  "pasteHtml": "<h1>...</h1><p>段落...</p><h2>...</h2><ul><li>...</li></ul>...",
  "pasteImages": [
    "/Users/jack/.../cover.png",
    "https://blog.example.com/img-1.png",
    "/tmp/ai-generated-2.png"
  ],
  "original":  true,
  "saveDraft": true,
  "preview":   false
}
```

**`pasteHtml` 写作规范**:
- 顶部一个 `<h1>` 重复标题(微信编辑器顶部已有 #title,但正文内放一个 `<h1>` 增强阅读节奏)
- `<h2>` 切 4–6 个小节
- 每段用 `<p>` 包,**不要** `<br>`(公众号会把 `<br>` 渲染得很丑)
- 强调用 `<strong>` 包关键短语,不要 `<b>`
- 列表用 `<ul><li>` / `<ol><li>`
- 引用用 `<blockquote>`
- inline 颜色:`<span style="color:#FF6B35">关键词</span>`

**`pasteImages` 顺序**:
- 第 1 张永远是封面(微信会自动设为首图封面)
- 后续按文章里出现顺序排列
- 本地路径用绝对路径,远程 URL 直接传

### 2. Show user the plan

Before pushing,展示给用户审阅:

```
📰 公众号文章 · 已生成

标题: 为什么我们都低估了 X
作者: BNBot
长度: ~2400 字
结构: h1 + 5×h2 + 8×p + 2×ul + 1×blockquote
图片: 4 张 (1 封面 + 3 内文)
原创声明: 是

要发到草稿箱吗？[发送 / 改一下 / 取消]
```

If the user says yes, proceed. If "改一下",问哪里(标题 / 段落 / 配图),修订
后再 reconfirm.

### 3. Push to draft box

```bash
echo '<plan-json>' | bnbot wxmp post -
```

Or write the plan to a temp file then:
```bash
bnbot wxmp post /tmp/wxmp-plan-$(date +%s).json
```

CLI 内部会:
1. 导航到 `appmsg_edit_v2&isNew=1` 编辑器(如果不在)
2. 写 title / author / digest
3. **paste HTML** via `ClipboardEvent('paste')` text/html → 排版结构进 ProseMirror
4. **逐张 binary paste** images via `DataTransfer.items.add(File)` → 触发微信
   自动上传到 mmbiz.qpic.cn → 拿到 `data-imgfileid`
5. 自动设封面(微信用第一张图)
6. 开原创声明(如果 plan 设置 original=true)
7. **保存为草稿**(永远不点发表)
8. 返回 `appmsgid`(草稿编号)

### 4. Hand back the draft URL

CLI 输出包含 `finalState.appmsgid`. Tell the user:
> ✅ 草稿已存,编号 100005267。在公众号后台「草稿箱」能看到 — 检查一遍标题/封面/排版,
> 没问题就在那里点发表。

提示用户**不要**让 Claude 帮点发表 — 公众号每月发文配额有限,误发是大问题。

## Plan field reference

完整 JSON schema in `bnbot-kit/cli/src/commands/wxmp.ts`:

| Field | Type | Note |
|---|---|---|
| `title` | string | 公众号标题(微信限 64 字符,中文按 1 字符算) |
| `author` | string | 作者名,不填默认账号注册名 |
| `digest` | string | 摘要(可选;不填微信自动从正文取前 54 字) |
| `pasteHtml` | string | 富文本 HTML — h1/h2/h3/strong/em/ul/ol/blockquote/code/a/span color 全保留 |
| `pasteImages` | string[] | 本地路径 or https URL,按顺序 binary paste 触发自动上传 |
| `bodyHtml` | string | (legacy) 直接 innerHTML 写入 — 服务端会 strip 图片 + 部分样式,**不推荐** |
| `original` | boolean | 是否开原创声明(文字原创 + 已开启快捷转载) |
| `saveDraft` | boolean | 默认 true |
| `preview` | boolean | 是否进预览面板(本地 dev 调试用,生产不必) |
| `editorUrl` | string | (override) 复用已有草稿 URL |

## Safety rules (HARD)

1. **永远不发表**。CLI 没有 `--publish` flag,plan 也没有 `publish` field。
   即便用户说"直接发了吧",也只能保存到草稿箱 + 让用户去后台手动点发表。
2. **不要点 `<button class="mass_send">`**,即使 selector 看起来对。`保存为草稿` 和
   `发表` 都用 `.btn_primary.r` 样式,只能靠 `innerText` 区分。
3. **图片必须经过 binary paste**。不能直接在 HTML 里嵌 `<img src="data:base64...">`
   或外链 — 服务端会 strip。CLI 已经处理了这层转换,但写自定义脚本要小心。
4. **不要重复发同篇**。每次跑前看 `~/.bnbot/logs/wxmp-YYYYMMDD.jsonl`(rolling 30
   天)有没有相同 title — 如果有,问用户是否覆盖。
5. **每天最多 3 篇草稿**。公众号原创推荐机制对发文频率敏感;批量发草稿没问题,
   但一天连发会被算法降权。Claude 看到当天日志已 3 条,警告 + 等用户确认。

## Logging

`~/.bnbot/logs/wxmp-YYYYMMDD.jsonl`:

```jsonl
{"ts":"...","title":"...","appmsgid":"100005267","imgUploaded":4,"chars":2380,"posted":false,"draftOnly":true}
```

`posted` 永远是 `false`(本 skill 永远不发表)。`draftOnly: true` 是 redundant
但放着提醒未来读 log 的人这点。

## Failure modes

| 症状 | 可能原因 | Claude 应该做 |
|---|---|---|
| `editor:ready` 卡住 | 浏览器 tab 不在 mp.weixin.qq.com / 未登录 | 让用户手动开个页面登录,然后重试 |
| `paste:html+0-images` | `pasteImages` 列表里所有图都 fetch 失败 | 检查 URL 是否 200,本地路径是否绝对 |
| 第 N 张图 binary paste 后 `mmbiz` 没出现 | 微信图床上传 timeout / 图过大 | 默认 timeout 15s;> 5MB 的图考虑先压缩 |
| 草稿 reload 后图片消失 | 走 legacy `bodyHtml` 路径触发服务端 strip | 用 `pasteHtml` + `pasteImages` 不要用 `bodyHtml` |
| 标题超长 | `<h1>` 文字 > 64 字 | Claude 写之前自检,过长就拆 |

## Integration with other skills

- 跟 `/republish` 不同 — `/republish` 是搬运视频到 X;本 skill 是把内容投送到
  自己的公众号
- 可以从 `/bnbot` 的内容生成结果作为输入 — 用户说"把这个推文话题展开成一篇
  公众号文章",`/bnbot` 提供素材,本 skill 接管成稿 + 发草稿
- 配合 `/schedule`:写好草稿不立即"发表",让用户自己挑时间;或者用 launchd
  在草稿过夜后第二天 9 点提醒去后台发(目前还没自动发的能力 — 设计上故意留给
  用户做最后审阅)

## Don't do

- 不要"为了凑长度"灌水。读者 5 秒判断要不要继续读,凑字数的开头直接劝退。
- 不要在文章里堆 hashtag(公众号没有 # 机制,堆了像不懂平台的 SEO 思维)
- 不要把所有外链都换成短网址 / r1 跳转 — 公众号会标"该网址未经过审核"
- 不要在文章末尾加 emoji 推送语("👀 觉得有用就点在看")— AI tone 重灾区
- 不要画夸张的彩色 callout 框(`<div style="background:linear-gradient...">`)—
  公众号编辑器渲染这种会丢样式 + 看起来杂乱
