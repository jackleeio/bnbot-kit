#!/usr/bin/env python3
"""
根据 blog markdown 生成跨平台分发稿：
- medium: 精简长文
- x_thread: 线程稿
- linkedin: 专业摘要
"""
import argparse
from pathlib import Path
import re


def extract_title(content: str) -> str:
    m = re.search(r'^title:\s*"(.+?)"', content, re.M)
    return m.group(1) if m else "Untitled"


def extract_body(content: str) -> str:
    parts = content.split('---')
    if len(parts) >= 3:
        return parts[2].strip()
    return content


def truncate(text: str, n: int) -> str:
    return text if len(text) <= n else text[: n - 1] + '…'


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, help="blog markdown path")
    p.add_argument("--site-url", default="https://bnbot.ai")
    p.add_argument("--out-dir", default="dist/distribution")
    args = p.parse_args()

    src = Path(args.input)
    text = src.read_text(encoding="utf-8")
    title = extract_title(text)
    body = extract_body(text)

    slug = src.stem
    article_url = f"{args.site_url}/blog/{slug}"

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    medium = f"# {title}\n\n{truncate(body, 5000)}\n\n原文：{article_url}\n"
    x_thread = (
        f"1/ {title}\n\n"
        f"2/ 核心观点：{truncate(body.replace(chr(10), ' '), 220)}\n\n"
        f"3/ 细节与实操见原文：{article_url}\n"
    )
    linkedin = (
        f"{title}\n\n"
        f"今天我们围绕这个主题做了实操拆解：\n"
        f"- 关键信号\n- 执行建议\n- 风险与机会\n\n"
        f"完整文章：{article_url}\n"
    )

    (out / f"{slug}.medium.md").write_text(medium, encoding="utf-8")
    (out / f"{slug}.x-thread.txt").write_text(x_thread, encoding="utf-8")
    (out / f"{slug}.linkedin.txt").write_text(linkedin, encoding="utf-8")

    print(out / f"{slug}.medium.md")
    print(out / f"{slug}.x-thread.txt")
    print(out / f"{slug}.linkedin.txt")


if __name__ == "__main__":
    main()
