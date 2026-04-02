#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import os
import urllib.parse
import urllib.request


def get_json(url: str, headers=None, timeout=20):
    base_headers = {"User-Agent": "BNBot-SignalCollector/1.0"}
    if headers:
        base_headers.update(headers)
    req = urllib.request.Request(url, headers=base_headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_twitter_like(base_url: str, page_size: int = 100, compressed: bool = False, cursor: int = 1):
    out = {}
    for topic in ["ai", "crypto"]:
        url = (
            f"{base_url}?kol_type={topic}&for_ai=true"
            f"&cursor={cursor}&page_size={page_size}&compressed={'true' if compressed else 'false'}"
        )
        data = get_json(url)
        # API currently may return hundreds of rows in one response; keep all for downstream filtering.
        out[topic] = data.get("data", [])
    return out


def fetch_twitter_search(search_endpoint: str, queries, auth_header: str = "", provider: str = "generic"):
    """
    Proactive Twitter search fetcher.

    providers:
    - generic: endpoint?q=<query>&limit=20
    - rapidapi-twitter47: endpoint?query=<query>&type=Top
    """
    headers = {}
    if auth_header:
        headers["Authorization"] = auth_header

    # RapidAPI specific headers via env vars
    if provider == "rapidapi-twitter47":
        rapid_key = os.getenv("RAPIDAPI_KEY", "")
        rapid_host = os.getenv("RAPIDAPI_HOST", "twitter-api47.p.rapidapi.com")
        if rapid_key:
            headers["x-rapidapi-key"] = rapid_key
            headers["x-rapidapi-host"] = rapid_host

    out = {}
    for q in queries:
        try:
            if provider == "rapidapi-twitter47":
                encoded_q = urllib.parse.quote(q)
                url = f"{search_endpoint}?query={encoded_q}&type=Top"
            else:
                encoded_q = urllib.parse.quote(q)
                url = f"{search_endpoint}?q={encoded_q}&limit=20"

            data = get_json(url, headers=headers)
            out[q] = data
        except Exception as e:
            out[q] = {"error": str(e)}
    return out


def fetch_twitter_community_search(search_endpoint: str, queries, provider: str = "rapidapi-twitter47"):
    """
    Community search using Twitter API providers.

    For rapidapi-twitter47:
    - query mode:  /v3/community/search?query=<keyword>
    - explore mode: /v3/community/search (no query)
    """
    headers = {}
    if provider == "rapidapi-twitter47":
        rapid_key = os.getenv("RAPIDAPI_KEY", "")
        rapid_host = os.getenv("RAPIDAPI_HOST", "twitter-api47.p.rapidapi.com")
        if rapid_key:
            headers["x-rapidapi-key"] = rapid_key
            headers["x-rapidapi-host"] = rapid_host

    out = {"by_query": {}, "explore": {}}

    # query-based community search
    for q in queries:
        try:
            encoded_q = urllib.parse.quote(q)
            url = f"{search_endpoint}?query={encoded_q}"
            out["by_query"][q] = get_json(url, headers=headers)
        except Exception as e:
            out["by_query"][q] = {"error": str(e)}

    # no-query explore (as user-provided reference)
    try:
        out["explore"] = get_json(search_endpoint, headers=headers)
    except Exception as e:
        out["explore"] = {"error": str(e)}

    return out


def fetch_community_posts(posts_endpoint_template: str, community_ids, provider: str = "rapidapi-twitter47"):
    """
    Optional community posts fetcher.
    posts_endpoint_template supports either:
    - full URL with {community_id} placeholder
    - or endpoint where ?community_id= will be appended
    """
    headers = {}
    if provider == "rapidapi-twitter47":
        rapid_key = os.getenv("RAPIDAPI_KEY", "")
        rapid_host = os.getenv("RAPIDAPI_HOST", "twitter-api47.p.rapidapi.com")
        if rapid_key:
            headers["x-rapidapi-key"] = rapid_key
            headers["x-rapidapi-host"] = rapid_host

    out = {}
    for cid in community_ids:
        try:
            if "{community_id}" in posts_endpoint_template:
                url = posts_endpoint_template.replace("{community_id}", urllib.parse.quote(str(cid)))
            else:
                sep = "&" if "?" in posts_endpoint_template else "?"
                url = f"{posts_endpoint_template}{sep}community_id={urllib.parse.quote(str(cid))}"
            out[str(cid)] = get_json(url, headers=headers)
        except Exception as e:
            out[str(cid)] = {"error": str(e)}
    return out


def extract_candidate_community_ids(community_data, limit=10):
    ids = []

    def collect_from_obj(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                lk = str(k).lower()
                if lk in ("id", "rest_id", "community_id") and isinstance(v, (str, int)):
                    ids.append(str(v))
                else:
                    collect_from_obj(v)
        elif isinstance(obj, list):
            for item in obj:
                collect_from_obj(item)

    collect_from_obj(community_data)

    # de-dup while preserving order
    seen = set()
    uniq = []
    for x in ids:
        if x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq[:limit]


def github_headers():
    h = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = os.getenv("GITHUB_TOKEN")
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def search_repos(query: str, per_page=10):
    q = urllib.parse.quote(query)
    url = f"https://api.github.com/search/repositories?q={q}&sort=updated&order=desc&per_page={per_page}"
    data = get_json(url, headers=github_headers())
    return data.get("items", [])


def search_issues(query: str, per_page=10):
    q = urllib.parse.quote(query)
    url = f"https://api.github.com/search/issues?q={q}&sort=updated&order=desc&per_page={per_page}"
    data = get_json(url, headers=github_headers())
    return data.get("items", [])


def latest_releases(repos):
    out = []
    for repo in repos[:8]:
        full_name = repo.get("full_name")
        if not full_name:
            continue
        url = f"https://api.github.com/repos/{full_name}/releases/latest"
        try:
            rel = get_json(url, headers=github_headers())
            if rel.get("tag_name"):
                out.append(
                    {
                        "repo": full_name,
                        "name": rel.get("name") or rel.get("tag_name"),
                        "tag": rel.get("tag_name"),
                        "published_at": rel.get("published_at"),
                        "url": rel.get("html_url"),
                    }
                )
        except Exception:
            continue
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--twitter-endpoint",
        default="https://api.bnbot.ai/api/v1/ai/kol-recent-data",
    )
    parser.add_argument("--twitter-page-size", type=int, default=100)
    parser.add_argument("--twitter-cursor", type=int, default=1)
    parser.add_argument("--twitter-compressed", action="store_true", default=False)
    parser.add_argument(
        "--twitter-search-endpoint",
        default="",
        help="Optional proactive Twitter search endpoint, e.g. https://api.xxx.com/search",
    )
    parser.add_argument(
        "--twitter-search-queries",
        default="AI agents,web3 infra,indie hacker,solopreneur SaaS,global growth",
        help="Comma-separated proactive search queries",
    )
    parser.add_argument("--twitter-search-auth", default="", help="Optional Authorization header value")
    parser.add_argument(
        "--twitter-search-provider",
        default="generic",
        help="generic | rapidapi-twitter47",
    )
    parser.add_argument(
        "--twitter-community-search-endpoint",
        default="",
        help="Optional community search endpoint, e.g. https://twitter-api47.p.rapidapi.com/v3/community/search",
    )
    parser.add_argument(
        "--twitter-community-queries",
        default="AI,Web3,indie hacker,solopreneur,startup",
        help="Comma-separated community search keywords",
    )
    parser.add_argument(
        "--twitter-community-posts-endpoint",
        default="",
        help="Optional endpoint/template to fetch community posts, supports {community_id}",
    )
    parser.add_argument("--out", default="data/daily-signals.json")
    args = parser.parse_args()

    now = dt.datetime.now(dt.UTC).isoformat()

    twitter_data = fetch_twitter_like(
        args.twitter_endpoint,
        page_size=args.twitter_page_size,
        compressed=args.twitter_compressed,
        cursor=args.twitter_cursor,
    )

    proactive_twitter_search = {}
    if args.twitter_search_endpoint:
        queries = [q.strip() for q in args.twitter_search_queries.split(",") if q.strip()]
        proactive_twitter_search = fetch_twitter_search(
            args.twitter_search_endpoint,
            queries,
            auth_header=args.twitter_search_auth,
            provider=args.twitter_search_provider,
        )

    proactive_twitter_communities = {}
    proactive_twitter_community_posts = {}
    if args.twitter_community_search_endpoint:
        community_queries = [q.strip() for q in args.twitter_community_queries.split(",") if q.strip()]
        proactive_twitter_communities = fetch_twitter_community_search(
            args.twitter_community_search_endpoint,
            community_queries,
            provider="rapidapi-twitter47",
        )

        if args.twitter_community_posts_endpoint:
            candidate_ids = extract_candidate_community_ids(proactive_twitter_communities, limit=8)
            proactive_twitter_community_posts = fetch_community_posts(
                args.twitter_community_posts_endpoint,
                candidate_ids,
                provider="rapidapi-twitter47",
            )

    ai_repos = search_repos("AI OR LLM OR agent language:TypeScript", per_page=12)
    web3_repos = search_repos("web3 OR blockchain OR crypto language:TypeScript", per_page=12)
    indie_repos = search_repos("indie hacker OR solopreneur SaaS", per_page=10)

    ai_issues = search_issues("AI agent bug fix is:open", per_page=8)
    web3_issues = search_issues("web3 issue is:open", per_page=8)

    data = {
        "generated_at": now,
        "sources": {
            "twitter_api": args.twitter_endpoint,
            "github_api": "https://api.github.com",
        },
        "twitter": twitter_data,
        "twitter_search": proactive_twitter_search,
        "twitter_community_search": proactive_twitter_communities,
        "twitter_community_posts": proactive_twitter_community_posts,
        "github": {
            "repos": {
                "ai": ai_repos,
                "web3": web3_repos,
                "indie": indie_repos,
            },
            "issues": {
                "ai": ai_issues,
                "web3": web3_issues,
            },
            "releases": {
                "ai": latest_releases(ai_repos),
                "web3": latest_releases(web3_repos),
            },
        },
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(args.out)


if __name__ == "__main__":
    main()
