'use client';

import { use, useEffect, useState, useMemo } from 'react';

// ---- Types ----

interface DraftPreview {
  id: string;
  draft_type: string;
  title: string | null;
  content: DraftContent;
  scheduled_at: string | null;
  publish_status: string; // "draft" | "scheduled" | "published" | "failed"
  published_at: string | null;
  created_at: string;
}

interface DraftContent {
  type?: string;
  data?: {
    drafts?: { content?: string }[];
    timeline?: { text?: string }[];
  };
}

interface ScheduleResponse {
  data: DraftPreview[];
  count: number;
}

// ---- Helpers ----

const API_BASE_URL =
  process.env.NEXT_PUBLIC_REST_API_ENDPOINT || 'http://localhost:8000';

function getDraftText(draft: DraftPreview): string {
  const c = draft.content;
  if (c?.data?.drafts?.[0]?.content) return c.data.drafts[0].content;
  if (c?.data?.timeline?.[0]?.text) {
    return c.data.timeline.map((t) => t.text).join('\n---\n');
  }
  if (draft.title) return draft.title;
  return '(empty draft)';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  published: { dot: 'bg-green-500', label: 'Published' },
  scheduled: { dot: 'bg-yellow-400', label: 'Scheduled' },
  failed: { dot: 'bg-red-500', label: 'Failed' },
  draft: { dot: 'bg-gray-400', label: 'Draft' },
};

// ---- Calendar helpers ----

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

