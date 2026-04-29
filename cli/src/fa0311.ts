/**
 * fa0311 community-maintained X (Twitter) GraphQL queryId map.
 *
 * Runs in Node (CLI side) — no Content-Security-Policy in this context,
 * unlike the page-context fetch the extension would otherwise need to do.
 * Result is passed to the extension via WS payload as `queryIds`.
 *
 * Cache: ~/.bnbot/x-fa0311-cache.json with 24h TTL.
 *
 * Source: https://github.com/fa0311/twitter-openapi
 *
 * Resolution chain in extension twitter.ts:
 *   1. live x.com bundle scrape (sessionStorage 1h, covers 6/7 ops)
 *   2. payload.queryIds (this file → fa0311, covers everything incl. Bookmarks)
 *   3. throw
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const FA0311_URL = 'https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json'
const CACHE_DIR = join(homedir(), '.bnbot')
const CACHE_FILE = join(CACHE_DIR, 'x-fa0311-cache.json')
const TTL_MS = 24 * 60 * 60 * 1000

const QUERY_ID_PATTERN = /^[A-Za-z0-9_-]+$/

interface CacheEntry {
  ts: number
  ids: Record<string, string>
}

/** Read cache; returns null on miss / parse error / TTL expiry. */
function readCache(): Record<string, string> | null {
  try {
    if (!existsSync(CACHE_FILE)) return null
    const raw = readFileSync(CACHE_FILE, 'utf8')
    const entry = JSON.parse(raw) as CacheEntry
    if (!entry.ts || !entry.ids || Date.now() - entry.ts > TTL_MS) return null
    return entry.ids
  } catch {
    return null
  }
}

function writeCache(ids: Record<string, string>): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(CACHE_FILE, JSON.stringify({ ts: Date.now(), ids } as CacheEntry))
  } catch {
    // Cache write failures are non-fatal — we'll just refetch next time.
  }
}

async function fetchFa0311(): Promise<Record<string, string> | null> {
  try {
    const res = await fetch(FA0311_URL)
    if (!res.ok) return null
    const body = (await res.json()) as Record<string, { queryId?: string }>
    const ids: Record<string, string> = {}
    for (const [op, entry] of Object.entries(body)) {
      const qid = entry?.queryId
      if (typeof qid === 'string' && QUERY_ID_PATTERN.test(qid)) ids[op] = qid
    }
    return Object.keys(ids).length > 0 ? ids : null
  } catch {
    return null
  }
}

/**
 * Get the X queryId map. Cached for 24h to ~/.bnbot/x-fa0311-cache.json.
 *
 * On cache miss + network failure, returns the stale cache (better than
 * nothing) or `{}` if no cache ever existed. The extension's bundle
 * scrape covers most ops anyway — fa0311 is the safety net.
 */
export async function getXQueryIds(): Promise<Record<string, string>> {
  const cached = readCache()
  if (cached) return cached
  const fresh = await fetchFa0311()
  if (fresh) {
    writeCache(fresh)
    return fresh
  }
  // Network failed and no fresh cache — try stale cache (older than 24h).
  try {
    if (existsSync(CACHE_FILE)) {
      const entry = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as CacheEntry
      if (entry.ids) return entry.ids
    }
  } catch {}
  return {}
}
