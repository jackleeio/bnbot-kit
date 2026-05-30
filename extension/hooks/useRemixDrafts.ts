import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listRemixDrafts,
  normalizeDrafts,
  REMIX_DRAFTS_STREAM_URL,
  type RemixDraft,
} from '../services/remixDraftsService';

export interface UseRemixDraftsResult {
  drafts: RemixDraft[];
  count: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Subscribes to the desktop agent's SSE stream
 * (`GET /api/remix-drafts/stream`) for live drafts updates. EventSource
 * auto-reconnects on transient connection drops, so the only state we
 * manage manually is the "agent unreachable" flag (raised on `error`,
 * cleared on `open`/`message`).
 *
 * `enabled=false` keeps the connection closed and stays at last known
 * state — used to gate polling when the popup is collapsed.
 */
export function useRemixDrafts(enabled: boolean = true): UseRemixDraftsResult {
  const [drafts, setDrafts] = useState<RemixDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  // Manual refresh — used by the panel's refresh button. Falls back to
  // the one-shot HTTP fetch (separate from the SSE stream) so it works
  // even if the stream connection is in a flaky reconnect cycle.
  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listRemixDrafts();
      if (!aliveRef.current) return;
      setDrafts(list);
      setError(null);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (!enabled) return () => { aliveRef.current = false; };

    let es: EventSource | null = null;
    try {
      es = new EventSource(REMIX_DRAFTS_STREAM_URL);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'EventSource unavailable');
      return () => { aliveRef.current = false; };
    }

    es.onmessage = (ev) => {
      if (!aliveRef.current) return;
      try {
        const body = JSON.parse(ev.data) as { drafts?: unknown };
        setDrafts(normalizeDrafts(body.drafts));
        setError(null);
      } catch {
        // Ignore non-JSON frames (e.g. server-sent comments — actually
        // those start with `:` and aren't routed to onmessage anyway).
      }
    };

    es.onopen = () => {
      if (aliveRef.current) setError(null);
    };

    es.onerror = () => {
      if (!aliveRef.current) return;
      // EventSource will silently retry. Mark agent unreachable for the
      // UI hint but keep the drafts list as-is (stale-while-revalidate).
      setError('agent unreachable');
    };

    return () => {
      aliveRef.current = false;
      es?.close();
    };
  }, [enabled]);

  return { drafts, count: drafts.length, loading, error, refetch };
}