// ---- Components ----

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.draft;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function DraftCard({
  draft,
  expanded,
  onToggle,
}: {
  draft: DraftPreview;
  expanded: boolean;
  onToggle: () => void;
}) {
  const text = getDraftText(draft);
  const isThread =
    draft.draft_type === 'thread' ||
    draft.content?.type === 'tweet_timeline';
  const threadCount = draft.content?.data?.timeline?.length;

  return (
    <button
      onClick={onToggle}
      className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left transition hover:border-gray-300"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            {draft.scheduled_at && (
              <span className="text-xs font-medium text-gray-700">
                {formatTime(draft.scheduled_at)}
              </span>
            )}
            <StatusBadge status={draft.publish_status} />
            {isThread && threadCount && (
              <span className="text-xs text-gray-400">
                {threadCount} tweets
              </span>
            )}
          </div>
          <p
            className={`text-sm text-gray-800 ${expanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}
          >
            {text}
          </p>
        </div>
      </div>
      {expanded && draft.published_at && (
        <p className="mt-2 text-xs text-gray-400">
          Published {formatDate(draft.published_at)}{' '}
          {formatTime(draft.published_at)}
        </p>
      )}
    </button>
  );
}

function MiniCalendar({
  year,
  month,
  draftDates,
  selectedDate,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
}: {
  year: number;
  month: number;
  draftDates: Set<string>;
  selectedDate: Date | null;
  onSelectDate: (d: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const today = new Date();
  const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const monthLabel = new Date(year, month).toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      {/* Month navigation */}
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={onPrevMonth}
          className="rounded p-1 text-gray-500 hover:bg-gray-100"
          aria-label="Previous month"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <span className="text-sm font-semibold text-gray-900">
          {monthLabel}
        </span>
        <button
          onClick={onNextMonth}
          className="rounded p-1 text-gray-500 hover:bg-gray-100"
          aria-label="Next month"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>

      {/* Weekday headers */}
      <div className="mb-1 grid grid-cols-7 text-center text-xs text-gray-400">
        {weekdays.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 text-center text-sm">
        {/* Empty cells before first day */}
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`e-${i}`} className="py-1" />
        ))}
        {/* Day cells */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dateObj = new Date(year, month, day);
          const hasDraft = draftDates.has(dateKey);
          const isToday = isSameDay(dateObj, today);
          const isSelected = selectedDate && isSameDay(dateObj, selectedDate);

          return (
            <button
              key={day}
              onClick={() => onSelectDate(dateObj)}
              className={`relative mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm transition
                ${isSelected ? 'bg-gray-900 text-white' : isToday ? 'font-semibold text-gray-900' : 'text-gray-700 hover:bg-gray-100'}
              `}
            >
              {day}
              {hasDraft && (
                <span
                  className={`absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${
                    isSelected ? 'bg-white' : 'bg-blue-500'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Mock data for demo ----

function getMockDrafts(): DraftPreview[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  return [
    {
      id: 'a1b2c3d4-0001',
      draft_type: 'tweet',
      title: null,
      content: { type: 'tweet_draft', data: { drafts: [{ content: 'AI agents are the new SaaS. The companies that figure out agent-to-agent communication will win the next decade. 🤖\n\nHere\'s why I\'m betting on this space...' }] } },
      scheduled_at: new Date(y, m, d, 9, 0).toISOString(),
      publish_status: 'published',
      published_at: new Date(y, m, d, 9, 0).toISOString(),
      created_at: new Date(y, m, d - 1, 14, 0).toISOString(),
    },
    {
      id: 'a1b2c3d4-0002',
      draft_type: 'tweet',
      title: null,
      content: { type: 'tweet_draft', data: { drafts: [{ content: 'Just shipped a new feature: tweet scheduling with auto-publish. Build it with BNBot CLI in 5 minutes.\n\nbnbot draft add "your tweet" --auto' }] } },
      scheduled_at: new Date(y, m, d, 12, 0).toISOString(),
      publish_status: 'scheduled',
      published_at: null,
      created_at: new Date(y, m, d - 1, 14, 30).toISOString(),
    },
    {
      id: 'a1b2c3d4-0003',
      draft_type: 'thread',
      title: null,
      content: { type: 'tweet_timeline', data: { timeline: [
        { text: '🧵 Web3 社交的三大趋势：\n\n1/ 去中心化身份将成为标配。你的 Twitter handle 不再是你的身份。' },
        { text: '2/ 内容所有权回归创作者。当你的粉丝不再属于平台，一切都变了。' },
        { text: '3/ AI + 社交 = 超级个体。一个人 + AI agent 可以做到过去 10 人团队的效果。\n\n这就是我在做 BNBot 的原因。' },
      ] } },
      scheduled_at: new Date(y, m, d, 18, 0).toISOString(),
      publish_status: 'scheduled',
      published_at: null,
      created_at: new Date(y, m, d, 8, 0).toISOString(),
    },
    {
      id: 'a1b2c3d4-0004',
      draft_type: 'tweet',
      title: null,
      content: { type: 'tweet_draft', data: { drafts: [{ content: 'Hot take: Most "AI-powered" products are just wrapper apps with a GPT API call. Real AI products change the workflow, not just add a chatbox.' }] } },
      scheduled_at: new Date(y, m, d, 21, 0).toISOString(),
      publish_status: 'scheduled',
      published_at: null,
      created_at: new Date(y, m, d, 10, 0).toISOString(),
    },
    {
      id: 'a1b2c3d4-0005',
      draft_type: 'tweet',
      title: null,
      content: { type: 'tweet_draft', data: { drafts: [{ content: 'The best growth hack for X/Twitter in 2026: be genuinely useful. Write threads that solve real problems. The algorithm rewards value.' }] } },
      scheduled_at: new Date(y, m, d + 1, 9, 0).toISOString(),
      publish_status: 'scheduled',
      published_at: null,
      created_at: new Date(y, m, d, 11, 0).toISOString(),
    },
    {
      id: 'a1b2c3d4-0006',
      draft_type: 'tweet',
      title: null,
      content: { type: 'tweet_draft', data: { drafts: [{ content: 'Tried to post yesterday but Chrome crashed mid-tweet. Thank god for draft auto-save 😅' }] } },
      scheduled_at: new Date(y, m, d - 1, 18, 0).toISOString(),
      publish_status: 'failed',
      published_at: null,
      created_at: new Date(y, m, d - 2, 15, 0).toISOString(),
    },
    {
      id: 'a1b2c3d4-0007',
      draft_type: 'tweet',
      title: null,
      content: { type: 'tweet_draft', data: { drafts: [{ content: 'Monday motivation: your side project doesn\'t need to be perfect to launch. Ship it, get feedback, iterate. Done > perfect.' }] } },
      scheduled_at: new Date(y, m, d + 2, 9, 0).toISOString(),
      publish_status: 'scheduled',
      published_at: null,
      created_at: new Date(y, m, d, 16, 0).toISOString(),
    },
    {
      id: 'a1b2c3d4-0008',
      draft_type: 'tweet',
      title: null,
      content: { type: 'tweet_draft', data: { drafts: [{ content: '刚看了 Solana 的 Q1 数据，DEX 交易量暴涨 340%。生态在爆发，你准备好了吗？' }] } },
      scheduled_at: new Date(y, m, d - 2, 12, 0).toISOString(),
      publish_status: 'published',
      published_at: new Date(y, m, d - 2, 12, 0).toISOString(),
      created_at: new Date(y, m, d - 3, 20, 0).toISOString(),
    },
  ];
}

// ---- Page ----

interface PageProps {
  params: Promise<{ shareKey: string }>;
}

export default function SchedulePreviewPage({ params }: PageProps) {
  const { shareKey } = use(params);
  const isDemo = shareKey === 'demo';
  const [drafts, setDrafts] = useState<DraftPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Calendar month state
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());

  useEffect(() => {
    if (isDemo) {
      setDrafts(getMockDrafts());
      setLoading(false);
      return;
    }
    async function fetchSchedule() {
      try {
        const isDevice = shareKey.startsWith('device-');
        const url = isDevice
          ? `${API_BASE_URL}/api/v1/public/device-schedule`
          : `${API_BASE_URL}/api/v1/public/schedule/${shareKey}`;
        const headers: Record<string, string> = {};
        if (isDevice) headers['X-Device-Key'] = shareKey.slice(7);
        const res = await fetch(url, { headers });
        if (!res.ok) {
          if (res.status === 404) {
            setError('Schedule not found');
          } else {
            setError(`Failed to load (${res.status})`);
          }
          return;
        }
        const json: ScheduleResponse = await res.json();
        setDrafts(json.data);
      } catch {
        setError('Network error');
      } finally {
        setLoading(false);
      }
    }
    fetchSchedule();
  }, [shareKey, isDemo]);

  // Dates that have drafts (for calendar dots)
  const draftDates = useMemo(() => {
    const set = new Set<string>();
    for (const d of drafts) {
      const dt = d.scheduled_at || d.created_at;
      if (dt) {
        const date = new Date(dt);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        set.add(key);
      }
    }
    return set;
  }, [drafts]);

  // Filter drafts for selected date, or show all if none selected
  const filteredDrafts = useMemo(() => {
    const sorted = [...drafts].sort((a, b) => {
      const ta = a.scheduled_at || a.created_at;
      const tb = b.scheduled_at || b.created_at;
      return new Date(ta).getTime() - new Date(tb).getTime();
    });
    if (!selectedDate) return sorted;
    return sorted.filter((d) => {
      const dt = d.scheduled_at || d.created_at;
      return dt && isSameDay(new Date(dt), selectedDate);
    });
  }, [drafts, selectedDate]);

  const handlePrevMonth = () => {
    if (calMonth === 0) {
      setCalYear((y) => y - 1);
      setCalMonth(11);
    } else {
      setCalMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (calMonth === 11) {
      setCalYear((y) => y + 1);
      setCalMonth(0);
    } else {
      setCalMonth((m) => m + 1);
    }
  };

  const handleSelectDate = (d: Date) => {
    if (selectedDate && isSameDay(d, selectedDate)) {
      setSelectedDate(null); // deselect
    } else {
      setSelectedDate(d);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-800" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-20 text-center text-sm text-gray-500">{error}</div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Calendar */}
      <MiniCalendar
        year={calYear}
        month={calMonth}
        draftDates={draftDates}
        selectedDate={selectedDate}
        onSelectDate={handleSelectDate}
        onPrevMonth={handlePrevMonth}
        onNextMonth={handleNextMonth}
      />

      {/* Date label */}
      {selectedDate && (
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">
            {selectedDate.toLocaleDateString([], {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </h2>
          <button
            onClick={() => setSelectedDate(null)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Show all
          </button>
        </div>
      )}

      {/* Draft cards */}
      {filteredDrafts.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">
          {selectedDate ? 'No drafts on this day' : 'No scheduled drafts'}
        </p>
      ) : (
        <div className="space-y-2">
          {filteredDrafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              expanded={expandedId === draft.id}
              onToggle={() =>
                setExpandedId(expandedId === draft.id ? null : draft.id)
              }
            />
          ))}
        </div>
      )}

      {/* Count */}
      {drafts.length > 0 && (
        <p className="text-center text-xs text-gray-400">
          {drafts.length} draft{drafts.length !== 1 ? 's' : ''} total
        </p>
      )}
    </div>
  );
}
