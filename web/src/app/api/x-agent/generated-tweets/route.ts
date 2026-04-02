import { NextResponse } from 'next/server';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const MIN_LIMIT = 1;

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const agentId = requestUrl.searchParams.get('agentId')?.trim();
  const limitParam = requestUrl.searchParams.get('limit');

  if (!agentId) {
    return NextResponse.json(
      { error: 'agentId query parameter is required' },
      { status: 400 },
    );
  }

  let limit = DEFAULT_LIMIT;
  if (limitParam) {
    const parsed = Number(limitParam);
    if (!Number.isNaN(parsed)) {
      limit = Math.min(Math.max(parsed, MIN_LIMIT), MAX_LIMIT);
    }
  }

  const authHeader =
    request.headers.get('authorization') ??
    request.headers.get('Authorization');

  if (!authHeader) {
    return NextResponse.json(
      { error: 'Missing Authorization header' },
      { status: 401 },
    );
  }

  const backendBase =
    process.env.NEXT_PUBLIC_REST_API_ENDPOINT || 'http://localhost:8000';
  const backendUrl = new URL(
    `/api/v1/agents/${encodeURIComponent(agentId)}/generated-tweets`,
    backendBase,
  );
  backendUrl.searchParams.set('limit', String(limit));

  try {
    const response = await fetch(backendUrl.toString(), {
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const rawBody = await response.text();
    let payload: unknown = null;

    if (rawBody) {
      try {
        payload = JSON.parse(rawBody);
      } catch (parseError) {
        console.error(
          '[generated-tweets] Failed to parse backend response',
          parseError,
        );
      }
    }

    if (!response.ok) {
      return NextResponse.json(
        payload ?? {
          error: 'Failed to fetch generated tweets from upstream service',
        },
        { status: response.status },
      );
    }

    if (!payload || typeof payload !== 'object') {
      payload = {
        success: true,
        agent_id: agentId,
        tweets: [],
        total_count: 0,
      };
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error('[generated-tweets] Upstream request failed', error);
    return NextResponse.json(
      { error: 'Failed to fetch generated tweets' },
      { status: 500 },
    );
  }
}
