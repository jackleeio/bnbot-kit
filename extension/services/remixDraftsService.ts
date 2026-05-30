/**
 * remixDraftsService — talks to the local BNBot desktop agent over its
 * HTTP API (http://127.0.0.1:27421) to surface "二创草稿" inline in the
 * Chrome extension popup.
 *
 * Backed by agent endpoints added in bnbot/src/entrypoints/web.tsx:
 *   GET    /api/remix-drafts          → { drafts: [...] }
 *   GET    /api/remix-drafts/<id>     → single draft JSON
 *   DELETE /api/remix-drafts/<id>     → remove draft
 *
 * CORS is `*` on those routes, and host_permissions/CSP already include
 * 127.0.0.1, so the content-script popup fetches directly without going
 * through background.ts.
 */

const AGENT_HTTP = 'http://127.0.0.1:27421';

export const REMIX_DRAFTS_STREAM_URL = `${AGENT_HTTP}/api/remix-drafts/stream`;

export interface RemixDraftSource {
  url?: string;
  author?: string;
  authorDisplayName?: string;
  text?: string;
}

export interface RemixDraftBody {
  text: string;
  mediaPath?: string | null;
}

export interface RemixDraftMeta {
  wordCount?: number;
  language?: string;
  model?: string;
}

export interface RemixDraft {
  id: string;
  createdAt: number;
  source?: RemixDraftSource;
  draft: RemixDraftBody;
  meta?: RemixDraftMeta;
  path?: string;
}

/**
 * Agent returns whatever shape /remix wrote. Be permissive but require id
 * + draft.text to be usable. Shared between the one-shot GET and the SSE
 * message handler.
 */
export function normalizeDrafts(raw: unknown): RemixDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: RemixDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : '';
    if (!id) continue;
    const draftField = (r.draft && typeof r.draft === 'object') ? r.draft as Record<string, unknown> : null;
    const text = typeof draftField?.text === 'string'
      ? draftField.text
      : (typeof r.draftText === 'string' ? r.draftText : '');
    if (!text) continue;
    out.push({
      id,
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
      source: (r.source && typeof r.source === 'object') ? r.source as RemixDraftSource : undefined,
      draft: {
        text,
        mediaPath: typeof draftField?.mediaPath === 'string' ? draftField.mediaPath : null,
      },
      meta: (r.meta && typeof r.meta === 'object') ? r.meta as RemixDraftMeta : undefined,
      path: typeof r.path === 'string' ? r.path : undefined,
    });
  }
  return out;
}

export async function listRemixDrafts(): Promise<RemixDraft[]> {
  const res = await fetch(`${AGENT_HTTP}/api/remix-drafts`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { drafts?: unknown[] };
  return normalizeDrafts(body.drafts);
}

export async function deleteRemixDraft(id: string): Promise<void> {
  const res = await fetch(`${AGENT_HTTP}/api/remix-drafts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function agentReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${AGENT_HTTP}/api/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
