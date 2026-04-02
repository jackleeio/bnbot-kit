import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLanguage } from '../LanguageContext';
import { useTheme } from '../ThemeContext';
import { RefreshCw, Calendar, ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import { draftService, TweetDraft } from '../../services/draftService';
import { authService } from '../../services/authService';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';

// ── Types ──────────────────────────────────────────────

interface DraftPreview {
  id: string;
  draft_type: string;
  title: string | null;
  content: any;
  scheduled_at: string | null;
  publish_status: string;
  published_at: string | null;
  created_at: string;
}

// ── Helpers ─────────────────────────────────────────────

function getDraftText(draft: DraftPreview): string {
  const c = draft.content;
  if (c?.data?.drafts?.[0]?.content) return c.data.drafts[0].content;
  if (c?.data?.timeline?.[0]?.text) {
    const texts = c.data.timeline.map((t: any) => t.text);
    return texts[0] + (texts.length > 1 ? ` (+${texts.length - 1})` : '');
  }
  if (c?.type === 'tweet_draft' && c?.data?.drafts?.[0]?.content) return c.data.drafts[0].content;
  if (draft.title) return draft.title;
  return '(empty)';
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  published: { color: '#22c55e', label: 'Published' },
  scheduled: { color: '#eab308', label: 'Scheduled' },
  failed: { color: '#ef4444', label: 'Failed' },
  draft: { color: '#9ca3af', label: 'Draft' },
};

// ── Fetch schedule data ─────────────────────────────────

async function fetchViaBackground(url: string, headers?: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'API_REQUEST', url, options: { method: 'GET', headers: headers || {} } },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response?.data || response);
      }
    );
  });
}

async function fetchScheduleDrafts(): Promise<DraftPreview[]> {
  // 1. Try authenticated mode (user logged in)
  try {
    const token = await authService.getToken();
    if (token) {
      const data = await draftService.getAllDrafts();
      return data.map((d: TweetDraft) => ({
        id: d.id,
        draft_type: d.draft_type,
        title: d.title,
        content: d.content,
        scheduled_at: d.scheduled_at,
        publish_status: d.publish_status,
        published_at: d.published_at,
        created_at: d.created_at,
      }));
    }
  } catch {
    // Auth not available, try device_key
  }

  // 2. Try device_key mode
  const stored = await chrome.storage.local.get('cliDeviceKey');
  const deviceKey = stored?.cliDeviceKey;
  if (deviceKey) {
    const result = await fetchViaBackground(
      `${API_BASE_URL}/api/v1/public/device-schedule`,
      { 'X-Device-Key': deviceKey }
    );
    return result?.data || [];
  }

  return [];
}

// ── Mini Calendar ───────────────────────────────────────

function MiniCalendar({
  year, month, draftDates, selectedDate,
  onSelectDate, onPrevMonth, onNextMonth,
}: {
  year: number;
  month: number;
  draftDates: Set<string>;
  selectedDate: Date | null;
  onSelectDate: (d: Date | null) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const today = new Date();
  const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const monthLabel = new Date(year, month).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="mx-3 px-1 pb-2 pt-1">
      {/* Month nav */}
      <div className="mb-2 flex items-center justify-between">
        <button onClick={onPrevMonth} className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] cursor-pointer">
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs font-semibold text-[var(--text-primary)]">{monthLabel}</span>
        <button onClick={onNextMonth} className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] cursor-pointer">
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="mb-0.5 grid grid-cols-7 text-center">
        {weekdays.map((d) => (
          <div key={d} className="py-0.5 text-[10px] text-[var(--text-secondary)]">{d}</div>
        ))}
      </div>

      {/* Days */}
      <div className="grid grid-cols-7 text-center text-xs">
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`e-${i}`} className="py-1" />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dk = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dateObj = new Date(year, month, day);
          const hasDraft = draftDates.has(dk);
          const isToday = isSameDay(dateObj, today);
          const isSelected = selectedDate && isSameDay(dateObj, selectedDate);

          return (
            <button
              key={day}
              onClick={() => onSelectDate(isSelected ? null : dateObj)}
              className="relative mx-auto flex h-9 w-9 items-center justify-center rounded-full text-xs transition-colors cursor-pointer"
              style={{
                backgroundColor: isSelected ? 'var(--text-primary)' : undefined,
                color: isSelected ? 'var(--bg-primary)' : isToday ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: isToday || isSelected ? 600 : 400,
              }}
            >
              {day}
              {hasDraft && (
                <span
                  className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
                  style={{ backgroundColor: isSelected ? 'var(--bg-primary)' : '#3b82f6' }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Draft Card ──────────────────────────────────────────

function ScheduleDraftCard({ draft, onClick }: { draft: DraftPreview; onClick?: () => void }) {
  const text = getDraftText(draft);
  const status = STATUS_CONFIG[draft.publish_status] || STATUS_CONFIG.draft;
  const isThread = draft.draft_type === 'thread' || draft.content?.type === 'tweet_timeline';
  const threadCount = draft.content?.data?.timeline?.length;

  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-left transition hover:border-[var(--text-secondary)] cursor-pointer"
    >
      <div className="flex items-center gap-2 mb-1">
        {draft.scheduled_at && (
          <span className="text-xs font-medium text-[var(--text-primary)]">
            {formatTime(draft.scheduled_at)}
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-secondary)]">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} />
          {status.label}
        </span>
        {isThread && threadCount && (
          <span className="text-[10px] text-[var(--text-secondary)]">{threadCount} tweets</span>
        )}
      </div>
      <p className="text-sm text-[var(--text-primary)] line-clamp-2 leading-relaxed">{text}</p>
    </button>
  );
}

// ── Tweet Preview Modal ─────────────────────────────────

function formatTweetDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, month: 'short', day: 'numeric', year: 'numeric' });
}

