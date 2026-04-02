'use client';

import { use, useCallback, useEffect, useState } from 'react';

// ---- Types ----

interface MediaItem {
  url: string;
  type: 'photo' | 'video';
}

interface DraftPreview {
  id: string;
  draft_type: string;
  title: string | null;
  content: {
    type?: string;
    data?: {
      drafts?: { content?: string; media?: MediaItem[] | null }[];
      timeline?: { text?: string; media?: MediaItem[] }[];
    };
  };
  scheduled_at: string | null;
  publish_status: string;
  published_at: string | null;
  created_at: string;
}

type Theme = 'light' | 'dark' | 'dim';

interface ThemeColors {
  pageBg: string;
  cardBg: string;
  text: string;
  secondary: string;
  border: string;
  metricsBold: string;
}

const THEMES: Record<Theme, ThemeColors> = {
  light: {
    pageBg: '#f7f9f9',
    cardBg: '#ffffff',
    text: '#0f1419',
    secondary: '#536471',
    border: '#eff3f4',
    metricsBold: '#0f1419',
  },
  dark: {
    pageBg: '#000000',
    cardBg: '#16181c',
    text: '#e7e9ea',
    secondary: '#71767b',
    border: '#2f3336',
    metricsBold: '#e7e9ea',
  },
  dim: {
    pageBg: '#15202b',
    cardBg: '#1e2732',
    text: '#e7e9ea',
    secondary: '#8b98a5',
    border: '#38444d',
    metricsBold: '#e7e9ea',
  },
};

// ---- Config ----

const API_BASE_URL =
  process.env.NEXT_PUBLIC_REST_API_ENDPOINT || 'http://localhost:8000';

// ---- SVG Icons (X/Twitter style) ----

const ReplyIcon = () => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
    <path d="M14.046 2.242l-4.148-.01h-.002c-4.374 0-7.8 3.427-7.8 7.802 0 4.098 3.186 7.206 7.465 7.37v3.828a.85.85 0 00.12.403.744.744 0 001.034.229c.264-.168 6.473-4.14 8.088-5.506 1.902-1.61 3.04-3.97 3.043-6.312v-.017c-.006-4.367-3.43-7.787-7.8-7.788zm3.787 12.972c-1.134.96-4.862 3.405-6.772 4.643V16.67a.75.75 0 00-.75-.75h-.396c-3.66 0-6.318-2.476-6.318-5.886 0-3.534 2.768-6.302 6.3-6.302l4.147.01h.002c3.532 0 6.3 2.766 6.302 6.296-.003 1.91-.942 3.844-2.514 5.176z" />
  </svg>
);

const RetweetIcon = () => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
    <path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" />
  </svg>
);

const LikeIcon = () => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
    <path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z" />
  </svg>
);

const ViewsIcon = () => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
    <path d="M8.75 21V3h2v18h-2zM18.75 21V8.5h2V21h-2zM13.75 21v-9h2v9h-2zM3.75 21v-4h2v4h-2z" />
  </svg>
);

const BookmarkIcon = () => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
    <path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z" />
  </svg>
);

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
    <path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" />
  </svg>
);

const VerifiedIcon = () => (
  <svg viewBox="0 0 22 22" className="ml-0.5 inline-block h-[18px] w-[18px]">
    <path
      d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.855-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.69-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.636.433 1.221.878 1.69.47.446 1.055.752 1.69.883.635.13 1.294.083 1.902-.144.271.587.702 1.086 1.24 1.44.538.354 1.167.551 1.813.568.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.223 1.26.272 1.893.143.636-.13 1.222-.434 1.693-.882.445-.47.749-1.055.878-1.691.13-.634.08-1.29-.144-1.898.587-.271 1.084-.7 1.438-1.24.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"
      fill="#1d9bf0"
    />
  </svg>
);

// ---- Helpers ----

function formatTweetDate(iso: string): string {
  const d = new Date(iso);
  const hours = d.getHours();
  const mins = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${h}:${mins} ${ampm} \u00B7 ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toString();
}

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  published: { bg: 'bg-green-100', text: 'text-green-700', label: 'Published' },
  scheduled: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Scheduled' },
  failed: { bg: 'bg-red-100', text: 'text-red-700', label: 'Failed' },
  draft: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Draft' },
};

// ---- Image Lightbox ----

