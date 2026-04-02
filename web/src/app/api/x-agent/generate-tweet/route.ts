import { NextResponse } from 'next/server';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const toFiniteInteger = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number(trimmed);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return null;
};

const normalizeRequestOptions = (
  payload: Record<string, unknown>,
): Record<string, unknown> => {
  const requestBody: Record<string, unknown> = {};

  const prompt = toTrimmedString(payload.prompt);
  if (prompt) {
    requestBody.prompt = prompt;
  }

  const maxRetries =
    toFiniteInteger((payload as Record<string, unknown>).max_retries) ??
    toFiniteInteger(payload.maxRetries);
  if (maxRetries !== null) {
    requestBody.max_retries = Math.max(0, maxRetries);
  }

  const timeout = toFiniteInteger(payload.timeout);
  if (timeout !== null) {
    requestBody.timeout = Math.max(0, timeout);
  }

  if (isRecord(payload.options)) {
    for (const [key, value] of Object.entries(payload.options)) {
      if (typeof key === 'string' && value !== undefined) {
        requestBody[key] = value;
      }
    }
  }

  return requestBody;
};

export async function POST(request: Request) {
  let payload: Record<string, unknown> | null = null;

  try {
    const body = await request.json();
    if (isRecord(body)) {
      payload = body;
    }
  } catch (error) {
    console.error('[generate-tweet] Failed to parse request body', error);
  }

  if (!payload) {
    return NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400 },
    );
  }

  const agentId = toTrimmedString(payload.agentId);

  if (!agentId) {
    return NextResponse.json(
      { error: 'agentId is required' },
      { status: 400 },
    );
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

  const requestOptions = normalizeRequestOptions(payload);

  if (isRecord(payload.request)) {
    for (const [key, value] of Object.entries(payload.request)) {
      if (value !== undefined) {
        requestOptions[key] = value;
      }
    }
  }

  delete requestOptions['agent_id'];
  delete requestOptions['agentId'];

  const backendPayload: Record<string, unknown> = {
    agent_id: agentId,
    ...requestOptions,
  };

  const backendBase =
    process.env.NEXT_PUBLIC_REST_API_ENDPOINT || 'http://localhost:8000';
  const backendUrl = new URL(
    `/api/v1/agents/${encodeURIComponent(agentId)}/generate-tweet`,
    backendBase,
  );

  try {
    const response = await fetch(backendUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(backendPayload),
      cache: 'no-store',
    });

    const rawBody = await response.text();
    let upstreamPayload: unknown = null;

    if (rawBody) {
      try {
        upstreamPayload = JSON.parse(rawBody);
      } catch (parseError) {
        console.error(
          '[generate-tweet] Failed to parse backend response',
          parseError,
        );
      }
    }

    if (!response.ok) {
      return NextResponse.json(
        upstreamPayload ?? { error: 'Failed to generate tweet' },
        { status: response.status },
      );
    }

    if (!upstreamPayload) {
      upstreamPayload = { success: true };
    }

    return NextResponse.json(upstreamPayload);
  } catch (error) {
    console.error('[generate-tweet] Upstream request failed', error);
    return NextResponse.json(
      { error: 'Failed to generate tweet' },
      { status: 500 },
    );
  }
}
