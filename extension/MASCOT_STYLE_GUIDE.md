# BNBOT 吉祥物 / Logo 风格指南

## 角色概述

BNBOT 的吉祥物是一只**龙虾机器人 (Lobster Bot)**——将龙虾的外形特征与复古电视机器人融合的卡通角色。

## 核心视觉特征

### 头部 (Head)
- **造型**: 复古电视机/显示器，方形带圆角
- **边框**: 金色/琥珀色金属质感边框
- **屏幕**: 深色暗屏（深灰/深青色）
- **表情**: LED 像素风格显示
  - 左眼: 粉红/红色像素爱心 ❤️
  - 右眼: 金色像素横线（眨眼/破折号）
  - 嘴巴: 金色像素小微笑
- **触角**: 头顶两根金属触角，顶端有金色小球

### 钳子 / 手臂 (Claws)
- **形状**: 龙虾钳，金色，圆润卡通造型
- **机械感**: 关节处有齿轮装饰（1-2个，不过多）
- **连接**: 通过短机械臂段连接头部/身体
- **风格**: 介于光滑卡通和蒸汽朋克之间——有机械元素但不过于复杂
- **禁忌**: 不要铆钉、螺栓、过多管线等碎细节

### 身体 (Body) — 全身版
- **颜色**: 红橙色龙虾身体
- **比例**: Q版/chibi 比例，大头小身
- **分节**: 可见龙虾分节纹理
- **腿**: 红色小龙虾腿
- **尾巴**: 扇形龙虾尾

### Logo 版（头+钳子）
- 只保留头部和钳子，无身体/腿/尾巴
- 钳子直接连接头部两侧
- 构图紧凑，适合缩小到 16x16

## 配色方案

| 元素 | 颜色 |
|------|------|
| 电视框/钳子 | 金色/琥珀色 (#FFD700, #DAA520) |
| 屏幕 | 深灰/深青 (#1A1A2E, #2D3748) |
| 像素爱心眼 | 粉红/红色 (#FF4466, #E91E63) |
| 像素表情 | 金黄色 (#FFD700, #FFC107) |
| 身体（全身版） | 红橙色 (#E85D3A, #D44A2A) |
| 背景 | 纯黑 (#000000) 或透明 |

## 画风描述

- **风格**: 卡通矢量 (Cartoon Vector), 赛璐璐上色 (Cel-shaded)
- **轮廓**: 粗黑描边 (Thick bold outlines)
- **色彩**: 鲜艳饱和 (Vibrant saturated colors)
- **质感**: 介于平面卡通和轻度立体之间
- **品质**: 游戏吉祥物级别 / 贴纸艺术风格

## 生成提示词模板

### 英文 (用于 AI 图像生成)

#### Logo 版 (头+钳子)
```
A cartoon logo icon, 1:1 square, black background. ONLY head and claws visible, NO body, NO legs, NO tail. HEAD: A retro TV/monitor with GOLDEN frame, large and prominent. Dark screen displaying LED PIXEL face: pink/red pixel HEART for left eye, golden pixel dash for right eye, small pixel smirk mouth. Two ball-tipped antenna sticking up from top of the golden TV head. CLAWS: Two golden lobster claws connected via short mechanical arms with gear details at joints. Bold outlines, cel-shaded, vibrant cartoon coloring. Style: clean cartoon vector, premium mascot logo.
```

#### 全身版 (吉祥物)
```
A cartoon lobster-bot character, 1:1 square, black background. HEAD: A retro TV/monitor with GOLDEN/AMBER colored frame. Dark screen displaying LED PIXEL style face: a pink/red pixel HEART for the left eye, golden pixel dots forming a wink/dash for the right eye, and a small pixel smirk mouth. Two ball-tipped antenna sticking up from the top of the golden TV head. BODY: Red-orange lobster body, cute and compact, cartoonish proportions. CLAWS: Two golden mechanical steampunk-style lobster claws with visible gears at joints. Small red lobster legs at the bottom. Bold outlines, cel-shaded, vibrant colors. Style: bold cartoon vector, premium mascot art.
```

#### 特定场景/动作变体
```
[基础描述] + The character is [动作描述]. [场景描述].
```

动作示例:
- `waving one claw cheerfully` (挥手打招呼)
- `sitting in a relaxed pose` (坐姿放松)
- `holding a golden coin in one claw` (钳子夹金币)
- `typing on a keyboard` (打字)
- `wearing sunglasses, looking cool` (戴墨镜耍酷)

### 绿幕生成附加指令 (用于 transparent-image-gen)
```
The background MUST be a solid, flat, uniform chromakey green color (#00FF00). NO variation, NO gradients, NO shadows on the background. The character should have a thin white outline to separate from the green. CRITICAL: The character must NOT contain ANY green colors. Use gold, red, silver, black, white colors only.
```

## 使用场景

| 场景 | 推荐版本 | 尺寸 |
|------|----------|------|
| Chrome 扩展工具栏 | Logo 版 (头+钳子) | 16x16, 48x48 |
| Chrome 扩展商店 | Logo 版 (头+钳子) | 128x128 |
| 官网 Logo | Logo 版 (头+钳子) | 1024x1024 |
| Twitter 头像 | 全身版或 Logo 版 | 400x400 |
| 官网插图/Banner | 全身版 (各种姿态) | 1024x1024+ |
| 贴纸/表情包 | 全身版 (各种表情) | 512x512 |

## 当前选用的 Logo

文件: `assets/images/logo-candidates-v8/logo-v8-2.png`
描述: 金色电视头正面 + LED像素爱心眼/眨眼表情 + 两侧金色蒸汽朋克机械钳
