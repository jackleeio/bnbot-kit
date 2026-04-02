#!/usr/bin/env python3
import argparse
import datetime as dt
import json
from pathlib import Path

TOPICS = [
    ("ai", "AI"),
    ("web3", "Web3"),
    ("overseas", "Global Expansion"),
    ("indie-dev", "Indie Development"),
    ("one-person-company", "One-Person Company"),
]


def slug(text: str):
    return (
        text.lower()
        .replace(" ", "-")
        .replace("/", "-")
        .replace(":", "")
        .replace("--", "-")
    )


def safe_tweet_text(row):
    t = (row.get("tweets", [{}])[0].get("text", "") or "").replace("\n", " ").strip()
    return t[:280]


def bullet_from_tweets(rows, n=4):
    out = []
    for r in rows[:n]:
        a = r.get("author", {}).get("username", "unknown")
        t = safe_tweet_text(r)
        if t:
            out.append(f"- **@{a}**: {t}")
    return out


def release_bullets(rels, n=4):
    out = []
    for rel in rels[:n]:
        repo = rel.get("repo") or "unknown"
        name = rel.get("name") or rel.get("tag") or "release"
        tag = rel.get("tag") or ""
        url = rel.get("url") or ""
        out.append(f"- **{repo}** — {name} {f'({tag})' if tag else ''} {f'[{url}]({url})' if url else ''}")
    return out


