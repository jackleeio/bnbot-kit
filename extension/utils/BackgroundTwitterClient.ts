/**
 * BackgroundTwitterClient
 *
 * Service-worker-side X (Twitter) GraphQL client. Reads the `ct0` CSRF
 * cookie via `chrome.cookies.get` and lets `credentials: 'include'` carry
 * the rest of the auth cookies into the fetch — no x.com tab required.
 *
 * Counterpart to `TwitterClient` (which runs in the content script and
 * reads `document.cookie`). Kept intentionally minimal: only the
 * read-only analytics endpoints are exposed here, because writes
 * (post/reply/quote) still go through the CDP path for keystroke
 * fidelity + tracking-id headers that the page-context interceptor
 * injects.
 *
 * Requires:
 *   - manifest "cookies" permission
 *   - manifest host_permission "*://x.com/*"
 */

const QUERY_IDS = {
  accountOverview: 'LwtiA7urqM6eDeBheAFi5w',
  contentPostList: '8GMAigEhA0xy4rCM1_p7Fw',
}

// X.com's standard web-client bearer token. Public — same value every
// browser session uses. If X rotates it we'll need a refresh path, but
// it's been stable for years.
const BEARER_TOKEN =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

async function getCsrfToken(): Promise<string> {
  const cookie = await chrome.cookies.get({ url: 'https://x.com', name: 'ct0' })
  if (!cookie?.value) {
    throw new Error('未登录 x.com — 请先在浏览器登录 X 后再试')
  }
  return cookie.value
}

async function buildHeaders(): Promise<HeadersInit> {
  const csrf = await getCsrfToken()
  return {
    authorization: `Bearer ${BEARER_TOKEN}`,
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-client-language': 'en',
    'x-csrf-token': csrf,
    'content-type': 'application/json',
  }
}

async function fetchXGraphQL(url: string): Promise<unknown> {
  const headers = await buildHeaders()
  const response = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include',
  })
  if (!response.ok) {
    // Surface X's specific status codes with hand-written, actionable copy
    // instead of the raw "X GraphQL 429:" (which has no statusText body).
    if (response.status === 429) {
      const retryAfter = response.headers.get('x-rate-limit-reset')
      const retrySec = retryAfter ? Math.max(0, Number(retryAfter) - Math.floor(Date.now() / 1000)) : null
      const tail = retrySec && retrySec > 0 && retrySec < 3600
        ? `，约 ${Math.ceil(retrySec / 60)} 分钟后恢复`
        : ''
      throw new Error(`X 限流（429）— 短时间内请求次数过多${tail}`)
    }
    if (response.status === 401) {
      throw new Error('X 未授权（401）— 请在浏览器重新登录 X 后再试')
    }
    if (response.status === 403) {
      throw new Error('X 拒绝访问（403）— 该账号可能没有 Analytics 权限')
    }
    throw new Error(`X GraphQL ${response.status} ${response.statusText || ''}`.trim())
  }
  return await response.json()
}

export interface AccountAnalyticsParams {
  fromTime: string
  toTime: string
  granularity?: 'Daily' | 'Weekly' | 'Monthly'
}

export interface AccountAnalyticsData {
  followers?: number
  verifiedFollowers?: string | number
  timeSeries?: unknown[]
}

