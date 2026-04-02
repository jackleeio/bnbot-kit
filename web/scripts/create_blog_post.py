#!/usr/bin/env python3
import argparse
import datetime as dt
import os
import re
from pathlib import Path


def slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9\u4e00-\u9fff\s-]", "", text)
    text = re.sub(r"\s+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-") or "untitled-post"


def main():
    parser = argparse.ArgumentParser(description="Create a blog markdown file with frontmatter.")
    parser.add_argument("--title", required=True)
    parser.add_argument("--description", required=True)
    parser.add_argument("--excerpt", required=True)
    parser.add_argument("--tags", default="")
    parser.add_argument("--date", default="", help="YYYY-MM-DD, default: today")
    parser.add_argument("--root", default="src/content/blog")
    args = parser.parse_args()

    date = args.date or dt.date.today().isoformat()
    d = dt.datetime.strptime(date, "%Y-%m-%d").date()

    year = f"{d.year:04d}"
    month = f"{d.month:02d}"
    slug = slugify(args.title)

    out_dir = Path(args.root) / year / month
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{slug}.md"

    tags_line = f'tags: [{args.tags}]\n' if args.tags.strip() else ''

    content = (
        "---\n"
        f'title: "{args.title}"\n'
        f'description: "{args.description}"\n'
        f'excerpt: "{args.excerpt}"\n'
        f'date: "{date}"\n'
        f"{tags_line}"
        "---\n\n"
        f"# {args.title}\n\n"
        "Write your article here.\n"
    )

    if out_file.exists():
        raise SystemExit(f"File already exists: {out_file}")

    out_file.write_text(content, encoding="utf-8")
    print(out_file)


if __name__ == "__main__":
    main()