// X logo SVG
const XLogo = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="white">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const ActionBarIcons = () => (
  <div className="flex items-center justify-between py-2.5" style={{ borderTop: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
    {/* Reply */}
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14.046 2.242l-4.148-.01h-.002c-4.374 0-7.8 3.427-7.8 7.802 0 4.098 3.186 7.206 7.465 7.37v3.828c0 .108.044.286.12.403.142.225.384.347.632.347.138 0 .277-.038.402-.118.264-.168 6.473-4.14 8.088-5.506 1.902-1.61 3.04-3.97 3.043-6.312v-.017c-.006-4.367-3.43-7.787-7.8-7.788zm3.787 12.972c-1.134.96-4.862 3.405-6.772 4.643V16.67c0-.414-.335-.75-.75-.75h-.396c-3.66 0-6.318-2.476-6.318-5.886 0-3.534 2.768-6.302 6.3-6.302l4.147.01h.002c3.532 0 6.3 2.766 6.302 6.296-.003 1.91-.942 3.844-2.514 5.176z" /></svg>
    {/* Retweet */}
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" /></svg>
    {/* Like */}
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.56-1.13-1.666-1.84-2.908-1.91z" /></svg>
    {/* Views */}
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8.75 21V3h2v18h-2zM18.75 21V8.5h2V21h-2zM13.75 21v-9h2v9h-2zM3.75 21v-4h2v4h-2z" /></svg>
    {/* Bookmark */}
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5z" /></svg>
    {/* Share */}
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" /></svg>
  </div>
);

function TweetPreviewModal({ draft, onClose }: { draft: DraftPreview; onClose: () => void }) {
  const text = getDraftText(draft);
  const isThread = draft.draft_type === 'thread' || draft.content?.type === 'tweet_timeline';
  const timeline = draft.content?.data?.timeline;
  const date = draft.scheduled_at || draft.created_at;
  const status = STATUS_CONFIG[draft.publish_status] || STATUS_CONFIG.draft;

  // Close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Sidebar z-index fix (per CLAUDE.md modal pattern)
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'schedule-preview-sidebar-fix';
    style.textContent = `[data-testid="bnbot-sidebar"] { z-index: 0 !important; } [data-testid="bnbot-sidebar"] * { z-index: 0 !important; }`;
    const shadowContainer = document.getElementById('x-sidekick-container');
    const target = shadowContainer?.shadowRoot || document.head;
    target.appendChild(style);
    return () => { (shadowContainer?.shadowRoot || document).getElementById('schedule-preview-sidebar-fix')?.remove(); };
  }, []);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', top: 0, right: 0, width: 486, height: '100vh', zIndex: 9999, backgroundColor: 'rgba(128,128,128,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] rounded-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', boxShadow: '0 8px 30px rgba(0,0,0,0.12)' }}
      >
        {/* Close button */}
        <div className="flex items-center justify-end p-3 pb-0">
          <button onClick={onClose} className="p-1 rounded-full hover:bg-[var(--bg-secondary)] cursor-pointer">
            <X size={16} className="text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* Tweet card */}
        <div className="px-4 pt-2 pb-1">
          {/* Header */}
          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center shrink-0">
              <XLogo />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="text-[15px] font-bold text-[var(--text-primary)]">You</span>
                <svg viewBox="0 0 22 22" width="16" height="16"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.607-.274 1.264-.144 1.897.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="#1d9bf0" /></svg>
              </div>
              <div className="text-[13px] text-[var(--text-secondary)]">@you</div>
            </div>
          </div>

          {/* Content */}
          <div className="mt-3">
            {isThread && timeline ? (
              // Thread view
              <div className="flex flex-col gap-0">
                {timeline.map((tweet: any, i: number) => (
                  <div key={i} className="flex gap-2">
                    <div className="flex flex-col items-center">
                      {i > 0 && <div className="w-10 shrink-0" />}
                      {i < timeline.length - 1 && i > 0 && <div className="w-0.5 flex-1 bg-[var(--border-color)]" />}
                    </div>
                    <div className={`min-w-0 flex-1 ${i < timeline.length - 1 ? 'pb-3 border-b border-[var(--border-color)]' : ''}`}>
                      {i > 0 && (
                        <div className="text-[11px] text-[var(--text-secondary)] mb-1">
                          {i + 1}/{timeline.length}
                        </div>
                      )}
                      <p className="whitespace-pre-wrap text-[15px] leading-[22px] text-[var(--text-primary)]">
                        {tweet.text || ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              // Single tweet
              <p className="whitespace-pre-wrap text-[17px] leading-[24px] text-[var(--text-primary)]">
                {text}
              </p>
            )}
          </div>

          {/* Timestamp */}
          <div className="mt-3 pb-1 text-[13px] text-[var(--text-secondary)]">
            {formatTweetDate(date)}
          </div>

          {/* Action bar */}
          <ActionBarIcons />
        </div>
      </div>
    </div>
  );
}

// ── Main Panel ──────────────────────────────────────────

export const SchedulePanel: React.FC = () => {
  const { t } = useLanguage();
  const { theme } = useTheme();

  const [drafts, setDrafts] = useState<DraftPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewDraft, setPreviewDraft] = useState<DraftPreview | null>(null);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());

  const loadSchedule = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchScheduleDrafts();
      // Sort: scheduled first (by time), then unscheduled (by created_at desc)
      data.sort((a, b) => {
        if (a.scheduled_at && b.scheduled_at) return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
        if (a.scheduled_at) return -1;
        if (b.scheduled_at) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setDrafts(data);
    } catch (err) {
      console.error('[SchedulePanel] Failed to load schedule:', err);
      setError(err instanceof Error ? err.message : 'Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  // Dates that have drafts (for calendar dots)
  const draftDates = useMemo(() => {
    const set = new Set<string>();
    for (const d of drafts) {
      const dt = d.scheduled_at || d.created_at;
      if (dt) set.add(dateKey(new Date(dt)));
    }
    return set;
  }, [drafts]);

  // Filter drafts by selected date
  const filteredDrafts = useMemo(() => {
    if (!selectedDate) return drafts;
    return drafts.filter((d) => {
      const dt = d.scheduled_at || d.created_at;
      return dt && isSameDay(new Date(dt), selectedDate);
    });
  }, [drafts, selectedDate]);

  // Count by status (based on filtered drafts)
  const statusCounts = useMemo(() => {
    const counts = { scheduled: 0, published: 0, failed: 0, draft: 0 };
    for (const d of filteredDrafts) {
      const s = d.publish_status as keyof typeof counts;
      if (s in counts) counts[s]++;
    }
    return counts;
  }, [filteredDrafts]);

  const handlePrevMonth = () => {
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else setMonth(month - 1);
  };

  const handleNextMonth = () => {
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else setMonth(month + 1);
  };

  const handleDraftClick = (draft: DraftPreview) => {
    setPreviewDraft(draft);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex-none px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-[var(--text-primary)]" />
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            {t.drafts?.calendar || 'Schedule'}
          </h2>
        </div>
        <button
          onClick={() => loadSchedule()}
          disabled={loading}
          className="p-2 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={`text-[var(--text-secondary)] ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Mini Calendar */}
        <MiniCalendar
          year={year}
          month={month}
          draftDates={draftDates}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onPrevMonth={handlePrevMonth}
          onNextMonth={handleNextMonth}
        />

        {/* Status summary */}
        {drafts.length > 0 && (
          <div className="mx-3 mt-2 flex items-center gap-3 text-[10px] text-[var(--text-secondary)]">
            {statusCounts.scheduled > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
                {statusCounts.scheduled} scheduled
              </span>
            )}
            {statusCounts.published > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                {statusCounts.published} published
              </span>
            )}
            {statusCounts.failed > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                {statusCounts.failed} failed
              </span>
            )}
            {statusCounts.draft > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                {statusCounts.draft} draft
              </span>
            )}
          </div>
        )}

        {/* Draft list */}
        <div className="px-3 pb-4 mt-2 flex flex-col gap-2">
          {loading && (
            <div className="flex items-center justify-center py-12 text-[var(--text-secondary)]">
              <RefreshCw size={16} className="animate-spin mr-2" />
              <span className="text-sm">Loading...</span>
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-8">
              <p className="text-sm text-red-500">{error}</p>
              <button
                onClick={() => loadSchedule()}
                className="mt-2 text-xs text-[#1d9bf0] hover:underline"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && filteredDrafts.length === 0 && (
            <div className="text-center py-8">
              <Calendar size={32} className="mx-auto mb-3 text-[var(--text-secondary)] opacity-40" />
              <p className="text-sm text-[var(--text-secondary)]">
                {selectedDate ? 'No drafts on this date' : 'No scheduled drafts yet'}
              </p>
              <p className="text-xs text-[var(--text-secondary)] mt-1 opacity-70">
                Use CLI to create drafts: bnbot draft add "text" --auto
              </p>
            </div>
          )}

          {!loading && filteredDrafts.map((draft) => (
            <ScheduleDraftCard
              key={draft.id}
              draft={draft}
              onClick={() => handleDraftClick(draft)}
            />
          ))}
        </div>
      </div>

      {/* Tweet Preview Modal */}
      {previewDraft && (
        <TweetPreviewModal draft={previewDraft} onClose={() => setPreviewDraft(null)} />
      )}
    </div>
  );
};
