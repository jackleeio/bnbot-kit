# 字幕重叠问题修复指南

## 问题描述

当前 `analyze_youtube_transcript` API 返回的 SRT 字幕文件存在时间轴重叠问题。具体表现为：

- 多个字幕条目的时间范围存在重叠
- 例如：字幕1显示时间为 00:00:10 → 00:00:15，字幕2显示时间为 00:00:13 → 00:00:18
- 这导致在 Twitter/X 平台上传字幕时，可能出现显示异常或上传失败

### 示例问题字幕

```srt
1
00:00:10,000 --> 00:00:15,000
第一句话

2
00:00:13,000 --> 00:00:18,000
第二句话（与第一句重叠了2秒）
```

## 影响范围

- 影响所有使用 YouTube 视频搬运功能的用户
- 影响字幕在 Twitter/X 平台的正常显示
- 可能导致字幕上传失败或显示错乱

## 解决方案

### 推荐方案：在 Gemini 生成字幕时避免重叠

由于字幕是通过 Gemini AI 生成/翻译的，**最佳方案是在生成阶段就避免产生重叠**，而不是事后修复。

#### 实施方法

在调用 Gemini API 生成字幕的 prompt 中，添加以下要求：

```
请为这个视频生成双语字幕（中英文）。要求：

1. 每个字幕条目必须是完整的句子或语义单元
2. 不要将同一句话拆分成多个字幕条目
3. 确保相邻字幕的时间轴不重叠（前一个字幕的结束时间 <= 下一个字幕的开始时间）
4. 如果原始字幕有重叠，请合并为完整的字幕条目
5. 每个字幕的显示时长应该足够用户阅读完内容

输出格式：SRT 格式，包含时间轴和中英文双语字幕
```

#### 优势

- **从源头解决**：避免产生重叠问题
- **无额外成本**：不需要额外的 API 调用，只是改进现有 prompt
- **质量更好**：AI 可以理解语义，生成更合理的字幕分段
- **维护简单**：不需要额外的后处理代码

### 备用方案：函数修复重叠字幕

如果 Gemini 仍然产生重叠字幕，可以使用函数作为后备方案进行修复。

### 方案概述

在后端生成 SRT 字幕时，需要修复时间轴重叠问题。根据实际观察，重叠通常是因为**同一句话被分成了多个字幕片段**。具体策略：

1. **检测重叠**：遍历所有字幕条目，检测相邻条目是否存在时间重叠
2. **合并字幕**：如果检测到重叠，将相邻的字幕合并为一个完整的字幕条目
3. **扩展时间范围**：合并后的字幕使用从第一个片段开始到最后一个片段结束的完整时间范围
4. **处理双语字幕**：对于中英文双语字幕，同时合并中英文内容

### 算法逻辑

```python
def fix_subtitle_overlap(subtitles):
    """
    修复字幕时间轴重叠问题 - 通过合并重叠的字幕条目

    当检测到时间重叠时，将相邻的字幕合并为一个完整的字幕。
    这种情况通常发生在同一句话被分成了多个字幕片段。

    Args:
        subtitles: 字幕列表，每个元素包含 start_time, end_time, text
                  对于双语字幕，还包含 text_en (英文) 和 text_zh (中文)

    Returns:
        修复后的字幕列表
    """
    if not subtitles or len(subtitles) <= 1:
        return subtitles

    fixed_subtitles = []
    i = 0

    while i < len(subtitles):
        current = subtitles[i]
        current_start = current['start_time']
        current_end = current['end_time']
        current_text = current['text']

        # 对于双语字幕，保存中英文文本
        current_text_en = current.get('text_en', '')
        current_text_zh = current.get('text_zh', '')

        # 检查是否需要与下一个字幕合并
        while i + 1 < len(subtitles):
            next_sub = subtitles[i + 1]
            next_start = next_sub['start_time']
            next_end = next_sub['end_time']

            # 如果当前字幕的结束时间超过下一个字幕的开始时间，说明有重叠
            if current_end > next_start:
                # 合并字幕内容
                current_text = current_text + ' ' + next_sub['text']

                # 合并双语字幕
                if current_text_en and next_sub.get('text_en'):
                    current_text_en = current_text_en + ' ' + next_sub['text_en']
                if current_text_zh and next_sub.get('text_zh'):
                    current_text_zh = current_text_zh + ' ' + next_sub['text_zh']

                # 扩展时间范围到包含两个字幕的完整时间
                current_end = max(current_end, next_end)

                # 移动到下一个字幕继续检查
                i += 1
            else:
                # 没有重叠，停止合并
                break

        # 添加合并后的字幕
        merged_subtitle = {
            'start_time': current_start,
            'end_time': current_end,
            'text': current_text.strip()
        }

        # 如果是双语字幕，添加中英文字段
        if current_text_en:
            merged_subtitle['text_en'] = current_text_en.strip()
        if current_text_zh:
            merged_subtitle['text_zh'] = current_text_zh.strip()

        fixed_subtitles.append(merged_subtitle)
        i += 1

    return fixed_subtitles
```

## 实现步骤

### 1. 定位修改位置

在 `analyze_youtube_transcript` API 的实现中，找到生成 SRT 字幕的代码位置。通常在：

- 从 YouTube API 获取字幕数据后
- 转换为 SRT 格式之前
- 或者在生成 `bilingual_srt` 字段时

