import React, { useState } from 'react';
import { ArrowLeft, RotateCw, Send, Trash2, RefreshCw, Sparkles, Loader2 } from 'lucide-react';
import { useXUser } from '../../hooks/useXUsername';
import { useRemixDrafts } from '../../hooks/useRemixDrafts';
import { deleteRemixDraft, type RemixDraft } from '../../services/remixDraftsService';
import { tweetPoster } from '../../utils/tweetPoster';

interface RemixDraftsPanelProps {
  onBack: () => void;
}

type PublishingState = Record<string, 'idle' | 'publishing' | 'error'>;

export const RemixDraftsPanel: React.FC<RemixDraftsPanelProps> = ({ onBack }) => {
  const { drafts, loading, error, refetch } = useRemixDrafts(true);
  const { username, avatarUrl, displayName } = useXUser();
  const [publishing, setPublishing] = useState<PublishingState>({});

  const handlePublish = async (draft: RemixDraft) => {
    setPublishing((p) => ({ ...p, [draft.id]: 'publishing' }));
    try {
      await tweetPoster.postThread([{ text: draft.draft.text, media: [] }]);
      await deleteRemixDraft(draft.id);
      void refetch();
    } catch (err) {
      console.error('[RemixDrafts] publish failed:', err);
      setPublishing((p) => ({ ...p, [draft.id]: 'error' }));
      setTimeout(() => {
        setPublishing((p) => {
          const { [draft.id]: _omit, ...rest } = p;
          return rest;
        });
      }, 3000);
    }
  };

  const handleDelete = async (draft: RemixDraft) => {
    try {
      await deleteRemixDraft(draft.id);
      void refetch();
    } catch (err) {
      console.error('[RemixDrafts] delete failed:', err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Status bar mirror: just a back arrow on the left, refresh on the right. */}
      <div
        style={{
          padding: '10px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-primary)',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          title="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <button
          onClick={() => void refetch()}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          title="Refresh"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto p-4 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {error && drafts.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 text-[var(--text-secondary)] py-16 text-center">
            <Sparkles className="w-10 h-10 opacity-40" />
            <div className="text-sm font-medium text-[var(--text-primary)]">桌面 agent 没响应</div>
            <div className="text-xs leading-relaxed max-w-[260px]">
              请打开 BNBot 桌面 app 并运行 <code className="px-1 py-0.5 rounded bg-[var(--bg-secondary)]">/remix</code> skill 生成草稿
            </div>
          </div>
        )}

        {!error && drafts.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center gap-3 text-[var(--text-secondary)] py-16 text-center">
            <Sparkles className="w-10 h-10 opacity-40" />
            <div className="text-sm font-medium text-[var(--text-primary)]">还没有二创草稿</div>
            <div className="text-xs leading-relaxed max-w-[260px]">
              在桌面 app 让 agent 跑 <code className="px-1 py-0.5 rounded bg-[var(--bg-secondary)]">/remix</code> 后，草稿会自动出现在这里
            </div>
          </div>
        )}

        {!error && drafts.length === 0 && loading && (
          <div className="flex items-center justify-center py-16 text-[var(--text-secondary)]">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {drafts.map((draft) => {
          const pubState = publishing[draft.id] || 'idle';
          const isPublishing = pubState === 'publishing';
          const isError = pubState === 'error';
          return (
            <div
              key={draft.id}
              className="mb-3 p-3.5 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl transition-colors hover:border-[var(--accent-color)]/40"
            >
              {/* Card head: user avatar + name + source chip */}
              <div className="flex gap-2.5 items-center">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#ff4d4d] to-[#b91c1c] flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-lg">🦞</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-[13px] text-[var(--text-primary)] truncate">
                    {displayName || username || 'You'}
                  </div>
                  <div className="text-[12px] text-[var(--text-secondary)] truncate">
                    {username ? `@${username}` : '即将发布'} · {formatRelativeTime(draft.createdAt)}
                  </div>
                </div>
                {draft.source?.author && (
                  <div
                    className="text-[10px] text-[var(--text-secondary)] px-2 py-1 bg-[var(--bg-primary)] rounded-full border border-[var(--border-color)] whitespace-nowrap flex-shrink-0"
                    title={draft.source.url || ''}
                  >
                    @{draft.source.author}
                  </div>
                )}
              </div>

              {/* Body text */}
              <div className="mt-2.5 text-[14px] leading-[1.45] text-[var(--text-primary)] whitespace-pre-wrap break-words">
                {draft.draft.text}
              </div>

              {/* Optional meta */}
              {draft.meta && (draft.meta.wordCount || draft.meta.language) && (
                <div className="mt-2.5 flex gap-3 text-[11px] text-[var(--text-secondary)]">
                  {draft.meta.wordCount != null && (
                    <span><b className="text-[var(--text-primary)] font-semibold">{draft.meta.wordCount}</b> 字</span>
                  )}
                  {draft.meta.language && <span>{draft.meta.language}</span>}
                  {draft.meta.model && <span>{draft.meta.model}</span>}
                </div>
              )}

              {/* Footer actions */}
              <div className="mt-3 pt-2.5 border-t border-[var(--border-color)] flex gap-2">
                <button
                  onClick={() => void handlePublish(draft)}
                  disabled={isPublishing}
                  className={`flex-1 py-2.5 px-3 rounded-lg text-[13px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    isError
                      ? 'bg-red-600 text-white'
                      : 'bg-[var(--accent-color)] text-white hover:bg-[#e63d3d] disabled:opacity-60 disabled:cursor-wait'
                  }`}
                  title="发布到 X"
                >
                  {isPublishing ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>发布中</span>
                    </>
                  ) : isError ? (
                    <span>发布失败，点击重试</span>
                  ) : (
                    <>
                      <Send size={14} />
                      <span>发布</span>
                    </>
                  )}
                </button>
                <button
                  className="w-9 py-2.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--accent-color)] hover:border-[var(--accent-color)] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  title="重新生成（即将支持，需在桌面 app 重新跑 /remix）"
                  disabled
                >
                  <RotateCw size={14} />
                </button>
                <button
                  onClick={() => void handleDelete(draft)}
                  className="w-9 py-2.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--accent-color)] hover:border-[var(--accent-color)] flex items-center justify-center transition-colors cursor-pointer"
                  title="删除草稿"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

function formatRelativeTime(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return '刚刚';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return new Date(ms).toLocaleDateString();
}
