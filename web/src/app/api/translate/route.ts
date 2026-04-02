import { NextResponse } from 'next/server';

const GOOGLE_TRANSLATE_ENDPOINT =
  'https://translate.googleapis.com/translate_a/single';

type TranslateRequest = {
  text?: string;
  targetLang?: string;
  sourceLang?: string;
};

export async function POST(request: Request) {
  let payload: TranslateRequest;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  const targetLang = payload.targetLang || 'zh-CN';
  const sourceLang = payload.sourceLang || 'auto';

  if (!text) {
    return NextResponse.json({ error: 'Missing text to translate' }, { status: 400 });
  }

  if (text.length > 1000) {
    return NextResponse.json(
      { error: 'Text exceeds maximum length of 1000 characters' },
      { status: 413 },
    );
  }

  try {
    const url = new URL(GOOGLE_TRANSLATE_ENDPOINT);
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', sourceLang);
    url.searchParams.set('tl', targetLang);
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', text);

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error('Translation request failed', response.status, response.statusText);
      return NextResponse.json(
        { error: 'Translation service unavailable' },
        { status: 502 },
      );
    }

    const data = (await response.json()) as any;
    const segments: string[] =
      Array.isArray(data) && Array.isArray(data[0])
        ? data[0]
            .filter((segment: any) => Array.isArray(segment) && segment[0])
            .map((segment: any) => segment[0])
        : [];

    const translation = segments.join('').trim();

    if (!translation) {
      return NextResponse.json(
        { error: 'No translation available' },
        { status: 204 },
      );
    }

    return NextResponse.json({
      translation,
      detectedSourceLang:
        Array.isArray(data) && typeof data[2] === 'string' ? data[2] : 'auto',
    });
  } catch (error) {
    console.error('Unexpected translation error', error);
    return NextResponse.json(
      { error: 'Failed to translate text' },
      { status: 500 },
    );
  }
}
