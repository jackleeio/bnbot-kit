#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path
import requests


def parse_markdown(path: Path):
    raw = path.read_text(encoding='utf-8')
    if not raw.startswith('---\n'):
        raise ValueError('Missing frontmatter')
    end = raw.find('\n---\n', 4)
    if end == -1:
        raise ValueError('Invalid frontmatter block')
    fm = raw[4:end].strip().split('\n')
    body = raw[end + 5 :].strip()

    meta = {}
    for line in fm:
        if ':' not in line:
            continue
        k, v = line.split(':', 1)
        meta[k.strip()] = v.strip().strip('"').strip("'")
    return meta, body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--site-url', default='https://bnbot.ai')
    ap.add_argument('--published', action='store_true', default=False)
    args = ap.parse_args()

    api_key = os.getenv('DEVTO_API_KEY')
    if not api_key:
        raise SystemExit('DEVTO_API_KEY is required')

    path = Path(args.input)
    meta, body = parse_markdown(path)

    slug = path.stem
    canonical = f"{args.site_url}/blog/{slug}"

    tags = []
    raw_tags = meta.get('tags', '')
    if raw_tags:
        tags = [t.strip().strip('[]').strip('"').strip("'") for t in raw_tags.split(',')]
        tags = [t for t in tags if t]

    payload = {
        'article': {
            'title': meta.get('title', slug),
            'body_markdown': body + f"\n\n---\n\nOriginal: {canonical}\n",
            'published': bool(args.published),
            'main_image': '',
            'canonical_url': canonical,
            'description': meta.get('description', ''),
            'tags': tags[:4],
        }
    }

    # remove empty main_image
    payload['article'].pop('main_image', None)

    r = requests.post(
        'https://dev.to/api/articles',
        headers={'api-key': api_key, 'Content-Type': 'application/json'},
        data=json.dumps(payload),
        timeout=30,
    )
    if r.status_code not in (200, 201):
        raise SystemExit(f"Dev.to publish failed: {r.status_code} {r.text[:300]}")

    j = r.json()
    print(j.get('url') or j.get('path') or 'published')


if __name__ == '__main__':
    main()