export async function getAccountAnalytics(
  params: AccountAnalyticsParams,
): Promise<AccountAnalyticsData> {
  const variables = {
    requested_metrics: [
      'Engagements',
      'Impressions',
      'ProfileVisits',
      'Follows',
      'Replies',
      'Likes',
      'Retweets',
      'Bookmark',
      'Share',
      'UrlClicks',
      'CreateTweet',
      'CreateQuote',
      'Unfollows',
      'CreateReply',
    ],
    from_time: params.fromTime,
    to_time: params.toTime,
    granularity: params.granularity ?? 'Daily',
    show_verified_followers: true,
  }
  const url = `https://x.com/i/api/graphql/${QUERY_IDS.accountOverview}/AccountOverviewQuery?variables=${encodeURIComponent(
    JSON.stringify(variables),
  )}`
  const response = (await fetchXGraphQL(url)) as {
    data?: {
      viewer_v2?: {
        user_results?: {
          result?: {
            relationship_counts?: { followers?: number }
            verified_follower_count?: string | number
            organic_metrics_time_series?: unknown[]
          }
        }
      }
    }
  }
  const result = response?.data?.viewer_v2?.user_results?.result
  if (!result) throw new Error('未获取到分析数据 — X 可能改了 schema 或未登录')
  return {
    followers: result.relationship_counts?.followers,
    verifiedFollowers: result.verified_follower_count,
    timeSeries: result.organic_metrics_time_series,
  }
}

export interface ReplyImpressionsParams {
  fromTime: string
  toTime: string
}

export interface ReplyItem {
  id: string
  text: string
  createdAt: string
  impressions: number
  engagements: number
  likes: number
  replies: number
  retweets: number
  profileVisits: number
  detailExpands: number
  bookmarks: number
  replyToId: string
}

export interface ReplyImpressionsResult {
  replies: ReplyItem[]
  totalImpressions: number
  totalEngagements: number
}

export async function getReplyImpressions(
  params: ReplyImpressionsParams,
): Promise<ReplyImpressionsResult> {
  const variables = {
    from_time: params.fromTime,
    to_time: params.toTime,
    max_results: 1000,
    query_page_size: 100,
    requested_metrics: [
      'Impressions',
      'Likes',
      'Engagements',
      'Bookmark',
      'Share',
      'Follows',
      'Replies',
      'Retweets',
      'ProfileVisits',
      'DetailExpands',
      'UrlClicks',
      'HashtagClicks',
      'PermalinkClicks',
    ],
  }
  const url = `https://x.com/i/api/graphql/${QUERY_IDS.contentPostList}/ContentPostListQuery?variables=${encodeURIComponent(
    JSON.stringify(variables),
  )}`
  const data = (await fetchXGraphQL(url)) as {
    data?: {
      viewer_v2?: {
        user_results?: {
          result?: { tweets_results?: Array<{ result?: TweetResultLike }> }
        }
      }
    }
  }
  const tweetsResults =
    data?.data?.viewer_v2?.user_results?.result?.tweets_results ?? []

  const result: ReplyImpressionsResult = {
    replies: [],
    totalImpressions: 0,
    totalEngagements: 0,
  }

  for (const tweetData of tweetsResults) {
    const tweet = tweetData?.result
    if (!tweet || tweet.__typename !== 'Tweet') continue
    if (!tweet.reply_to_results?.rest_id) continue // only replies

    const legacy = tweet.legacy ?? {}
    const metrics = tweet.organic_metrics_total ?? []
    const get = (type: string): number => {
      const m = metrics.find((x) => x.metric_type === type)
      return m?.metric_value ?? 0
    }

    const impressions = get('Impressions')
    const engagements = get('Engagements')

    result.replies.push({
      id: tweet.rest_id,
      text: legacy.full_text ?? '',
      createdAt: legacy.created_at ?? '',
      impressions,
      engagements,
      likes: get('Likes'),
      replies: get('Replies'),
      retweets: get('Retweets'),
      profileVisits: get('ProfileVisits'),
      detailExpands: get('DetailExpands'),
      bookmarks: get('Bookmark'),
      replyToId: tweet.reply_to_results.rest_id,
    })

    result.totalImpressions += impressions
    result.totalEngagements += engagements
  }

  return result
}

interface TweetResultLike {
  __typename?: string
  rest_id: string
  legacy?: { full_text?: string; created_at?: string }
  reply_to_results?: { rest_id?: string }
  organic_metrics_total?: Array<{ metric_type: string; metric_value?: number }>
}