function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
          <path d="M10.59 12L4.54 5.96l1.42-1.42L12 10.59l6.04-6.05 1.42 1.42L13.41 12l6.05 6.04-1.42 1.42L12 13.41l-6.04 6.05-1.42-1.42L10.59 12z" />
        </svg>
      </button>
      <img
        src={url}
        alt=""
        className="max-h-[90vh] max-w-[90vw] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ---- Theme Switcher ----

function ThemeSwitcher({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  const options: { value: Theme; label: string; bg: string; activeBg: string; activeText: string }[] = [
    { value: 'light', label: 'Light', bg: 'transparent', activeBg: '#ffffff', activeText: '#0f1419' },
    { value: 'dark', label: 'Dark', bg: 'transparent', activeBg: '#000000', activeText: '#e7e9ea' },
    { value: 'dim', label: 'Dim', bg: 'transparent', activeBg: '#15202b', activeText: '#e7e9ea' },
  ];
  return (
    <div className="flex items-center gap-1 rounded-full p-1" style={{ backgroundColor: 'rgba(128,128,128,0.08)' }}>
      {options.map((o) => {
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className="rounded-full px-3 py-1 text-xs font-medium transition-all"
            style={{
              backgroundColor: active ? o.activeBg : o.bg,
              color: active ? o.activeText : '#71767b',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- Media Grid (Twitter-style) ----

function VideoPlayer({ url }: { url: string }) {
  const [loading, setLoading] = useState(true);
  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#2a2a2a]">
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-gray-600 border-t-gray-300" />
          </div>
          {/* skeleton bars */}
          <div className="absolute bottom-0 left-0 right-0 space-y-2 p-4">
            <div className="h-1.5 w-full rounded bg-gray-700" />
            <div className="flex justify-between">
              <div className="h-3 w-12 rounded bg-gray-700" />
              <div className="flex gap-3">
                <div className="h-5 w-5 rounded bg-gray-700" />
                <div className="h-5 w-5 rounded bg-gray-700" />
                <div className="h-5 w-5 rounded bg-gray-700" />
              </div>
            </div>
          </div>
        </div>
      )}
      <video
        src={url}
        controls
        playsInline
        className="w-full max-h-[400px] object-cover bg-black"
        onLoadedData={() => setLoading(false)}
      />
    </div>
  );
}

function MediaGrid({ media, borderColor, onImageClick }: { media: MediaItem[]; borderColor: string; onImageClick: (url: string) => void }) {
  if (!media || media.length === 0) return null;

  const count = media.length;
  const imgClass = 'w-full object-cover cursor-pointer transition-opacity hover:opacity-90';

  if (count === 1) {
    const m = media[0];
    return (
      <div className="mt-3 overflow-hidden rounded-2xl" style={{ border: `1px solid ${borderColor}` }}>
        {m.type === 'video' ? (
          <VideoPlayer url={m.url} />
        ) : (
          <img src={m.url} alt="" className={`${imgClass} max-h-[510px]`} onClick={() => onImageClick(m.url)} />
        )}
      </div>
    );
  }

  if (count === 2) {
    return (
      <div className="mt-3 grid grid-cols-2 gap-0.5 overflow-hidden rounded-2xl" style={{ border: `1px solid ${borderColor}` }}>
        {media.map((m, i) => (
          <img key={i} src={m.url} alt="" className={`${imgClass} aspect-[4/5]`} onClick={() => onImageClick(m.url)} />
        ))}
      </div>
    );
  }

  if (count === 3) {
    return (
      <div className="mt-3 grid grid-cols-2 gap-0.5 overflow-hidden rounded-2xl" style={{ border: `1px solid ${borderColor}` }}>
        <img src={media[0].url} alt="" className={`${imgClass} row-span-2 aspect-[4/5]`} onClick={() => onImageClick(media[0].url)} />
        <img src={media[1].url} alt="" className={`${imgClass} aspect-square`} onClick={() => onImageClick(media[1].url)} />
        <img src={media[2].url} alt="" className={`${imgClass} aspect-square`} onClick={() => onImageClick(media[2].url)} />
      </div>
    );
  }

  return (
    <div className="mt-3 grid grid-cols-2 gap-0.5 overflow-hidden rounded-2xl" style={{ border: `1px solid ${borderColor}` }}>
      {media.slice(0, 4).map((m, i) => (
        <img key={i} src={m.url} alt="" className={`${imgClass} aspect-video`} onClick={() => onImageClick(m.url)} />
      ))}
    </div>
  );
}

// ---- Mock Data ----

function getMockDraft(): DraftPreview {
  const now = new Date();
  const scheduled = new Date(now);
  scheduled.setHours(18, 0, 0, 0);
  return {
    id: 'demo-draft-001',
    draft_type: 'tweet',
    title: null,
    content: {
      type: 'tweet_draft',
      data: {
        drafts: [{
          content: 'AI agents are the new SaaS. The companies that figure out agent-to-agent communication will win the next decade.\n\nThink about it: every API will become an agent endpoint. Every SaaS will have an agent layer. Every workflow will be agent-orchestrated.\n\nThe question isn\'t IF, it\'s WHEN. And I think "when" is 2026.',
        }],
      },
    },
    scheduled_at: scheduled.toISOString(),
    publish_status: 'scheduled',
    published_at: null,
    created_at: new Date(now.getTime() - 3600000).toISOString(),
  };
}

function getMockMediaDraft(): DraftPreview {
  const now = new Date();
  const scheduled = new Date(now);
  scheduled.setHours(21, 0, 0, 0);
  return {
    id: 'demo-draft-003',
    draft_type: 'tweet',
    title: null,
    content: {
      type: 'tweet_draft',
      data: {
        drafts: [{
          content: 'Just shipped the new BNBot draft preview feature. Create tweets from CLI, schedule them, and preview on mobile.\n\nThe future of social media management is agent-driven.',
          media: [
            { url: 'https://picsum.photos/seed/bnbot1/800/450', type: 'photo' as const },
            { url: 'https://picsum.photos/seed/bnbot2/800/450', type: 'photo' as const },
          ],
        }],
      },
    },
    scheduled_at: scheduled.toISOString(),
    publish_status: 'scheduled',
    published_at: null,
    created_at: new Date(now.getTime() - 1800000).toISOString(),
  };
}

function getMock4ImgDraft(): DraftPreview {
  const now = new Date();
  const scheduled = new Date(now);
  scheduled.setHours(15, 0, 0, 0);
  return {
    id: 'demo-draft-004',
    draft_type: 'tweet',
    title: null,
    content: {
      type: 'tweet_draft',
      data: {
        drafts: [{
          content: 'Building in public update: just wrapped up the new dashboard design.\n\nHere are some screenshots from the design process.',
          media: [
            { url: 'https://picsum.photos/seed/dash1/800/600', type: 'photo' as const },
            { url: 'https://picsum.photos/seed/dash2/800/600', type: 'photo' as const },
            { url: 'https://picsum.photos/seed/dash3/800/600', type: 'photo' as const },
            { url: 'https://picsum.photos/seed/dash4/800/600', type: 'photo' as const },
          ],
        }],
      },
    },
    scheduled_at: scheduled.toISOString(),
    publish_status: 'scheduled',
    published_at: null,
    created_at: new Date(now.getTime() - 7200000).toISOString(),
  };
}

function getMockVideoDraft(): DraftPreview {
  const now = new Date();
  const scheduled = new Date(now);
  scheduled.setHours(20, 0, 0, 0);
  return {
    id: 'demo-draft-005',
    draft_type: 'tweet',
    title: null,
    content: {
      type: 'tweet_draft',
      data: {
        drafts: [{
          content: 'Quick demo of the new AI auto-reply feature in action.',
          media: [
            { url: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4', type: 'video' as const },
          ],
        }],
      },
    },
    scheduled_at: scheduled.toISOString(),
    publish_status: 'draft',
    published_at: null,
    created_at: new Date(now.getTime() - 600000).toISOString(),
  };
}

function getMockThread(): DraftPreview {
  const now = new Date();
  const scheduled = new Date(now);
  scheduled.setDate(scheduled.getDate() + 1);
  scheduled.setHours(9, 0, 0, 0);
  return {
    id: 'demo-draft-002',
    draft_type: 'thread',
    title: null,
    content: {
      type: 'tweet_timeline',
      data: {
        timeline: [
          { text: 'Web3 social is changing fast. Here are 3 trends I\'m watching closely:\n\n(a thread)' },
          { text: '1/ Decentralized identity will become the default.\n\nYour Twitter handle is NOT your identity. DIDs are. When you own your identity across platforms, the power shifts from platforms to users.' },
          { text: '2/ Content ownership returns to creators.\n\nWhen your followers don\'t belong to a platform, when your content can migrate freely, the entire creator economy power structure changes.' },
          { text: '3/ AI + Social = Superindividuals.\n\nOne person + AI agent can match the output of a 10-person team. Content creation, community management, data analysis, all automated.\n\nThis is why I\'m building BNBot.' },
        ],
      },
    },
    scheduled_at: scheduled.toISOString(),
    publish_status: 'scheduled',
    published_at: null,
    created_at: now.toISOString(),
  };
}

// ---- Tweet Components ----

function Avatar({ size = 40 }: { size?: number }) {
  const iconSize = Math.round(size * 0.5);
  return (
    <div
      className="flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-black"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" style={{ width: iconSize, height: iconSize }} className="fill-white">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    </div>
  );
}

function randMetric(): number {
  return Math.floor(Math.random() * 900) + 100;
}

interface Metrics {
  retweets: number;
  quotes: number;
  likes: number;
  bookmarks: number;
  views: number;
}

function ActionBar({ c, metrics }: { c: ThemeColors; metrics: Metrics }) {
  const actions = [
    { icon: <ReplyIcon />, count: metrics.retweets },
    { icon: <RetweetIcon />, count: metrics.quotes },
    { icon: <LikeIcon />, count: metrics.likes },
    { icon: <ViewsIcon />, count: metrics.views },
    { icon: <BookmarkIcon />, count: metrics.bookmarks },
    { icon: <ShareIcon /> },
  ];
  return (
    <div className="flex items-center justify-between py-3" style={{ borderTop: `1px solid ${c.border}`, color: c.secondary }}>
      {actions.map((a, i) => (
        <div key={i} className="flex cursor-pointer items-center gap-1 transition-colors hover:text-[#1d9bf0]">
          {a.icon}
          {a.count !== undefined && (
            <span className="text-[13px]">{formatNumber(a.count)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function SingleTweetCard({ text, date, media, metrics, c, onImageClick }: { text: string; date: string; media?: MediaItem[] | null; metrics: Metrics; c: ThemeColors; onImageClick: (url: string) => void }) {
  return (
    <div className="rounded-2xl px-4 pt-3" style={{ backgroundColor: c.cardBg, border: `1px solid ${c.border}` }}>
      {/* Header */}
      <div className="flex gap-3">
        <Avatar size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-0.5">
            <span className="text-[15px] font-bold" style={{ color: c.text }}>YourName</span>
            <VerifiedIcon />
          </div>
          <div className="text-[15px]" style={{ color: c.secondary }}>@user</div>
        </div>
      </div>

      {/* Content */}
      <div className="mt-3">
        <p className="whitespace-pre-wrap text-[17px] leading-[24px]" style={{ color: c.text }}>
          {text}
        </p>
        {media && media.length > 0 && <MediaGrid media={media} borderColor={c.border} onImageClick={onImageClick} />}
      </div>

      {/* Timestamp */}
      <div className="mt-3 pb-1 text-[15px]" style={{ color: c.secondary }}>
        <span>{formatTweetDate(date)}</span>
      </div>

      {/* Action bar with counts */}
      <ActionBar c={c} metrics={metrics} />
    </div>
  );
}

function ThreadCard({ tweets, date, metrics, c }: { tweets: { text?: string }[]; date: string; metrics: Metrics; c: ThemeColors }) {
  const lineColor = c.border;
  return (
    <div className="rounded-2xl" style={{ backgroundColor: c.cardBg, border: `1px solid ${c.border}` }}>
      {tweets.map((tweet, i) => {
        const isLast = i === tweets.length - 1;
        return (
          <div key={i} className={`relative px-4 ${i === 0 ? 'pt-3' : 'pt-0'}`}>
            <div className="flex gap-2">
              <div className="flex flex-col items-center">
                <Avatar />
                {!isLast && (
                  <div className="mt-1 w-0.5 flex-1" style={{ backgroundColor: lineColor }} />
                )}
              </div>
              <div className={`min-w-0 flex-1 ${!isLast ? 'pb-4' : ''}`}>
                <div className="flex items-center gap-1">
                  <span className="text-[15px] font-bold" style={{ color: c.text }}>YourName</span>
                  <VerifiedIcon />
                  <span className="text-[15px]" style={{ color: c.secondary }}>@user</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-[20px]" style={{ color: c.text }}>
                  {tweet.text || ''}
                </p>
              </div>
            </div>
          </div>
        );
      })}
      <div className="mx-4 pb-1 pt-2 text-[15px]" style={{ color: c.secondary }}>
        <span>{formatTweetDate(date)}</span>
      </div>
      <div className="px-4">
        <ActionBar c={c} metrics={metrics} />
      </div>
    </div>
  );
}

// ---- Page ----

interface PageProps {
  params: Promise<{ shareKey: string }>;
}

export default function DraftPreviewPage({ params }: PageProps) {
  const { shareKey } = use(params);
  const DEMO_KEYS: Record<string, () => DraftPreview> = {
    'demo': getMockDraft,
    'demo-thread': getMockThread,
    'demo-media': getMockMediaDraft,
    'demo-4img': getMock4ImgDraft,
    'demo-video': getMockVideoDraft,
  };
  const isDemo = shareKey in DEMO_KEYS;
  const [draft, setDraft] = useState<DraftPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('light');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const openLightbox = useCallback((url: string) => setLightboxUrl(url), []);
  const closeLightbox = useCallback(() => setLightboxUrl(null), []);

  const c = THEMES[theme];

  useEffect(() => {
    if (isDemo) {
      const mockMap = DEMO_KEYS;
      setDraft((mockMap[shareKey] || getMockDraft)());
      setLoading(false);
      return;
    }
    async function fetchDraft() {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/v1/public/draft/${shareKey}`,
        );
        if (!res.ok) {
          setError(res.status === 404 ? 'Draft not found' : `Failed to load (${res.status})`);
          return;
        }
        const json: DraftPreview = await res.json();
        setDraft(json);
      } catch {
        setError('Network error');
      } finally {
        setLoading(false);
      }
    }
    fetchDraft();
  }, [shareKey, isDemo]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-800" />
      </div>
    );
  }

  if (error || !draft) {
    return (
      <div className="py-20 text-center text-sm text-gray-500">
        {error || 'Draft not found'}
      </div>
    );
  }

  const isThread = draft.draft_type === 'thread' || draft.content?.type === 'tweet_timeline';
  const tweets = draft.content?.data?.timeline;
  const singleText = draft.content?.data?.drafts?.[0]?.content;
  const date = draft.scheduled_at || draft.created_at;
  const status = STATUS_BADGE[draft.publish_status] || STATUS_BADGE.draft;
  const metrics = {
    retweets: randMetric(),
    quotes: randMetric(),
    likes: randMetric(),
    bookmarks: randMetric(),
    views: randMetric() * 100,
  };

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center overflow-y-auto px-4 py-8 transition-colors duration-300"
      style={{ backgroundColor: c.pageBg, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}
    >
      <div className="w-full max-w-[598px] space-y-3">
        {/* Top bar: status + theme */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${status.bg} ${status.text}`}>
              {status.label}
            </span>
            {draft.scheduled_at && (
              <span className="text-xs" style={{ color: c.secondary }}>
                {formatTweetDate(draft.scheduled_at)}
              </span>
            )}
          </div>
          <ThemeSwitcher theme={theme} onChange={setTheme} />
        </div>

        {/* Tweet card */}
        {isThread && tweets ? (
          <ThreadCard tweets={tweets} date={date} metrics={metrics} c={c} />
        ) : singleText ? (
          <SingleTweetCard text={singleText} date={date} media={draft.content?.data?.drafts?.[0]?.media} metrics={metrics} c={c} onImageClick={openLightbox} />
        ) : (
          <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: c.cardBg, border: `1px solid ${c.border}`, color: c.secondary }}>
            (empty draft)
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-center gap-1.5 pt-2">
          <img src="/icons/bnbot-new-logo-sm.png" alt="BNBot" className="h-4 w-4" />
          <span className="text-xs" style={{ color: c.secondary }}>Draft preview powered by</span>
          <span className="text-xs font-semibold text-[#e63946]">BNBot</span>
        </div>
      </div>

      {/* Image lightbox */}
      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={closeLightbox} />}
    </div>
  );
}