### 2. 集成修复函数

在生成 SRT 字幕的流程中，添加字幕重叠检测和修复逻辑：

```python
# 示例：在生成 SRT 之前修复重叠
def generate_srt_from_transcript(transcript_data):
    # 1. 解析原始字幕数据
    subtitles = parse_transcript(transcript_data)

    # 2. 修复时间轴重叠（新增步骤）
    subtitles = fix_subtitle_overlap(subtitles)

    # 3. 转换为 SRT 格式
    srt_content = convert_to_srt_format(subtitles)

    return srt_content
```

### 3. SRT 格式转换辅助函数

如果需要处理 SRT 格式的时间戳，可以使用以下辅助函数：

```python
def time_to_seconds(time_str):
    """将 SRT 时间格式转换为秒数"""
    # 格式: 00:00:10,000
    h, m, s = time_str.replace(',', '.').split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)

def seconds_to_time(seconds):
    """将秒数转换为 SRT 时间格式"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    ms = int((s - int(s)) * 1000)
    return f"{h:02d}:{m:02d}:{int(s):02d},{ms:03d}"
```

## 测试方法

### 1. 单元测试

创建测试用例验证修复函数的正确性：

```python
def test_fix_subtitle_overlap():
    # 测试用例1：存在重叠的字幕
    subtitles = [
        {'start_time': 10.0, 'end_time': 15.0, 'text': '第一句话'},
        {'start_time': 13.0, 'end_time': 18.0, 'text': '第二句话'},
        {'start_time': 20.0, 'end_time': 25.0, 'text': '第三句话'},
    ]

    fixed = fix_subtitle_overlap(subtitles)

    # 验证：第一句的结束时间应该调整为不超过第二句的开始时间
    assert fixed[0]['end_time'] <= fixed[1]['start_time']
    # 验证：应该保持至少 100ms 的间隔
    assert fixed[1]['start_time'] - fixed[0]['end_time'] >= 0.1

    print("✓ 测试通过：字幕重叠已修复")
```

### 2. 集成测试

使用真实的 YouTube 视频测试完整流程：

1. 调用 `analyze_youtube_transcript` API
2. 检查返回的 `bilingual_srt` 字段
3. 验证所有字幕条目的时间轴无重叠
4. 在 Twitter/X 平台上传测试，确认字幕正常显示

## 注意事项

### 1. 保持字幕最小显示时长

在调整字幕结束时间时，需要确保每个字幕至少显示 0.5 秒，否则用户可能看不清：

```python
# 确保最小显示时长
MIN_DURATION = 0.5
current_end = max(current_start + MIN_DURATION, next_start - MIN_GAP)
```

### 2. 处理边界情况

- **空字幕列表**：如果字幕列表为空或只有一个条目，直接返回
- **时间戳异常**：如果发现 `end_time < start_time`，需要修正或记录错误
- **最后一个字幕**：最后一个字幕不需要检查重叠，保持原始结束时间

### 3. 双语字幕处理

如果 `bilingual_srt` 包含中英文双语字幕，需要确保：
- 同一时间段的中英文字幕使用相同的时间轴
- 修复重叠时同时调整中英文字幕的时间

## 预期结果

修复完成后，生成的 SRT 字幕应该满足以下条件：

### ✓ 修复前（存在问题）

同一句话被分成两段，时间重叠：

```srt
1
00:00:10,000 --> 00:00:15,000
交换意见吗？首先，黄仁勋很
trade notes well first of all Jerisen is

2
00:00:13,000 --> 00:00:18,000
棒，我非常钦佩他
brilliant so I really admire him for that
```

### ✓ 修复后（正常）

合并为一个完整的字幕：

```srt
1
00:00:10,000 --> 00:00:18,000
交换意见吗？首先，黄仁勋很 棒，我非常钦佩他
trade notes well first of all Jerisen is brilliant so I really admire him for that
```

### 验证标准

- ✅ 重叠的字幕已合并为完整的句子
- ✅ 时间范围覆盖完整的语音片段
- ✅ 双语字幕（中英文）同步合并
- ✅ 在 Twitter/X 平台上传成功，字幕正常显示

## 修改检查清单

在实施修复后，请确认以下事项：

- [ ] 已在 `analyze_youtube_transcript` API 中集成字幕重叠修复函数
- [ ] 已添加单元测试验证修复逻辑的正确性
- [ ] 已使用真实 YouTube 视频进行集成测试
- [ ] 已验证修复后的字幕在 Twitter/X 平台上传成功
- [ ] 已确认字幕显示时长不少于 0.5 秒
- [ ] 已确认相邻字幕之间保持至少 100ms 间隔
- [ ] 已处理双语字幕的时间轴同步问题
- [ ] 已添加错误日志记录，便于排查问题

## 总结

字幕重叠问题会影响用户体验和字幕上传成功率。通过在后端生成字幕时统一处理重叠问题，可以确保所有客户端都能获得正确的字幕文件，避免前端重复实现相同逻辑。

**优先级**：高
**预计工作量**：2-4 小时（包括实现、测试和部署）
**影响范围**：所有使用 YouTube 视频搬运功能的用户

---

**文档创建日期**：2026-01-16
**相关 API**：`analyze_youtube_transcript`
**相关功能**：YouTube 视频搬运、字幕上传