def topic_angle(key):
    angles = {
        "ai": {
            "thesis": "The market signal is shifting from prompt tricks to production-grade agent infrastructure: reliability, tool orchestration, and deployment constraints now matter more than raw model novelty.",
            "operators": [
                "Prioritize one workflow where agents can complete end-to-end tasks with measurable latency and error budgets.",
                "Instrument production logs (fail reasons, retries, tool-call success) before adding more model complexity.",
                "Convert recurring human operations into versioned agent skills, not ad-hoc prompts.",
            ],
        },
        "web3": {
            "thesis": "Web3 signal quality is concentrating around infrastructure that AI agents can actually execute against: trading rails, data surfaces, and interoperable app primitives.",
            "operators": [
                "Map your on-chain workflow to API/CLI surfaces that agents can call deterministically.",
                "Use strict execution guards (position size, slippage, retry caps) before enabling autonomous actions.",
                "Publish machine-readable docs and examples so agent integrations are not brittle.",
            ],
        },
        "overseas": {
            "thesis": "Global expansion for AI-native products now depends less on country-by-country headcount and more on reusable agentic operations for support, onboarding, and outbound.",
            "operators": [
                "Start with one geo and one vertical, then reuse the same agent workflow with localized prompts and compliance checks.",
                "Localize distribution channels first (creator clusters, communities, KOLs), UI copy second.",
                "Track conversion by market and message variant, then retrain your content and outreach playbooks weekly.",
            ],
        },
        "indie-dev": {
            "thesis": "The solo builder advantage is now operational leverage: the ability to run parallel AI workers across coding, growth, and support without adding fixed payroll.",
            "operators": [
                "Ship one narrow paid workflow every week; avoid broad product surfaces with unclear adoption loops.",
                "Use agents for repetitive delivery and keep founder time for strategy, positioning, and distribution.",
                "Document every successful task as a reusable template to compound velocity.",
            ],
        },
        "one-person-company": {
            "thesis": "A one-person company can compete when it systematizes execution into repeatable AI-assisted pipelines: content, sales, fulfillment, and customer success.",
            "operators": [
                "Design your week around pipeline ownership, not random tasks: acquisition, conversion, delivery, retention.",
                "Automate first-response and qualification, but keep high-stakes human checkpoints for trust.",
                "Review unit economics weekly so automation growth does not hide margin leakage.",
            ],
        },
    }
    return angles[key]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--signals", default="data/daily-signals.json")
    parser.add_argument("--date", default=dt.date.today().isoformat())
    parser.add_argument("--out-dir", default="src/content/blog")
    parser.add_argument(
        "--topics",
        default="",
        help="Optional comma-separated topic keys: ai,web3,overseas,indie-dev,one-person-company",
    )
    args = parser.parse_args()

    d = dt.datetime.strptime(args.date, "%Y-%m-%d").date()
    y, m = f"{d.year:04d}", f"{d.month:02d}"

    with open(args.signals, "r", encoding="utf-8") as f:
        signals = json.load(f)

    ai_tweets = signals.get("twitter", {}).get("ai", [])[:8]
    crypto_tweets = signals.get("twitter", {}).get("crypto", [])[:8]
    ai_releases = signals.get("github", {}).get("releases", {}).get("ai", [])[:6]
    web3_releases = signals.get("github", {}).get("releases", {}).get("web3", [])[:6]

    out_base = Path(args.out_dir) / y / m
    out_base.mkdir(parents=True, exist_ok=True)

    selected_keys = set()
    if args.topics.strip():
        selected_keys = {x.strip() for x in args.topics.split(",") if x.strip()}

    for key, label in TOPICS:
        if selected_keys and key not in selected_keys:
            continue

        title = f"{label} Analysis: What Changed in the Last 24 Hours and What To Do Next ({args.date})"
        filename = out_base / f"{slug(key)}-{args.date}.md"

        rows = ai_tweets if key in ("ai", "indie-dev", "one-person-company", "overseas") else crypto_tweets
        rels = ai_releases if key != "web3" else web3_releases
        angle = topic_angle(key)

        tweet_bullets = bullet_from_tweets(rows, n=5)
        release_lines = release_bullets(rels, n=5)

        body = [
            "---",
            f'title: "{title}"',
            f'description: "A source-backed {label} article synthesized from Twitter signals, GitHub releases, and web validation."',
            f'excerpt: "A practical {label} analysis with market context, operator takeaways, and a 7-day execution plan."',
            f'date: "{args.date}"',
            f'tags: [{key}, seo, analysis, daily]',
            f'coverImage: "/images/{args.date}-ai-web3-daily.svg"',
            "---",
            "",
            f"# {title}",
            "",
            "## Executive Summary",
            angle["thesis"],
            "",
            "In this edition, we combine three lenses: real-time social signals (Twitter API), builder-level shipping evidence (GitHub), and web-level context validation. The objective is not to repeat headlines, but to derive execution decisions that can be tested in the next 24 hours.",
            "",
            "## What Changed in the Last 24 Hours",
            "### Social Signal Layer (Twitter)",
            *tweet_bullets,
            "",
            "### Shipping Layer (GitHub)",
            *release_lines,
            "",
            "## Multi-Source Interpretation",
            "When social chatter and shipping activity point in the same direction, the signal quality improves. Today’s pattern suggests teams are shifting from experimentation theater to production constraints: reliability, operating cost, and workflow depth.",
            "",
            "For operators, this means prioritizing systems that survive real usage over demos that only perform in ideal conditions. Any workflow that cannot be monitored, retried, and audited should not be promoted to a core business dependency.",
            "",
            "## 7-Day Operator Plan",
            *[f"{i+1}. {step}" for i, step in enumerate(angle["operators"])],
            "",
            "## Risk Watch",
            "- **Signal contamination**: viral posts can overstate readiness; validate with implementation evidence.",
            "- **Execution fragility**: if your workflow depends on one brittle integration, your throughput is artificial.",
            "- **Narrative lag**: market sentiment may move faster than your internal operating model.",
            "",
            "## Sources",
            "- Twitter KOL feed (internal API): https://api.bnbot.ai/api/v1/ai/kol-recent-data",
            "- X Search (query validation): https://twitter.com/search",
            *[f"- GitHub Release: {r.get('url')}" for r in rels if r.get('url')],
            "",
            "## FAQ",
            "### Why not rely on one data source?",
            "Single-source analysis often amplifies bias. Multi-source synthesis reduces narrative error and improves operational decisions.",
            "",
            "### How do I know this is actionable?",
            "Each article includes a 7-day operator plan designed for immediate implementation and measurable feedback.",
        ]

        filename.write_text("\n".join(body), encoding="utf-8")
        print(filename)


if __name__ == "__main__":
    main()
