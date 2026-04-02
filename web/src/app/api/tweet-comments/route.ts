import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const tweetId = searchParams.get('tweet_id');
  const cursor = searchParams.get('cursor');

  if (!tweetId) {
    return NextResponse.json(
      { code: 0, msg: 'tweet_id is required', data: [] },
      { status: 400 }
    );
  }

  try {
    // Build backend URL
    const params = new URLSearchParams({ tweet_id: tweetId });
    if (cursor) {
      params.append('cursor', cursor);
    }

    const backendUrl = `${process.env.NEXT_PUBLIC_REST_API_ENDPOINT}/api/v1/x-public/tweet-comments?${params.toString()}`;

    // Make request to backend with API key
    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-public-key': process.env.NEXT_PUBLIC_X_PUBLIC_API_KEY || '',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Backend error:', response.status, errorText);
      return NextResponse.json(
        { code: 0, msg: 'Failed to fetch comments from backend', data: [] },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching tweet comments:', error);
    return NextResponse.json(
      { code: 0, msg: 'Internal server error', data: [] },
      { status: 500 }
    );
  }
}
